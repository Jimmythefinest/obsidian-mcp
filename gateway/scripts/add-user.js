// Usage: node scripts/add-user.js <username> <password> <containerName> <vaultHostPath>
// Example:
//   node scripts/add-user.js jimmy  s3cret  shell-jimmy  /home/admin/obsidian_vault/Main
//   node scripts/add-user.js alice  s3cret  shell-alice  /home/admin/vaults/alice
//   node scripts/add-user.js bob    s3cret  shell-bob    /home/admin/vaults/bob

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { withStore } from "../src/store.js";

const [, , username, password, containerName, vaultHostPath] = process.argv;

if (!username || !password || !containerName || !vaultHostPath) {
  console.error("usage: node scripts/add-user.js <username> <password> <containerName> <vaultHostPath>");
  process.exit(1);
}

const id = crypto.randomUUID();
const passwordHash = bcrypt.hashSync(password, 10);

withStore((data) => {
  data.users[username] = { id, username, passwordHash, container: containerName, vaultHostPath };
});

console.log(`added user "${username}" -> container "${containerName}", vault "${vaultHostPath}"`);
