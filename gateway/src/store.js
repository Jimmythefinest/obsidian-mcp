// Dead-simple JSON-file persistence for the gateway's own state.
// Good enough to scaffold and test with. Before real multi-user load,
// swap this for Postgres (already running on this host) or SQLite --
// the shape below maps cleanly to four tables: users, clients, auth_codes, tokens.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(__dirname, "..", "store.json");

function empty() {
  return { users: {}, clients: {}, authCodes: {}, tokens: {} };
}

function load() {
  if (!fs.existsSync(STORE_PATH)) return empty();
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch {
    return empty();
  }
}

function save(data) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

// Very small synchronous "transaction" helper -- fine for a single-process
// dev gateway. Not safe for multiple gateway instances; another reason to
// move to a real DB before this handles real traffic.
export function withStore(fn) {
  const data = load();
  const result = fn(data);
  save(data);
  return result;
}

export function readStore() {
  return load();
}

export function initStoreFile() {
  if (!fs.existsSync(STORE_PATH)) save(empty());
}
