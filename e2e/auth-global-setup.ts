import fs from "fs";
import path from "path";

const DB_PATH = path.resolve("./e2e/fixtures/auth-test-users.db");

export default function globalSetup() {
  try {
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH);
    }
  } catch {
    console.warn("[auth-global-setup] Could not delete auth test DB — tests may see stale state");
  }
}
