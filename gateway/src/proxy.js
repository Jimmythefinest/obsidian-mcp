import httpProxy from "http-proxy";
import { readStore } from "./store.js";
import { findUserById } from "./users.js";
import { ensureContainer } from "./docker.js";

const ISSUER = process.env.GATEWAY_ISSUER || "http://localhost:9100";

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  ws: false, // MCP streamable-HTTP uses SSE-over-HTTP, not raw websockets
  proxyTimeout: 3600 * 1000, // match the long timeouts nginx already uses upstream
});

proxy.on("error", (err, req, res) => {
  console.error("proxy error:", err.message);
  if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "bad_gateway", error_description: err.message }));
});

function unauthorized(res, description) {
  res.setHeader(
    "WWW-Authenticate",
    `Bearer realm="mcp-gateway", error="invalid_token", error_description="${description}", resource_metadata="${ISSUER}/.well-known/oauth-protected-resource"`
  );
  res.status(401).json({ error: "invalid_token", error_description: description });
}

export async function authenticateAndProxy(req, res) {
  const auth = req.headers["authorization"] || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return unauthorized(res, "missing bearer token");

  const token = match[1];
  const { tokens } = readStore();
  const entry = tokens[token];
  if (!entry) return unauthorized(res, "unknown token");
  if (entry.expires_at < Date.now()) return unauthorized(res, "expired token");

  const user = findUserById(entry.user_id);
  if (!user) return unauthorized(res, "user no longer exists");

  try {
    const target = await ensureContainer(user);
    proxy.web(req, res, { target });
  } catch (err) {
    console.error("container start failed:", err);
    res.status(502).json({ error: "container_unavailable", error_description: err.message });
  }
}
