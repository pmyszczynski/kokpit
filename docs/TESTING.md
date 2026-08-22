# Testing

Three layers, run in this order in CI (`.github/workflows/ci.yml`):

1. **Unit tests** (Vitest + Testing Library + jsdom) — `npm test` / `npm run test:coverage`
2. **E2E tests** (Playwright, real Next.js dev server + mocked upstream services) — `npm run test:e2e`
3. **Auth E2E tests** (Playwright, production build) — `npm run test:e2e:auth`

## Required pre-PR gate

After committing and pushing the intended feature branch, and before opening or
marking a PR ready, run `npm run check:pr`. It requires a clean worktree before
and after validation, runs lint, type-check, unit tests with coverage,
non-visual E2E, and auth E2E, then triggers the Ubuntu snapshot workflow for the
exact pushed commit and byte-compares its artifact with tracked baselines. It
sets `CI=true` so Playwright cannot reuse a stale local server. GitHub CLI must
be installed and authenticated. Focused tests are useful while developing, but
are not a substitute for this gate.

Both Playwright harnesses copy their tracked YAML fixtures into
`test-results/runtime/` before build or startup. Tests and migrations therefore
mutate only ignored runtime copies; a dirty worktree after E2E is a failure, not
expected cleanup.

## Unit tests

`src/__tests__/**` mirrors `src/`. Conventions:

- **API/logic layer** (`<service>.test.ts`): mock `global.fetch`, assert on the parsed return value and on thrown errors (bad HTTP status, schema-invalid JSON).
- **Component layer** (`<WidgetName>.test.tsx`): render the widget component directly via `@testing-library/react` with hand-built `data`/`loading`/`error` props — no network involved. Every widget should cover: normal data, loading (no data), error-only (no data), *stale error* (data present **and** error present — the widget must show both), and the empty/null state's CSS class.

Run `npm run test:coverage` for an HTML + lcov coverage report in `coverage/` (gitignored, uploaded as a CI artifact on every run). Coverage isn't gated by a hard threshold yet — treat drops in `coverage/index.html` as a signal, not a hard gate.

## E2E tests

`e2e/tests/*.spec.ts` run against `npm run dev` with `KOKPIT_AUTH_DISABLED=true` and a fixture `settings.yaml` (`e2e/fixtures/settings.yaml`). Tests mutate shared state via `PATCH /api/settings` and a mock Plex server (`e2e/helpers/mock-plex-server.ts`) — `playwright.config.ts` pins `workers: 1` so these mutations never race across spec files.

### Visual regression (`e2e/tests/visual.spec.ts`)

Screenshot tests catch CSS/layout/theme regressions that DOM assertions can't — a widget can be structurally correct and still render broken. They cover: the dashboard in all four themes, a widget error state, a custom-CSS override, and each Settings tab.

- Screenshots are scoped to `.shell` / `.settings-panel` (not full-page) to avoid viewport/scrollbar flakiness, and mask `.status-dot` (its online/offline result depends on live network state).
- `expect.toHaveScreenshot` defaults to `maxDiffPixelRatio: 0.02` and `animations: "disabled"` (set in `playwright.config.ts`) to absorb minor anti-aliasing differences between environments without hiding real regressions.
- **Baselines must be generated on the same OS/Chromium build CI uses.** The E2E, release, and snapshot-generation jobs are pinned to `ubuntu-24.04`; `npm ci` and the lockfile pin the Playwright/Chromium version.
- After an intentional UI change, run the `Update Playwright snapshots` workflow against the feature branch. With GitHub CLI:

  ```sh
  gh workflow run update-playwright-snapshots.yml --ref <branch>
  gh run watch <run-id> --exit-status
  gh run download <run-id> --name playwright-visual-snapshots --dir e2e/tests
  ```

  Review the resulting PNG diff before committing it. Normal CI never accepts new baselines automatically.
- `npm run check:pr` automatically validates tracked baselines against the
  feature branch's Ubuntu-generated artifact. If it reports differences after
  an intentional CSS, theme, sizing, or layout change, download that named run's
  artifact, review and commit only the intended PNG changes, push, and rerun the
  gate before marking the PR ready.
- When the regular E2E job finds a mismatch, it preserves the failure report first, regenerates all 15 visual baselines in that same runner, and uploads them as the `playwright-visual-snapshots` artifact. Download that artifact into `e2e/tests` instead of regenerating locally.
- After every PR-opening or branch push, inspect the PR check runs directly.
  Do not hand off the PR as ready or complete until its E2E job is green.
