# Widget UI library: plan and session handoff

**Start here:** [component and widget tracking tables](widget-component-and-migration-tracker.md).

**Current state:** Immich is fully migrated to the shared library locally. Tokens, body, stat grid/cards, states and stale notice are implemented, tested and preserve the accepted 3x2 appearance. The full local gate passes. Other widgets remain out of scope.

**Planning history:** originally prepared on `codex/widget-consistency-plan` from `30c7861`; planning documents landed in `71e7c8d` and `5a5aa5c`. Check the current branch before implementation.

**Next action:** address the six review comments on [PR #108](https://github.com/pmyszczynski/kokpit/pull/108), as authorized by the owner on 2026-09-22, then validate and push the scoped fixes from `feature/immich-widget-ui`. The larger Immich views remain proposals; other migrations require the owner's next selection. Merge and release are not part of this request.

**Working location:** the branch's checkout; both documents live in `docs/plans/` and are explicitly tracked despite that directory's ignore rule.

## Agreed direction

All widgets should compose a shared UI library. Equivalent elements share their design and behavior; supported variants allow meaningful differences such as color, emphasis and density. Widgets continue to own their data and composition.

Build the library incrementally from patterns in the selected widget. Use **one example widget first** for visual iteration, implementing the components it needs as a complete slice. After the owner accepts that example, migrate other widgets individually in the order they choose. The tables are a backlog and progress record, not authorization to work through everything automatically.

This plan supersedes the earlier broad widget-consistency proposal: its three-widget pilot, bulk family migrations, mandatory all-widget baseline before starting, and proposed mobile expansion are not the execution plan. The owner requested this smaller, controlled approach.

## Agreed organization and naming

Group components by responsibility under `src/widgets/ui/`. Each React component has its own directory containing its implementation, styles, tests and export. Create directories as their components are implemented; this is the target structure, not an instruction to scaffold the entire library now.

```text
src/widgets/ui/
├── index.ts
├── foundation/
│   └── tokens.css
├── layout/
│   ├── WidgetBody/
│   ├── WidgetStatGrid/
│   └── WidgetList/
├── data-display/
│   ├── WidgetStat/
│   │   ├── WidgetStat.tsx
│   │   ├── WidgetStat.test.tsx
│   │   ├── WidgetStat.css
│   │   └── index.ts
│   ├── WidgetStatRow/
│   ├── WidgetListItem/
│   ├── WidgetBadge/
│   ├── WidgetStatusDot/
│   ├── WidgetBar/
│   └── WidgetMiniChart/
└── feedback/
    ├── WidgetState/
    └── WidgetStaleNotice/
```

Every component directory follows the expanded `WidgetStat/` example. Component-specific helpers and types stay alongside it when needed. Whole-widget browser tests remain in `e2e/`. `WidgetTokens` is the tracker name for `foundation/tokens.css`, not a React component.

The root `index.ts` exposes the public API, so integrations import from `@/widgets/ui` without depending on the internal groups. Each component imports its colocated CSS, and the public entry loads foundation tokens; adding a component requires no app-layout stylesheet registration. Colocated CSS still follows the shared cascade-layer and custom-CSS override requirements below. Shared component roots and migrated widget bodies use the `widget-ui` class to opt into the foundation reset inside that layer; unselected widgets keep the existing reset precedence.

| Group | Responsibility |
| --- | --- |
| `foundation` | Shared spacing, typography, surfaces, borders, radii and color tokens. |
| `layout` | Body composition, stat-grid placement and one deliberate list scroll region with optional fixed header/footer. |
| `data-display` | Reusable presentation of values, collection items, statuses, bars and small charts. |
| `feedback` | Accessible state and stale-data notices; fetching and state selection remain with their existing owners. |

The agreed names distinguish these patterns:

- `WidgetStat` displays one labeled value, optionally with a unit or supporting value. Card and plain appearances are variants. Values accept already-formatted React content so integrations can retain their formatters and Actual Budget's `Amount` component.
- `WidgetStatGrid` arranges stats and owns columns, gaps and full-width placement; individual stats do not choose their grid position.
- `WidgetStatRow` displays one measurement horizontally, such as memory used/total, with an optional bar. `WidgetListItem` displays one item in a collection, such as a torrent or Docker container, with integration-supplied fields and semantics.
- `WidgetBar` is a horizontal track with a filled portion. Task progress and resource usage retain distinct accessible semantics. Clamp the visual fill while preserving domain values such as 120% budget usage.
- `WidgetMiniChart` is a compact history line chart, typically without axes or detailed labels. Start from Netdata's existing local `Sparkline`; the new name does not expand scope to other chart types.

These names and groups are agreed; exact props, token values and variants are settled through selected examples. The library owns presentation, layout and accessibility. Integrations retain data, formatting, status meanings, privacy and composition. `WidgetBody` reserves a separate stale-notice slot; the service header and outer tile geometry stay outside it. Changes to shared initial-state presentation in `WidgetRenderer` need a deliberate rollout because they affect other widgets.

## How to work on the next step

1. Read this file, both [tracking tables](widget-component-and-migration-tracker.md), applicable `AGENTS.md`, and the current branch/diff. Preserve unrelated work. Confirm the owner-selected component/widget from the session; if none is selected, ask which step to start.
2. Inspect that component's existing consumers and variants before defining its shared contract. Keep the work bounded to the selected step. Read the relevant installed Next.js guide before application code changes.
3. Mark the selected component `in progress`. Define its minimal props, supported variants, tokens, fit/overflow behavior and accessible semantics. Implement in its group/component directory under `src/widgets/ui/` using the current React/CSS approach; add no design-system dependency by default.
4. Introduce it only in the selected example widget. While the first example is being developed, keep all other widgets on their current implementations. Shared CSS must be scoped so they do not change accidentally.
5. Show before/after browser evidence on that widget's supported footprints, including large values, long text and stale-data errors. Iterate on the visual result with the owner. Do not declare a component `done` based on code completion alone.
6. Update component and widget rows, evidence links and the session handoff below. Commit the scoped change after required validation. Wait for the owner's next selection; do not start another widget or component on the strength of the backlog alone.

A later widget may introduce a primitive the first example did not need (for example, a progress bar or chart). Build that primitive when its selected widget needs it, with the same visual review loop. Do not put artificial content into the first example to demonstrate every library component.

## Selected first example

Immich is the selected pilot for shared tokens, body, stat grid/cards and feedback. The owner approved a **3x2 summary with Storage and Items** (photos + videos). Use repeatable dashboard sizes; Immich currently supports only 3x2. Richer 3x4/6x4 views remain proposals; do not introduce five-row sizes. Larger views should add useful administration data, particularly per-user usage/quota, rather than split photo/video counts or sizes.

The two-stat summary supports only 3x2. The owner requested removal of 6x2 because it duplicated the same content without adding value. The owner explicitly requested completion of the library migration: the body, grid and all feedback presentation now use shared components. Do not leave local presentation implementations in Immich or automatically migrate other widgets.

Fit strategy: retain the earlier stacked stat cards: value above label, 6px vertical / 4px horizontal padding, 16px values and 11px labels. Group the service name and description beside the icon through an explicit desktop compact-header opt-in, used only by Immich. This recovers body space without shrinking stat padding. Preserve full accessible service text and single-line visual descriptions. Keep stale data and a brief visible refresh warning with the complete error accessible. Reserve the notice row even when healthy so card positions never move during refresh failure or recovery. Verify real tile, card and text bounds, including long names/descriptions and large numbers. No summary scrolling or clipped numerical values.

## Rules the library must enforce

- Use shared components and tokenized variants for equivalent elements. Integration-specific colors are acceptable; independent radius, spacing, typography or overflow implementations need a documented semantic reason.
- Stat cards, status badges, list rows and charts remain distinct patterns. Favor a small composition API over a universal configurable widget component.
- Fit against the **available widget body**, not just the outer footprint. Headers, descriptions, padding and stale notices consume space. Lists may deliberately scroll vertically; summary clipping is not a fit strategy.
- Keep data fetching, polling, units/formatters, domain status mappings, API/config contracts, Actual Budget privacy, and the dashboard grid unchanged. Retain integration class hooks where practical.
- Preserve initial loading/error ownership in `WidgetRenderer`, domain empty/partial states in widgets, and stale data plus an accessible refresh-error notice.
- Scope migrated styles in an appropriate layer before `user-custom` and remove their superseded unlayered rules. Prove ordinary custom CSS can override them without `!important`. Do not turn this into an unrelated app-wide CSS rewrite.
- Mobile summaries and further footprint changes require selection. Size-specific Immich content is now approved; shared components do not choose that content. Current mobile fallback remains unchanged until explicitly selected as work.
- Once a component is accepted, new or migrated equivalent UI uses it. Review/test evidence should catch new style forks; expand an intentional shared variant rather than copying markup/CSS into another widget.

## Validation and completion

For each implementation step, run focused behavior tests and real-browser checks of the selected widget. Verify its declared footprints, four themes, ordinary custom-CSS overrides, loading/empty/error/stale states and relevant long/large content. Measure text/cell bounds and inner scroll dimensions so an outer clipping rule cannot produce a false pass. Preserve keyboard/accessibility behavior and deliberately scrollable lists. Add fixtures as widgets are selected, not all 28 before the first component.

A component is `done` after implementation, tests and owner visual acceptance in an example widget. Its final state is `migration of all widgets complete` only after every intended consumer adopts it. A widget stays `todo` during partial adoption and becomes `migrated` only after all applicable components and variants are verified. Record evidence in the tables with each change; do not rely on chat history.

Follow `AGENTS.md` for the required pre-commit validation sequence: lint, type-check, coverage, nonvisual E2E and production-auth E2E, each with `CI=true`. Commits stay scoped to the selected work. Push, PR and merge state must be reported separately and must not be implied by a local commit.

## Evidence and constraints for future sessions

Source audit baseline: `30c7861` (28 registrations in [src/integrations/index.ts](../../src/integrations/index.ts)). The tracker links every current widget implementation. Similar stat markup currently shares some CSS in [globals.css](../../src/app/globals.css), but Immich, Radarr, Seerr and other families diverge. [Netdata Sparkline](../../src/integrations/netdata/Sparkline.tsx) and [Actual Amount](../../src/integrations/actualbudget/Amount.tsx) are existing local shared helpers; their existence does not mean the new library migration is done.

[ServiceTile](../../src/components/ServiceTile.tsx), [WidgetRenderer](../../src/components/WidgetRenderer.tsx) and [grid geometry](../../src/layout/grid.ts) own the rendering/footprint boundary. None of the 28 widgets currently declares a mobile renderer, so they become service links below 720px. The `dimensions` prop describes the outer tile, not measured body space. Existing [Prowlarr](../../e2e/tests/prowlarr-widget.spec.ts) and [Plex](../../e2e/tests/plex-widget.spec.ts) browser tests are useful starting points; component tests alone cannot prove visual fit.

Observed source facts establish the inventory; agreed library names and groups describe the target organization, while consumer mappings describe intended adoption. Exact component APIs, token values and fit failures remain to be validated in the selected example. If a source discovery or owner decision changes component boundaries, update both tables and this plan before continuing dependent implementation.

## Current pilot grounding

### Objective and confirmed facts

- **Authorized:** complete the Immich library migration with `WidgetBody`, `WidgetStatGrid`, `WidgetStat`, `WidgetState`, `WidgetStaleNotice` and shared tokens; preserve 3x2 Storage + Items. Preserve the grouped library structure. Do not migrate other widgets.
- **Geometry:** `src/layout/grid.ts` gives 3x2 = 340x128px and 6x2 = 688x128px. `ServiceTile` owns header, description and outer spacing. Its existing body is only 46px without a description. The former five-stat grid measured 146px: `/tmp/kokpit-widget-pilot/baseline.json`.
- **Data:** `src/integrations/immich/api.ts` supplies `usage`, `photos`, `videos`; Items is their count sum. Formatting stays in the integration. Fetching, refresh interval, configuration and mobile service-link fallback remain unchanged.
- **State ownership:** `WidgetRenderer` handles initial loading/error; `useWidget` retains successful data after refresh errors. The widget chooses the domain-empty state and supplies errors to library feedback components. Initial-state ownership stays in WidgetRenderer; an explicit shared-UI registration opt-in changes only Immich presentation.
- **CSS:** shared component styles live before `user-custom`. The `widget-ui` reset opt-in preserves unmigrated widgets. A global reset-layer change was rejected after Chromium showed changed Tautulli padding. Installed Next.js CSS guidance was reviewed.

### Foundational correction — 2026-09-21

The owner rejected preserving five measurements at every size and requested repeatable footprints with progressively useful content. This invalidates the five-stat acceptance criteria and the 3x5/6x5 previews. Update production composition, unit expectations and browser fixtures together. Old five-row screenshots are historical evidence only. All pending completion claims must be revalidated for the compact summary.

### Visual correction — restore the earlier cards

The owner rejected the horizontal 2px-padding stats. Restore the earlier stacked card look; keep Storage + Items and the 3x2/6x2 registrations. The current separate description row leaves only about 53px for the body, less than a 49px stacked card plus an 18px stale notice. `ServiceTile` owns that space: add an optional `compactHeader` definition hint to group name/description alongside the icon on desktop only. Other widgets, invalid-config tiles and mobile fallback keep their existing composition. Remove the now-unused inline stat variant rather than preserving a rejected pilot API. Recheck fit, service-text accessibility, stale data, and custom CSS; prior horizontal-card screenshots are superseded.

### Warning stability correction

The owner accepted the stacked-card appearance but rejected movement when a refresh warning appears. The conditionally mounted notice currently consumes flex space and shifts the centered cards. Implemented a permanent notice slot after the grid with the same one-line height and padding in healthy and error states; accessible warning content is mounted only on error. Preserve card padding, fonts and fixed 3x2/6x2 geometry. Verify exact tile/card bounds across healthy, failed refresh and recovery in the browser; static screenshots alone did not establish stability.

### Footprint correction — remove duplicate wide summary

The owner requested removal of Immich 6x2. Remove its `supportedFootprints` entry and corresponding current test-matrix expectation; keep the default 3x2, card styling and stable warning row. Size choices derive from widget registration. `src/config/loader.ts` detects unsupported saved footprints and persists the supported fallback during load/migration, so existing 6x2 Immich tiles become 3x2. ServiceForm and the edit-grid size menu both derive choices from registration; ServiceTile also defends against unsupported render-time footprints. No migration code change is needed. Earlier two-footprint test results below are historical evidence.

### Ownership correction — complete the shared library slice

The owner clarified that the pilot must use the library for all applicable presentation. Calling the Stat-only pilot finished was incorrect. The earlier instruction to retain local grid/state markup is superseded.

- `WidgetBody`: flex body, optional centered state layout, and a permanently reserved notice slot whenever `reserveNotice` is true. `notice` is renderable content; fetching and error selection stay outside. Defaults must reproduce current Immich body/18px notice row exactly.
- `WidgetStatGrid`: reusable columns (default 2), shrinkable grid and centered composition with the existing 6px gap; no domain selection or number formatting.
- `WidgetStaleNotice`: error-only accessible alert, short visible copy, full error title/accessibility text, no slot sizing. An absent error renders nothing; Body still reserves its slot.
- `WidgetState`: loading, error and empty presentation. A `sharedUI` widget-registration flag opts Immich into this component in WidgetRenderer for initial states; untouched widgets keep legacy presentation. Direct Immich null-data rendering also uses this shared state component.
- Components use group/component folders with colocated TSX/CSS/tests/index exports, the public library barrel, shared tokens and the `widget-ui` cascade layer. Preserve practical Immich class hooks while removing every Immich presentation rule from globals. ServiceTile header chrome remains shared infrastructure outside the widget library.
- Validation: colocated semantic/slot tests, integration and renderer selection tests, existing browser fit/theme/state/custom-CSS checks, exact healthy/failure/recovery bounds and before/after screenshot comparison. Run the full local gate for this completed slice. No new larger footprint, API request or other-widget migration is authorized by this step. The owner separately authorized commit, push, PR creation and CI/review monitoring on 2026-09-22.

### Larger-view research (proposal, not implemented)

- **Per-user storage and quota pressure:** existing `/server/statistics` includes `usageByUser` with names, usage, counts and quotas. Requires the existing admin `server.statistics` permission. Extend the local schema explicitly when selected; no extra request is needed. Null quota means unlimited; handle zero without division. [Official DTO](https://github.com/immich-app/immich/blob/main/server/src/dtos/server.dto.ts).
- **Disk available:** `/server/storage` with `server.storage` permission reports the filesystem containing the library. This is distinct from asset-size statistics, which exclude external-library assets. [Official service implementation](https://github.com/immich-app/immich/blob/main/server/src/services/server.service.ts).
- **Processing failures/backlog:** useful but requires version/capability handling because `/jobs` is deprecated and `/queues` is a newer API. Defer until compatibility is established. [Official queue controller](https://github.com/immich-app/immich/blob/main/server/src/controllers/queue.controller.ts).
- Proposed next 3x4 view: retain Storage + Items and add a few users ranked by storage usage, with quota pressure visible. A future 6x4 view can show more users and a separate disk-headroom summary. These are recommendations; the number of rows and fit remain to be selected and measured. Do not infer last login/upload or backup health from unrelated fields.

### Validation ledger

- **Complete migration:** Immich imports `WidgetBody`, `WidgetStatGrid`, `WidgetStat`, `WidgetState` and `WidgetStaleNotice` through `@/widgets/ui`. Each component has colocated CSS/tests/exports; shared tokens live in `foundation/tokens.css`. No Immich layout, grid or feedback CSS remains in globals or the library. Integration class names remain as compatibility hooks only.
- **State ownership:** `sharedUI: true` opts Immich into library loading/error presentation in WidgetRenderer; fetching and state selection remain in the renderer/hook. Unselected widgets retain legacy presentation. Domain-empty handling is selected in Immich and presented through the library. ServiceTile retains shared header chrome.
- **Visual preservation:** healthy and stale 3x2 screenshots are byte-for-byte identical before/after extraction: `/tmp/kokpit-widget-pilot/library-before-{healthy,error}.png` versus `stable-warning-{healthy,error}.png`. SHA256: healthy `596b4d263884fda2fc3f803c910a1b64682fcc4c4caf338f63c180e1f711b768`, stale `475d964ddc569fad00638989a2c493e2f8051ac3c7801dfb139696f82895b694`. The owner accepted this appearance earlier; there is no new visual design to approve.
- **Browser evidence:** all six Immich checks pass: four themes, real 340x128 geometry, large values, long service text, loading/error/empty states, custom CSS for cards/grid/body tokens, exact tile/card bounds through healthy → failed refresh → recovery.
- **Full local gate:** `CI=true npm run lint`, `type-check`, `test:coverage`, `test:e2e:nonvisual`, `test:e2e:auth` all pass. Coverage: 2,075 tests / 132 files. Nonvisual browser tests: 36. Production-auth browser tests: 21, including the production build. Lint retains the pre-existing Netdata unused-import warning.
- **Review and cleanup:** independent architecture/correctness review found no material runtime issue; requested tracker/status and test-fixture cleanup completed. Fixture YAML and generated backup files were restored/removed after testing.
- **Publication:** the owner authorized push, PR creation and CI/review monitoring on 2026-09-22. Branch: `feature/immich-widget-ui`, based on current `origin/main` (`5a5aa5c`). Re-run the full local gate immediately before committing; verify remote checks and review threads on the published PR. No merge or release is authorized.

## Session handoff

- **Completed slice:** six library entries are `done`; Immich is `migrated` and displays only Storage + Items at 3x2 with a permanent warning slot.
- **Remaining scope:** seven other library entries and 27 other widget migrations are `todo`. Extend components only when a subsequently selected widget needs another variant.
- **Next action:** complete the authorized PR delivery and monitor CI/review findings. After delivery, wait for the owner's next selection; the larger per-user/quota views remain proposals and other widget migrations are not authorized.
- **Delivery:** use `feature/immich-widget-ui`; local validation and remote CI are separate gates. Consult the PR for current check/review status; this plan does not imply merge or release.

### PR #108 review follow-up — 2026-09-22

- **Confirmed baseline:** published head `6ac0d90`; all checks passed. Six Cubic P3 threads identify temporary screenshot paths, a tautological route assertion, missing reduced-motion handling, a missing legacy-error negative assertion, duplicated class-name helpers and app-owned library CSS imports. The owner explicitly selected all six fixes.
- **Style ownership correction:** components import their colocated styles and the public library entry imports foundation tokens. The app layout's per-component CSS list is removed; retain existing cascade layers, selectors and visual tokens. Installed Next.js App Router CSS guidance permits component imports; verify both dev-browser behavior and the production build.
- **Implemented:** one internal class-name helper replaces all five copies; the shared spinner stops under reduced motion. Browser tests no longer write manual `/tmp` screenshots or assert on a preassigned resolver. They check animation preference changes while loading; the renderer unit test also verifies legacy errors retain their old class and lack the shared state class. Immich content/geometry, fetching and other widgets stay unchanged.
- **Validation:** rerun the complete required local gate after final edits, review the full PR diff, push fixes and verify current-head CI. No merge or release.
