# Obsidian MCP

A small repository containing MCP servers and an HTTP gateway for working with an Obsidian vault and the host machine.

## Repository layout

| Directory | Purpose |
| --- | --- |
| [`shell-mcp/`](./shell-mcp) | Shell MCP server. Runs commands and manages background processes; also includes optional semantic vault-search tools. **Start here for the Shell MCP.** |
| [`obsidian-mcp/`](./obsidian-mcp) | Separate Obsidian-focused MCP server. |
| [`gateway/`](./gateway) | Experimental gateway for routing/authentication and multi-user deployments. See its [README](./gateway/README.md) for its own setup and current limitations. |
| [`vault/`](./vault) | Small development/test vault. |

# Shell MCP: getting started

The Shell MCP is a Node.js MCP server. Its MCP transport is **stdio**; it does not open an HTTP port by itself. To connect an HTTP-based MCP client, run it through `mcp-proxy` as shown below.

## 1. Requirements

- Node.js (an active LTS release recommended; Node 20 or newer)
- npm
- Git, if cloning this repository
- `mcp-proxy` only if you want an HTTP endpoint

## 2. Clone and build

Run these commands from a terminal:

```bash
git clone https://github.com/Jimmythefinest/obsidian-mcp.git
cd obsidian-mcp/shell-mcp
npm install
npm run build
```

`npm run build` compiles `src/index.ts` into `build/index.js`. Run it again after changing the TypeScript source.

## 3. Start directly over stdio

```bash
cd /path/to/obsidian-mcp/shell-mcp
npm start
```

This starts the MCP server and keeps the terminal occupied. It is intended to be launched by an MCP client that communicates over stdio. It is not an HTTP server, so opening `http://localhost:9001` will not work with this command alone.

For an MCP client configuration, use the absolute path to Node and the built entrypoint. For example:

```json
{
  "mcpServers": {
    "shell": {
      "command": "node",
      "args": ["/absolute/path/to/obsidian-mcp/shell-mcp/build/index.js"]
    }
  }
}
```

Use the actual absolute path on your machine. The client starts the process when it needs the server.

## 4. Start over HTTP (recommended when the client needs a URL)

Install the HTTP bridge globally if it is not already installed:

```bash
npm install --global mcp-proxy@6.7.19
```

Build and launch the server from the `shell-mcp` directory:

```bash
cd /path/to/obsidian-mcp/shell-mcp
npm install
npm run build
mcp-proxy --host 127.0.0.1 --port 9001 -- node ./build/index.js
```

The Streamable HTTP MCP endpoint is:

```text
http://127.0.0.1:9001/mcp
```

Keep the terminal open while using the server. Stop it with `Ctrl+C`.

### Require an API key

The proxy supports API-key authentication through the `X-API-Key` request header. Set a strong secret in your environment and start the proxy with authentication enabled:

```bash
export SHELL_MCP_API_KEY='replace-with-a-long-random-secret'
mcp-proxy --host 127.0.0.1 --port 9001 --apiKey "$SHELL_MCP_API_KEY" -- node ./build/index.js
```

Configure the MCP client to send the same secret as the `X-API-Key` header. Do not commit the secret to this repository or paste it into logs or screenshots.

## 5. Run it as a systemd service (Linux)

After building the project and installing `mcp-proxy`, create an environment file for the key:

```bash
sudo install -m 600 /dev/null /etc/shell-mcp.env
sudoedit /etc/shell-mcp.env
```

Add this line to that file:

```ini
SHELL_MCP_API_KEY=replace-with-a-long-random-secret
```

Create `/etc/systemd/system/shell-mcp.service` (adjust the paths and username):

```ini
[Unit]
Description=Shell MCP HTTP service
After=network.target

[Service]
Type=simple
User=YOUR_LINUX_USER
WorkingDirectory=/absolute/path/to/obsidian-mcp/shell-mcp
EnvironmentFile=/etc/shell-mcp.env
ExecStart=/usr/bin/mcp-proxy --host 127.0.0.1 --port 9001 --apiKey ${SHELL_MCP_API_KEY} -- node /absolute/path/to/obsidian-mcp/shell-mcp/build/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now shell-mcp.service
sudo systemctl status shell-mcp.service
```

Useful service commands:

```bash
sudo systemctl restart shell-mcp.service
sudo journalctl -u shell-mcp.service -f
sudo systemctl stop shell-mcp.service
```

The example deliberately binds to `127.0.0.1`, so the endpoint is only reachable from the same machine. Put a properly configured authenticated reverse proxy or private network in front of it if remote access is needed.

If you already created a service named `mcp-proxy.service` on your machine, manage that existing unit using its own name:

```bash
sudo systemctl status mcp-proxy
sudo systemctl restart mcp-proxy
sudo journalctl -u mcp-proxy -f
```

Rebuild after source changes (`npm run build`) before restarting the service. A service restart does not compile TypeScript.

## Shell MCP tools

The server currently exposes these tools:

| Tool | Purpose |
| --- | --- |
| `run_command` | Run a shell command, optionally in a specified working directory. |
| `start_background_command` | Start a long-running command and return a task ID. |
| `check_command_status` | Read the status and recent output for a background task. |
| `stop_command` | Stop a background task by task ID. |
| `semantic_search` | Search indexed vault content by meaning. |
| `index_vault` | Create or update semantic embeddings for Markdown notes. |
| `vector_status` | Check the vector backend and indexed collection. |

**Important:** the first four tools provide powerful shell access as the operating-system user running the server. Treat access to this MCP server like remote terminal access to that account.

## Optional: semantic vault search

The command-execution tools do not require Python, Weaviate, or embedding models. The three vector tools do.

Install the Python dependencies from the `shell-mcp` directory:

```bash
python3 -m pip install -r vector/requirements.txt
```

You also need a reachable Weaviate instance and a vault directory. Configure these environment variables for the Shell MCP process:

| Variable | Default | Meaning |
| --- | --- | --- |
| `VAULT_PATH` | `/vault` | Absolute path to the Obsidian vault to index. |
| `WEAVIATE_URL` | `http://localhost:8080` | Weaviate endpoint. |
| `VECTOR_COLLECTION` | `VaultNote` | Collection used for indexed chunks. |
| `VECTOR_EMBEDDING_MODEL` | `all-MiniLM-L6-v2` | Sentence-Transformers embedding model. |
| `VECTOR_PYTHON` | `python3` | Python executable for the backend. |
| `VECTOR_TIMEOUT_MS` | `3600000` | Backend timeout in milliseconds (one hour by default). |

For example, when launching manually:

```bash
export VAULT_PATH="$HOME/obsidian_vault/Main"
export WEAVIATE_URL="http://localhost:8080"
mcp-proxy --host 127.0.0.1 --port 9001 --apiKey "$SHELL_MCP_API_KEY" -- node ./build/index.js
```

The embedding model may need to download the first time it is used. Indexing a large vault can take several minutes. For multi-user deployments, use a separate Weaviate endpoint or a unique collection per vault; sharing a collection can expose one user's indexed content to another.

## Troubleshooting

- **`mcp-proxy: command not found`** — install it globally with `npm install --global mcp-proxy@6.7.19`, then check `command -v mcp-proxy`.
- **`Cannot find module ... build/index.js`** — run `npm install` and `npm run build` inside `shell-mcp/`.
- **Port 9001 is already in use** — inspect it with `ss -ltnp | grep ':9001'`, then stop or reconfigure the process already listening there.
- **The MCP client cannot connect** — for HTTP, use the `/mcp` path and make sure the client sends `X-API-Key` if authentication is enabled. For stdio, configure the executable and arguments rather than an HTTP URL.
- **Vector tools fail but shell tools work** — check `VAULT_PATH`, `WEAVIATE_URL`, Python dependencies, and Weaviate availability. Vector search is optional.

## Security notes

- Do not expose an unauthenticated Shell MCP endpoint to the public internet. It can execute arbitrary commands with the server process's operating-system permissions.
- Keep the proxy bound to `127.0.0.1` unless remote access is intentionally configured and protected by authentication, TLS, and network restrictions.
- Run the service as a dedicated low-privilege OS account where practical. Limit that account's filesystem permissions and secrets.
- Never commit API keys, OAuth credentials, tokens, database files, or private vault contents.
- The gateway is a separate, experimental component; do not assume it automatically protects a directly exposed Shell MCP process.

## Development

From `shell-mcp/`:

```bash
npm install
npm run build
npm start
```

The source is in `shell-mcp/src/index.ts`; the compiled entrypoint is `shell-mcp/build/index.js`.
