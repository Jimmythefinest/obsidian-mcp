import bcrypt from "bcryptjs";
import { readStore } from "./store.js";

export function findUserByUsername(username) {
  const { users } = readStore();
  return users[username] || null;
}

export function findUserById(userId) {
  const { users } = readStore();
  return Object.values(users).find((u) => u.id === userId) || null;
}

export function verifyPassword(user, password) {
  if (!user) return false;
  return bcrypt.compareSync(password, user.passwordHash);
}
