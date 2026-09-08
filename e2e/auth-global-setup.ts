import fs from "fs";
import path from "path";
import { startMockPlexServer } from "./helpers/mock-plex-server";

const DB_PATH = path.resolve("./e2e/fixtures/auth-test-users.db");
// Keep the authenticated suite independent from the default suite's Plex mock
// (which uses 32400) so both can be run without competing for a listener.
const AUTH_MOCK_PLEX_PORT = 32401;

export default async function globalSetup() {
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = DB_PATH + suffix;
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      console.warn(`[auth-global-setup] Could not delete ${p} — tests may see stale state`);
    }
  }

  const plexServer = await startMockPlexServer(AUTH_MOCK_PLEX_PORT);
  // Playwright invokes the returned callback as global teardown, including when
  // a test fails, so the fixed suite port is released reliably.
  return () => plexServer.close();
}
