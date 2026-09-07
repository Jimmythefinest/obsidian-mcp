// Per-user container lifecycle. Containers sit on a private Docker
// network ("mcp-net") and are NOT published to the host -- the gateway
// reaches them by container name over that network, so only the gateway
// itself is a public attack surface, not N host ports.
//
// TODO before production use:
//  - idle reaper (stop containers unused for e.g. 30 min)
//  - resource limits (memory/cpu) per container
//  - restart policy tuning / crash-loop detection
//  - image pinning by digest, not just "shell-mcp:latest"

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

// Ensures the given user's container exists and is running.
// userConfig: { id, container, vaultHostPath }
// Returns the internal MCP URL to proxy requests to.
export async function ensureContainer(userConfig) {
  await ensureNetwork();

  const existing = await findContainer(userConfig.container);

  if (existing && existing.State === "running") {
    return internalUrl(userConfig.container);
  }

  if (existing) {
    // Exists but stopped -- just start it, don't recreate (preserves any
    // in-container state / avoids losing anything mounted read-write).
    const c = docker.getContainer(existing.Id);
    await c.start();
    return internalUrl(userConfig.container);
  }

  const container = await docker.createContainer({
    name: userConfig.container,
    Image: IMAGE,
    Env: [`USER_ID=${userConfig.id}`, "VAULT_PATH=/vault"],
    HostConfig: {
      Binds: [`${userConfig.vaultHostPath}:/vault:rw`],
      RestartPolicy: { Name: "unless-stopped" },
      // No PortBindings -- deliberately not published to the host.
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [NETWORK_NAME]: { Aliases: [userConfig.container] },
      },
    },
  });
  await container.start();
  return internalUrl(userConfig.container);
}

function internalUrl(containerName) {
  return `http://${containerName}:${INTERNAL_PORT}/mcp`;
}
