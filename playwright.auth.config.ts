import { defineConfig } from "@playwright/test";
import path from "path";

export default defineConfig({
  globalSetup: "./e2e/auth-global-setup.ts",
  testDir: "./e2e/tests",
  testMatch: "**/auth.spec.ts",
  timeout: 60_000,
  expect: { timeout: 60_000 },
  use: { baseURL: "http://localhost:3001" },
  webServer: {
    command: "sh e2e/start-prod.sh",
    env: {
      // Absolute paths so they survive the `cd` into the standalone dir.
      KOKPIT_DB_PATH: path.resolve("./e2e/fixtures/auth-test-users.db"),
      KOKPIT_CONFIG_PATH: path.resolve("./e2e/fixtures/auth-settings.yaml"),
      PORT: "3001",
    },
    url: "http://localhost:3001",
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
