import fs from "fs";
import path from "path";

const DB_PATH = path.resolve("./e2e/fixtures/auth-test-users.db");

export default function globalSetup() {
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = DB_PATH + suffix;
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      console.warn(`[auth-global-setup] Could not delete ${p} — tests may see stale state`);
    }
  }
}
