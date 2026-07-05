# Testing

Three layers, run in this order in CI (`.github/workflows/ci.yml`):

1. **Unit tests** (Vitest + Testing Library + jsdom) — `npm test` / `npm run test:coverage`
2. **E2E tests** (Playwright, real Next.js dev server + mocked upstream services) — `npm run test:e2e`
3. **Auth E2E tests** (Playwright, production build) — `npm run test:e2e:auth`

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
- **Baselines must be generated on the same OS/Chromium build CI uses** (`npx playwright install --with-deps chromium` on `ubuntu-latest`) — screenshots taken on a different Chromium revision or OS will not match pixel-for-pixel. If you need to regenerate baselines locally and can't match CI's environment exactly, prefer letting a CI run produce the "actual" screenshots on a failure, then pull those out of the `playwright-test-results` artifact and commit them as the new baselines, rather than trusting a locally-generated set.
- To regenerate after an intentional UI change: `npx playwright test e2e/tests/visual.spec.ts --update-snapshots`, then review the diffs before committing.

## Known limitation found while adding visual coverage

The default layout (`row_height: 120`, see `settings.example.yaml` / `src/config/schema.ts`) visually clips a widget's stat values when it renders 3+ stats (observed with the Plex widget in the fixture dashboard). Not fixed here since it's a design/config question, not a regression — worth revisiting.
