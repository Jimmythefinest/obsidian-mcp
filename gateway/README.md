# MCP Gateway (scaffold)

Multi-user front door for Shell MCP: one public endpoint, OAuth-authenticated,
routing each authenticated user to their own isolated Docker container and vault.

```
ChatGPT --OAuth--> Gateway (this app) --docker network--> shell-<user> containers
                                                             each with its own
                                                             bind-mounted vault
```

This is **not wired into nginx yet**. The existing bare-metal deployment
(screen session, port 9001, no auth) keeps running untouched while this
is built out and tested on a separate port.

## What's here

- `src/oauth.js` -- gateway acts as its own OAuth 2.1 authorization server:
  discovery metadata, dynamic client registration (RFC 7591), `/authorize`
  + a bare login form, PKCE-verified `/token`.
- `src/docker.js` -- per-user container lifecycle via `dockerode`. Containers
  run on a private `mcp-net` Docker network, **not** published to the host --
  only the gateway can reach them.
- `src/proxy.js` -- validates the bearer token, resolves it to a user,
  ensures their container is running, proxies the MCP request through.
- `src/store.js` / `src/users.js` -- JSON-file-backed user/client/token
  store. Deliberately simple; see "Known gaps" below.
- `scripts/add-user.js` -- seed a user (`node scripts/add-user.js <username>
  <password> <containerName> <vaultHostPath>`).
- `../shell-mcp/Dockerfile` -- containerizes the existing shell-mcp app,
  no changes to its code.

## Open decision: self-issued OAuth vs. delegated IdP

Scaffolded with the gateway as its **own** OAuth provider (username/password
login) because it's the fastest path to an end-to-end test with ChatGPT's
connector flow, which just needs a spec-compliant AS to talk to. If you'd
rather delegate to Google/GitHub/etc. later, the only files that change are
`authorize`/`login` in `src/oauth.js` (swap the login form for a redirect to
the IdP + a callback that resolves an external identity to a `user_id`) --
discovery, registration, token issuance, and everything downstream of "we
have a `user_id`" stays the same.

## Known gaps / TODO before this carries real traffic

- **Storage**: `store.json` is a flat file, fine for one gateway process
  and local testing. Move to Postgres (already running on this host) or
  SQLite before running for real, and before running more than one gateway
  instance.
- **No refresh tokens** -- access tokens just expire (1h) and the client
  re-authenticates. Fine for testing, worth adding before this is the
  primary way ChatGPT connects.
- **No idle reaping** -- once a user's container starts, it stays up
  (`unless-stopped`). Add a reaper that stops containers idle past some
  threshold, or this will slowly eat host resources as users pile up.
- **No resource limits** on the per-user containers (memory/CPU) -- add
  before this is multi-tenant for real, since shell-mcp gives a user
  unrestricted command execution inside their own container.
- **shell-mcp's default `cwd`** is still the app's own directory inside
  the container, not `/vault` (the `VAULT_PATH` env var is passed in but
  the app doesn't read it yet). Within a single user's own container this
  isn't a cross-user isolation problem, but it's worth a small patch to
  `shell-mcp/src/index.ts` to default `cwd` to `/vault` for a less
  surprising experience.
- **No cutover plan for the existing `/mcp` Obsidian-MCP service on port
  9000** -- this scaffold only covers Shell MCP. Same pattern would apply
  if/when that needs the same treatment.

## Try it locally (once dependencies are installed)

```
cd /home/admin/obsidian-mcp/gateway
npm install
node scripts/add-user.js jimmy testpass123 shell-jimmy /home/admin/obsidian_vault/Main
GATEWAY_PORT=9100 GATEWAY_ISSUER=http://localhost:9100 npm start
```

Then build the container image the gateway will start on demand:

```
cd /home/admin/obsidian-mcp/shell-mcp
docker build -t shell-mcp:latest -f Dockerfile .
```

At that point `GET http://localhost:9100/.well-known/oauth-authorization-server`
should return discovery metadata, and an OAuth-capable MCP client pointed at
`http://localhost:9100/mcp` should be able to complete the auth flow and reach
a container named `shell-jimmy`.

## Cutover (once tested)

No nginx config *structure* changes -- just repoint the existing
`/shell/mcp` location's `proxy_pass` target from `127.0.0.1:9001/mcp` to
`127.0.0.1:9100/mcp` once this is validated, and run the gateway under
systemd (also currently missing for the bare-metal version -- worth adding
either way).
