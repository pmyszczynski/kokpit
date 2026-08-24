import { defineConfig } from "@playwright/test";

export default defineConfig({
  globalSetup: "./e2e/global-setup.ts",
  testDir: "./e2e/tests",
  testIgnore: ["**/auth.spec.ts"],
  // Tests across files share one dev server + settings.yaml (mutated via
  // PATCH /api/settings in beforeEach hooks) — a single worker keeps those
  // writes from racing each other. Playwright's own default is 50% of CPU
  // cores (not 1), so this must stay explicit even in CI.
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
    // The API persists settings changes, so never point E2E at the tracked
    // fixture. Prepare a disposable copy before starting the test server.
    command: "node ./e2e/prepare-runtime-config.mjs && npm run dev",
    env: {
      KOKPIT_AUTH_DISABLED: "true",
      KOKPIT_CONFIG_PATH: "./e2e/.runtime/settings.yaml",
    },
    url: "http://localhost:3000",
    // An already-running dev server may use a real or tracked config. Always
    // launch this isolated server so E2E writes stay in the runtime copy.
    reuseExistingServer: false,
  },
});
