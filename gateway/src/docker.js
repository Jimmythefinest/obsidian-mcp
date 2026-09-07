// Per-user container lifecycle. Containers sit on a private Docker
// network ("mcp-net") and their MCP port is bound only to 127.0.0.1 on
// a Docker-assigned ephemeral host port -- reachable from this host
// (where the gateway runs today) but not from outside the box.
//
// Once the gateway itself is containerized and joined to mcp-net, this
// can go back to pure name-based routing over the Docker network with
// no published ports at all (Docker's embedded DNS only resolves
// container names for other containers on the same network, not for
// bare-host processes, which is why we can't use it yet).
//
// TODO before production use:
//  - idle reaper (stop containers unused for e.g. 30 min)
//  - resource limits (memory/cpu) per container
//  - restart policy tuning / crash-loop detection
//  - image pinning by digest, not just "shell-mcp:latest"
//  - containerize the gateway itself, drop the loopback port publish

import Docker from "dockerode";

const docker = new Docker(); // talks to /var/run/docker.sock
const NETWORK_NAME = "mcp-net";
const IMAGE = process.env.SHELL_MCP_IMAGE || "shell-mcp:latest";
const INTERNAL_PORT = 9001;

let networkEnsured = false;

async function ensureNetwork() {
  if (networkEnsured) return;
  const networks = await docker.listNetworks({ filters: { name: [NETWORK_NAME] } });
  if (!networks.some((n) => n.Name === NETWORK_NAME)) {
    await docker.createNetwork({ Name: NETWORK_NAME, Driver: "bridge" });
  }
  networkEnsured = true;
}

async function findContainer(name) {
  const containers = await docker.listContainers({ all: true, filters: { name: [`^/${name}$`] } });
  return containers[0] || null;
}

async function internalUrl(containerId) {
  const container = docker.getContainer(containerId);
  const info = await container.inspect();
  const binding = info.NetworkSettings.Ports[`${INTERNAL_PORT}/tcp`];
  if (!binding || !binding[0]) {
    throw new Error(`container ${info.Name} has no published port for ${INTERNAL_PORT}/tcp`);
  }
  return `http://127.0.0.1:${binding[0].HostPort}`;
}

// Ensures the given user's container exists and is running.
// userConfig: { id, container, vaultHostPath }
// Returns the internal MCP URL to proxy requests to.
export async function ensureContainer(userConfig) {
  await ensureNetwork();

  const existing = await findContainer(userConfig.container);

  if (existing && existing.State === "running") {
    return internalUrl(existing.Id);
  }

  if (existing) {
    const c = docker.getContainer(existing.Id);
    await c.start();
    return internalUrl(existing.Id);
  }

  const container = await docker.createContainer({
    name: userConfig.container,
    Image: IMAGE,
    Env: [`USER_ID=${userConfig.id}`, "VAULT_PATH=/vault"],
    ExposedPorts: { [`${INTERNAL_PORT}/tcp`]: {} },
    HostConfig: {
      Binds: [`${userConfig.vaultHostPath}:/vault:rw`],
      RestartPolicy: { Name: "unless-stopped" },
      PortBindings: { [`${INTERNAL_PORT}/tcp`]: [{ HostIp: "127.0.0.1", HostPort: "" }] },
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [NETWORK_NAME]: { Aliases: [userConfig.container] },
      },
    },
  });
  await container.start();
  return internalUrl(container.id);
}
