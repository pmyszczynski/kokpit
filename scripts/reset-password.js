#!/usr/bin/env node
// Emergency password reset for Kokpit. Run this when you're locked out of the
// web UI (forgotten password, lost recovery code, lost TOTP device) and have
// direct access to the host/container running Kokpit — the same trust level
// already required to read data/users.db or .session_secret.
//
// Usage: npm run reset-password
//   (or, inside Docker: docker compose exec kokpit npm run reset-password)

const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const readline = require("readline");
const { mkdirSync } = require("fs");
const { dirname } = require("path");

const SALT_ROUNDS = 10;

function openDb() {
  const path = process.env.KOKPIT_DB_PATH ?? "data/users.db";
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      totp_secret TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  const columns = db.prepare("PRAGMA table_info(users)").all();
  if (!columns.some((c) => c.name === "recovery_code_hash")) {
    db.exec("ALTER TABLE users ADD COLUMN recovery_code_hash TEXT");
  }
  return db;
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

// Masks keystrokes with "*" while still letting readline's own line-editing
// (backspace, piped input, etc.) do the actual reading — a second listener
// that consumed stdin directly would race with readline's own listener.
function askHidden(rl, question) {
  return new Promise((resolve) => {
    const isTTY = process.stdin.isTTY;
    const onKeypress = () => {
      if (!isTTY) return;
      readline.moveCursor(process.stdout, -1, 0);
      readline.clearLine(process.stdout, 1);
      process.stdout.write("*");
    };
    if (isTTY) process.stdin.on("data", onKeypress);
    rl.question(question, (value) => {
      if (isTTY) process.stdin.removeListener("data", onKeypress);
      resolve(value);
    });
  });
}

async function askYesNo(rl, question) {
  const answer = await ask(rl, `${question} [y/N] `);
  return answer.trim().toLowerCase().startsWith("y");
}

async function main() {
  const db = openDb();
  const users = db.prepare("SELECT id, username FROM users").all();

  if (users.length === 0) {
    console.error("No users found. Run Kokpit and complete the setup wizard first.");
    db.close();
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let user;
  if (users.length === 1) {
    user = users[0];
    console.log(`Resetting password for user: ${user.username}`);
  } else {
    console.log("Users:");
    users.forEach((u, i) => console.log(`  ${i + 1}. ${u.username}`));
    const choice = await ask(rl, "Select a user by number: ");
    const index = parseInt(choice, 10) - 1;
    if (isNaN(index) || !users[index]) {
      console.error("Invalid selection.");
      rl.close();
      db.close();
      process.exit(1);
    }
    user = users[index];
  }

  let password;
  for (;;) {
    password = await askHidden(rl, "New password (min 8 characters): ");
    if (password.length < 8) {
      console.log("Password must be at least 8 characters.");
      continue;
    }
    const confirm = await askHidden(rl, "Confirm new password: ");
    if (confirm !== password) {
      console.log("Passwords do not match.");
      continue;
    }
    break;
  }

  const clearTotp = await askYesNo(rl, "Also disable 2FA (TOTP) on this account?");
  const clearRecoveryCode = await askYesNo(rl, "Also invalidate the saved recovery code?");

  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  const updates = ["password_hash = ?"];
  const params = [passwordHash];
  if (clearTotp) updates.push("totp_secret = NULL");
  if (clearRecoveryCode) updates.push("recovery_code_hash = NULL");
  params.push(user.id);

  db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...params);

  console.log(`\nPassword reset for "${user.username}".`);
  if (clearTotp) console.log("2FA has been disabled.");
  if (clearRecoveryCode) console.log("The recovery code has been invalidated — generate a new one from Settings after logging in.");
  console.log("Log out any existing sessions and sign in with the new password.");

  rl.close();
  db.close();
}

main().catch((err) => {
  console.error("Reset failed:", err);
  process.exit(1);
});
