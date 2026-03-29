import { defineConfig } from "@playwright/test";

export default defineConfig({
  globalSetup: "./e2e/global-setup.ts",
  testDir: "./e2e/tests",
  // Allow 60 s per test — Next.js dev mode compiles routes on first hit.
  timeout: 60_000,
  // Allow 60 s per assertion to account for lazy route compilation on first hit.
  expect: { timeout: 60_000 },
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: [
      "KOKPIT_AUTH_DISABLED=true",
      "KOKPIT_CONFIG_PATH=./e2e/fixtures/settings.yaml",
      "npm run dev",
    ].join(" "),
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
