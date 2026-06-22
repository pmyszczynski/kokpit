import { defineConfig, devices } from "@playwright/test";
import path from "path";

export default defineConfig({
  globalSetup: "./e2e/auth-global-setup.ts",
  testDir: "./e2e/tests",
  testMatch: "**/auth.spec.ts",
  timeout: 60_000,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3001" },
    },
  ],
  webServer: {
    command: "sh e2e/start-prod.sh",
    env: {
      // Absolute paths so they survive the `cd` into the standalone dir.
      KOKPIT_DB_PATH: path.resolve("./e2e/fixtures/auth-test-users.db"),
      KOKPIT_CONFIG_PATH: path.resolve("./e2e/fixtures/auth-settings.yaml"),
      KOKPIT_SESSION_SECRET: "e2e-test-secret-minimum-32-chars-xxxx",
      PORT: "3001",
    },
    url: "http://localhost:3001",
  },
});
