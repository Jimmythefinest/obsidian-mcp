// Minimal OAuth 2.1 Authorization Server, scoped to what an MCP client
// (e.g. ChatGPT's connector flow) needs: discovery metadata, dynamic
// client registration (RFC 7591), authorization code + PKCE (S256), and
// a token endpoint. No refresh-token rotation, no real consent screen --
// both are TODOs. Deliberately not polished yet because the open
// question is "self-issued vs delegated to a real IdP (Google/GitHub)",
// and it's not worth polishing either path until that's decided. If we
// delegate later, only authorizeHandler/loginHandler change -- discovery,
// registration, and the token endpoint stay the same.

import crypto from "node:crypto";
import express from "express";
import { withStore, readStore } from "./store.js";
import { findUserByUsername, verifyPassword } from "./users.js";

const router = express.Router();

const ISSUER = process.env.GATEWAY_ISSUER || "http://localhost:9100";
const AUTH_CODE_TTL_MS = 60 * 1000; // 60s, single use
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function base64url(input) {
  return input.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function verifyPkce(codeVerifier, codeChallenge, method) {
  if (method !== "S256") return false;
  const hash = crypto.createHash("sha256").update(codeVerifier).digest();
  return base64url(hash) === codeChallenge;
}

// --- Discovery -------------------------------------------------------

router.get("/.well-known/oauth-authorization-server", (req, res) => {
  res.json({
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    registration_endpoint: `${ISSUER}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
  });
});

// MCP clients also probe protected-resource metadata (RFC 9728) to learn
// which authorization server protects this resource. Gateway plays both
// roles here, so it points back at itself.
router.get("/.well-known/oauth-protected-resource", (req, res) => {
  res.json({
    resource: ISSUER,
    authorization_servers: [ISSUER],
  });
});

// --- Dynamic client registration (RFC 7591) --------------------------

router.post("/register", express.json(), (req, res) => {
  const { redirect_uris, client_name, token_endpoint_auth_method } = req.body || {};
  if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    return res.status(400).json({ error: "invalid_client_metadata", error_description: "redirect_uris is required" });
  }

  const client_id = randomToken(16);
  const isPublic = token_endpoint_auth_method === "none";
  const client_secret = isPublic ? undefined : randomToken(24);

  withStore((data) => {
    data.clients[client_id] = {
      client_id,
      client_secret: client_secret || null,
      redirect_uris,
      client_name: client_name || "unnamed-mcp-client",
      token_endpoint_auth_method: isPublic ? "none" : "client_secret_post",
    };
  });

  res.status(201).json({
    client_id,
    ...(client_secret ? { client_secret } : {}),
    redirect_uris,
    client_name: client_name || "unnamed-mcp-client",
    token_endpoint_auth_method: isPublic ? "none" : "client_secret_post",
  });
});

// --- Authorization endpoint -------------------------------------------

router.get("/authorize", (req, res) => {
  const { response_type, client_id, redirect_uri, code_challenge, code_challenge_method, state, scope } = req.query;

  if (response_type !== "code") {
    return res.status(400).send("only response_type=code is supported");
  }
  const { clients } = readStore();
  const client = clients[client_id];
  if (!client || !client.redirect_uris.includes(redirect_uri)) {
    return res.status(400).send("unknown client_id or redirect_uri");
  }
  if (code_challenge_method !== "S256" || !code_challenge) {
    return res.status(400).send("PKCE with S256 is required");
  }

  // Bare-bones login form. Carries the whole authorize request through
  // as hidden fields so /login can mint the code after checking creds.
  res.type("html").send(`
    <html><body style="font-family: sans-serif; max-width: 320px; margin: 80px auto;">
      <h3>Sign in to MCP Gateway</h3>
      <p style="color:#666">${client.client_name} is requesting shell access${scope ? " (" + scope + ")" : ""}.</p>
      <form method="POST" action="/login">
        <input type="hidden" name="client_id" value="${client_id}">
        <input type="hidden" name="redirect_uri" value="${redirect_uri}">
        <input type="hidden" name="code_challenge" value="${code_challenge}">
        <input type="hidden" name="code_challenge_method" value="${code_challenge_method}">
        <input type="hidden" name="state" value="${state || ""}">
        <p><input name="username" placeholder="username" autofocus style="width:100%;padding:8px"></p>
        <p><input name="password" type="password" placeholder="password" style="width:100%;padding:8px"></p>
        <button type="submit" style="width:100%;padding:8px">Sign in</button>
      </form>
    </body></html>
  `);
});

router.post("/login", express.urlencoded({ extended: true }), (req, res) => {
  const { client_id, redirect_uri, code_challenge, code_challenge_method, state, username, password } = req.body;

  const user = findUserByUsername(username);
  if (!user || !verifyPassword(user, password)) {
    return res.status(401).send("invalid username or password. <a href=\"javascript:history.back()\">back</a>");
  }

  const code = randomToken(24);
  withStore((data) => {
    data.authCodes[code] = {
      client_id,
      redirect_uri,
      code_challenge,
      code_challenge_method,
      user_id: user.id,
      expires_at: Date.now() + AUTH_CODE_TTL_MS,
    };
  });

  const redirect = new URL(redirect_uri);
  redirect.searchParams.set("code", code);
  if (state) redirect.searchParams.set("state", state);
  res.redirect(redirect.toString());
});

// --- Token endpoint -----------------------------------------------------

router.post("/token", express.urlencoded({ extended: true }), (req, res) => {
  const { grant_type, code, redirect_uri, client_id, code_verifier } = req.body;

  if (grant_type !== "authorization_code") {
    return res.status(400).json({ error: "unsupported_grant_type" });
  }

  const result = withStore((data) => {
    const entry = data.authCodes[code];
    if (!entry) return { error: "invalid_grant" };
    delete data.authCodes[code]; // single use

    if (entry.expires_at < Date.now()) return { error: "invalid_grant" };
    if (entry.client_id !== client_id || entry.redirect_uri !== redirect_uri) return { error: "invalid_grant" };
    if (!verifyPkce(code_verifier, entry.code_challenge, entry.code_challenge_method)) {
      return { error: "invalid_grant" };
    }

    const access_token = randomToken(32);
    data.tokens[access_token] = {
      user_id: entry.user_id,
      client_id,
      expires_at: Date.now() + ACCESS_TOKEN_TTL_MS,
    };
    return { access_token, expires_in: ACCESS_TOKEN_TTL_MS / 1000 };
  });

  if (result.error) return res.status(400).json(result);
  res.json({
    access_token: result.access_token,
    token_type: "Bearer",
    expires_in: result.expires_in,
  });
});

export default router;
