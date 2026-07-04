import { defineConfig } from "@playwright/test";

export default defineConfig({
  globalSetup: "./e2e/global-setup.ts",
  testDir: "./e2e/tests",
  testIgnore: ["**/auth.spec.ts"],
  // Tests across files share one dev server + settings.yaml (mutated via
  // PATCH /api/settings in beforeEach hooks) — a single worker keeps those
  // writes from racing each other when running outside CI (CI already
  // defaults workers to 1).
  workers: 1,
  // Allow 60 s per test — Next.js dev mode compiles routes on first hit.
  timeout: 60_000,
  // Allow 60 s per assertion to account for lazy route compilation on first hit.
  expect: {
    timeout: 60_000,
    toHaveScreenshot: {
      // Tolerate minor anti-aliasing/font-rendering differences between
      // environments without masking real regressions.
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
    },
  },
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "npm run dev",
    env: {
      KOKPIT_AUTH_DISABLED: "true",
      KOKPIT_CONFIG_PATH: "./e2e/fixtures/settings.yaml",
    },
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
