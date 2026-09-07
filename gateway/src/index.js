import express from "express";
import { initStoreFile } from "./store.js";
import oauthRouter from "./oauth.js";
import { authenticateAndProxy } from "./proxy.js";

initStoreFile();

const app = express();
const PORT = process.env.GATEWAY_PORT || 9100;

app.use(oauthRouter);

// Matches the path shape nginx already proxies today: external
// /shell/mcp -> backend /mcp. When cutting over, only nginx's
// proxy_pass target needs to change (127.0.0.1:9001 -> 127.0.0.1:9100),
// the /mcp path is unchanged.
app.all("/mcp", authenticateAndProxy);

app.get("/healthz", (req, res) => res.json({ ok: true }));

app.listen(PORT, "127.0.0.1", () => {
  console.log(`mcp-gateway listening on 127.0.0.1:${PORT}`);
});
