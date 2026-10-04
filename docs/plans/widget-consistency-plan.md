# Widget UI library: plan and session handoff

**Start here:** [component and widget tracking tables](widget-component-and-migration-tracker.md).

**Current state:** Immich, qBittorrent Stats, Prowlarr Stats and Radarr Stats are migrated. The owner accepted the shared color design with informational blue category counts. SABnzbd is the next selected migration, implemented with two shared cards at 3x2, three at retained 6x2, and six at 3x4; its browser preview has been presented. The owner authorized publishing the combined PR, monitoring CI and AI reviews, then merging and releasing after findings and checks are clear. Target release: v0.16.0.

**Planning history:** originally prepared on `codex/widget-consistency-plan` from `30c7861`; planning documents landed in `71e7c8d` and `5a5aa5c`. Check the current branch before implementation.

**Next action:** monitor independent CI plus review rounds for the published [PR #119](https://github.com/pmyszczynski/kokpit/pull/119) (AI feedback can take about 15 minutes per round). Address findings, repeat required validation after edits, and merge only when checks/reviews are clear. The version bump to 0.16.0 is included in the selected PR; after merge, run release.yml on main and verify Docker publication. Do not start another widget migration.

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

- `WidgetStat` currently displays one labeled value in a stacked card, with caller-formatted React content and a semantic tone. Plain appearances and dedicated unit/subvalue slots are future variants for subsequently selected widgets; they are not part of the shipped API. Caller content can retain integration formatters and Actual Budget's `Amount` component.
- `WidgetStatGrid` arranges stats in 1–4 columns with shared gaps; Radarr adds an accepted six-column variant for its retained wide footprint. Full-width placement is a future extension for a selected consumer; individual stats do not choose their grid position.
- `WidgetStatRow` displays one measurement horizontally, such as memory used/total, with an optional bar. `WidgetListItem` displays one item in a collection, such as a torrent or Docker container, with integration-supplied fields and semantics.
- `WidgetBar` is a horizontal track with a filled portion. Task progress and resource usage retain distinct accessible semantics. Clamp the visual fill while preserving domain values such as 120% budget usage.
- `WidgetMiniChart` is a compact history line chart, typically without axes or detailed labels. Start from Netdata's existing local `Sparkline`; the new name does not expand scope to other chart types.

These names and groups are agreed; exact props, token values and variants are settled through selected examples. The library owns presentation, layout and accessibility. Integrations retain data, formatting, status meanings, privacy and composition. `WidgetBody` reserves a separate stale-notice slot; the service header and outer tile geometry stay outside it. Changes to shared initial-state presentation in `WidgetRenderer` need a deliberate rollout because they affect other widgets.

## Stat color meanings

The owner requested consistent color-coded stats after reviewing the Radarr preview on 2026-10-04. Apply these shared `WidgetStat` tones to existing migrated consumers and use them as the starting contract for subsequent selected migrations. The widget chooses the domain meaning; the library owns the theme-aware color. Keep card surfaces and labels unchanged, retain visible labels/values, and avoid making color the only status cue.

| Shared tone | Meaning | Current examples |
| --- | --- | --- |
| `positive` / green | Available, enabled or active data. For paired transfer directions, green denotes incoming/download data. | Radarr Available; Prowlarr Enabled; qBittorrent download speed/total and positive Active count. |
| `info` / blue | Informational inventory, categories, storage, cumulative counts and upcoming data. Blue denotes outgoing/upload data when paired with green download data. | Radarr Total/Upcoming; Prowlarr Indexers/Total Grabs/Usenet/Torrent; Immich Storage/Items; qBittorrent upload speed/total. |
| `warning` / amber | Work awaiting attention or completion, when its count is positive. | Radarr Wanted/Queued. |
| `alert` / red | A reported problem, when its count is positive. | Radarr Missing; Prowlarr Failing. |
| `neutral` / theme text | Inactive/stopped states, absent measurements, or zero pending/problem counts. | qBittorrent Inactive and unavailable activity; zero Missing/Failing/Wanted/Queued. |

Do not mark Inactive torrents as warning: their count includes stopped/paused torrents, not only queued work. Protocol/category counts use informational blue, including zero counts; they do not indicate health or inactivity. Storage usage alone is informational; Immich does not provide a capacity/quota threshold that establishes a warning. An inactive system is not necessarily unhealthy. Transfer hues indicate direction, not success/failure. Active qBittorrent counts are neutral when zero or unavailable.

Future mappings should retain domain-specific meaning: Seerr pending/available counts can use amber/green; Tdarr errored/queued/space-saved metrics can use red/amber/green; Unraid disk errors can use red when positive; Actual Budget overspending can use red while preserving its existing amount sign/privacy semantics. CPU/RAM/disk utilization needs a meaningful domain threshold before using warning/error tones. This color policy does not itself start those widget migrations.

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

Fit strategy: retain the earlier stacked stat cards: value above label, 6px vertical / 4px horizontal padding, 16px values and 11px labels. Group the service name and description beside the icon through an explicit desktop compact-header opt-in, originally introduced for Immich and subsequently adopted by qBittorrent Stats and Prowlarr Stats. This recovers body space without shrinking stat padding. Preserve full accessible service text and single-line visual descriptions. Keep stale data and a brief visible refresh warning with the complete error accessible. Reserve the notice row even when healthy so card positions never move during refresh failure or recovery. Verify real tile, card and text bounds, including long names/descriptions and large numbers. No summary scrolling or clipped numerical values.

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
- **Geometry:** Immich supports only 3x2 = 340x128px. `ServiceTile` owns header, description and outer spacing. Historical baseline: the removed Immich 6x2 option measured 688x128px; before the compact header, the 3x2 body was 46px without a description and the former five-stat grid measured 146px (`/tmp/kokpit-widget-pilot/baseline.json`).
- **Data:** `src/integrations/immich/api.ts` supplies `usage`, `photos`, `videos`; Items is their count sum. Formatting stays in the integration. Fetching, refresh interval, configuration and mobile service-link fallback remain unchanged.
- **State ownership:** `WidgetRenderer` handles initial loading/error; `useWidget` retains successful data after refresh errors. The widget chooses the domain-empty state and supplies errors to library feedback components. Initial-state ownership stays in WidgetRenderer; an explicit shared-UI registration opt-in changes only Immich presentation.
- **CSS:** shared component styles live before `user-custom`. The `widget-ui` reset opt-in preserves unmigrated widgets. A global reset-layer change was rejected after Chromium showed changed Tautulli padding. Installed Next.js CSS guidance was reviewed.

### Completed design decisions (historical)

These notes explain earlier decisions; the selected-example section above describes current behavior.

#### Foundational correction — 2026-09-21

The owner rejected preserving five measurements at every size and requested repeatable footprints with progressively useful content. This invalidates the five-stat acceptance criteria and the 3x5/6x5 previews. Update production composition, unit expectations and browser fixtures together. Old five-row screenshots are historical evidence only. All pending completion claims must be revalidated for the compact summary.

#### Visual correction — restore the earlier cards

The owner rejected the horizontal 2px-padding stats. The stacked cards were restored with Storage + Items; 3x2 and 6x2 were supported at that stage, before the subsequent wide-summary removal. The earlier separate description row left only about 53px for the body, less than a 49px stacked card plus an 18px stale notice. `ServiceTile` owns that space: add an optional `compactHeader` definition hint to group name/description alongside the icon on desktop only. Other widgets, invalid-config tiles and mobile fallback keep their existing composition. Remove the now-unused inline stat variant rather than preserving a rejected pilot API. Recheck fit, service-text accessibility, stale data, and custom CSS; prior horizontal-card screenshots are superseded.

#### Warning stability correction

The owner accepted the stacked-card appearance but rejected movement when a refresh warning appears. The former conditionally mounted notice consumed flex space and shifted the centered cards. Implemented a permanent notice slot after the grid with the same one-line height and padding in healthy and error states; accessible warning content is mounted only on error. Card padding, fonts and the then-supported 3x2/6x2 geometry were preserved; only 3x2 remains supported after the next correction. Verify exact tile/card bounds across healthy, failed refresh and recovery in the browser; static screenshots alone did not establish stability.

#### Footprint correction — remove duplicate wide summary

The owner requested removal of Immich 6x2. Its `supportedFootprints` entry and test-matrix expectation were removed; keep the default 3x2, card styling and stable warning row. Size choices derive from widget registration. `src/config/loader.ts` detects unsupported saved footprints and persists the supported fallback during load/migration, so existing 6x2 Immich tiles become 3x2. ServiceForm and the edit-grid size menu both derive choices from registration; ServiceTile also defends against unsupported render-time footprints. No migration code change is needed. Earlier two-footprint measurements are historical evidence.

#### Ownership correction — complete the shared library slice

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
- **Initial migration local gate (before review follow-ups):** `CI=true npm run lint`, `type-check`, `test:coverage`, `test:e2e:nonvisual`, `test:e2e:auth` all pass. Coverage: 2,075 tests / 132 files. Nonvisual browser tests: 36. Production-auth browser tests: 21, including the production build. Lint retains the pre-existing Netdata unused-import warning.
- **Review and cleanup:** independent architecture/correctness review found no material runtime issue; requested tracker/status and test-fixture cleanup completed. Fixture YAML and generated backup files were restored/removed after testing.
- **Publication:** the owner authorized push, PR creation and CI/review monitoring on 2026-09-22. Branch: `feature/immich-widget-ui`, based on current `origin/main` (`5a5aa5c`). Re-run the full local gate immediately before committing; verify remote checks and review threads on the published PR. No merge or release is authorized.

## Immich session handoff — historical

This records the completed Immich session; the current state and next action at the top of this document supersede its remaining-scope and next-selection notes.

- **Completed slice:** six library entries are `done`; Immich is `migrated` and displays only Storage + Items at 3x2 with a permanent warning slot.
- **Remaining scope:** seven other library entries and 27 other widget migrations are `todo`. Extend components only when a subsequently selected widget needs another variant.
- **Historical delivery:** PR #108 merged as `13ef0a9` and the v0.13.0 version commit is `1999a7e` in the current checkout's history. The older PR review instructions below are retained as history, not pending work. Remote release state and live deployment are separate from this local-history observation.
- **Next selected slice:** qBittorrent Stats, described below. Do not infer selection of another widget or larger Immich variant.

### PR #108 review follow-up — 2026-09-22

- **Confirmed baseline:** published head `6ac0d90`; all checks passed. Six Cubic P3 threads identify temporary screenshot paths, a tautological route assertion, missing reduced-motion handling, a missing legacy-error negative assertion, duplicated class-name helpers and app-owned library CSS imports. The owner explicitly selected all six fixes.
- **Style ownership correction:** components import their colocated styles and the public library entry imports foundation tokens. The app layout's per-component CSS list is removed; retain existing cascade layers, selectors and visual tokens. Installed Next.js App Router CSS guidance permits component imports; verify both dev-browser behavior and the production build.
- **Implemented:** one internal class-name helper replaces all five copies; the shared spinner stops under reduced motion. Browser tests no longer write manual `/tmp` screenshots or assert on a preassigned resolver. They check animation preference changes while loading; the renderer unit test also verifies legacy errors retain their old class and lack the shared state class. Immich content/geometry, fetching and other widgets stay unchanged.
- **Validation:** rerun the complete required local gate after final edits, review the full PR diff, push fixes and verify current-head CI. No merge or release.

### Final review grounding — 2026-09-22

- **Baseline:** `aa6713f` is published with green checks and six original threads resolved. The owner authorized this remaining review pass. Seven subsequent P3 threads cover documentation clarity, null content, absent error copy, locale expectations and changing-error announcements.
- **Verified at the baseline:** WidgetState checked only undefined, while Immich supplied null in its blank state. WidgetState also permitted absent error children. The warning changed only attributes for a new error. Playwright Test's installed fixture defaults locale to en-US, so the claimed host-locale instability is not reproduced.
- **Implemented:** empty/error states omit null/undefined children and preserve zero; a changed error replaces the warning alert node with atomic announcement semantics, while an unchanged error preserves the node. Unit tests cover these contracts; browser tests cover consecutive different errors, accessible names, stable geometry and recovery. The existing en-US test locale is explicit; application localization is unchanged.
- **Accessibility evidence:** [W3C Alert Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/alert/) describes dynamically rendered alerts. Verify alert-node replacement and accessible text in the browser; do not claim an actual screen-reader speech test.
- **Documentation:** distinguish implemented card stats from future plain stats; mark removed 6x2/earlier measurements as historical; replace stale next-action instructions with PR verification. No other widget, larger layout or merge/release work is selected.

- **Delivery verification:** run the complete local gate before committing these follow-ups and verify current-head checks/thread resolution on PR #108. Automated tests verify DOM/accessibility contracts; actual assistive-technology speech remains untested.

## qBittorrent Stats slice — 2026-09-27

### Grounding and owner decisions

- **Scope:** migrate only `qbittorrent-stats` to the six applicable existing library entries. Preserve its 10-second polling, formatting, configuration and four transfer values; extend the 3x4 data fetch for the selected torrent activity summary. Initial loading/error presentation opts into `WidgetRenderer`'s shared UI; qBittorrent retains domain-empty selection and stale-data error selection.
- **Owner-selected content and footprints:** 3x2 shows only current download and upload speeds. 3x4 shows the four speed/total values plus Active and Inactive counts in a two-column, three-row grid using the same stat-card sizing tokens as Immich; the current count contract is in the activity-count correction below. Retain 6x2 with all four transfer cards in one row. There is no 3x3 option. An existing saved 6x2 footprint remains supported. In the absence of a specified default, use the compact 3x2 option for newly added tiles; this is a reversible implementation choice.
- **Observed geometry:** the current 6x2 uses two rows of cards in a 688x128px tile, with vertical scrolling and value ellipsis. A temporary browser fixture with large formatted values and a visible refresh warning measured 73px of vertical overflow. Browser prototypes of the 3x4 two-row composition and the 6x2 four-column composition fit without scroll. 3x2 with four cards did not fit; the selected speed-only content must be measured separately. Temporary review tests were removed; the worktree was clean before this slice began.
- **Boundaries:** `WidgetBody` owns the reserved warning row; `WidgetStatGrid` and `WidgetStat` own card presentation. The integration chooses which values appear at each footprint and supplies formatted strings and activity counts. `ServiceTile` owns the header and outer tile. Compact-header use and final fit must be proven with real browser measurements, including long names and descriptions.
- **Counterexample checked:** an earlier 3x3 proposal fit in isolation but is superseded by the owner's selection of established 3x2/3x4/6x2 sizes. Do not carry its footprint or migration assumption into code, tests or documentation.

### Implementation and validation

1. Update registration with the selected footprints and explicit per-footprint content. Use 3x2 as the first/default option and `preferredSize: normal`; preserve existing saved 6x2 tiles and legacy `size: wide` mappings.
2. Replace qBittorrent's legacy card, grid, empty and stale-notice presentation with shared components. Remove only superseded qBittorrent selectors from the existing grouped unlayered CSS; preserve other widgets' styling.
3. Verify all three real footprints, all four themes, long values and service text, initial loading/error/empty, stale error/recovery with stable card bounds, ordinary custom-CSS override, and no clipped text or summary scrolling. Update unit and browser tests and the component/widget tracker evidence.
4. Run the required full local gate immediately before commit. Report local validation, commit/push, remote CI and release state separately.

### 3x4 activity correction — 2026-09-29

- **Owner decision:** keep the four transfer values and their shared stat-card design, and add four live counts: Downloading, Seeding, Stalled and Queued. Do not add these counts to 3x2 or 6x2. The initial middle-strip placement was later rejected; see the visual model correction below. The earlier taller-card, chart and connection/limit treatments are superseded.
- **Observed data flow:** the saved tile has a normalized footprint in the config snapshot; `GET /api/widget` currently passes only config and abort signal to the registered fetch function. `fetchTransferInfo` reads `/api/v2/transfer/info` and parses only four values. `/api/v2/torrents/info` exposes each torrent's `state`, but Kokpit's existing Torrents widget parser does not retain it. The widget test endpoint has no tile footprint. The source for qBittorrent state names is the official [WebUI API torrent list](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-%28qBittorrent-5.0%29#get-torrent-list).
- **Fetch contract change:** add optional, server-derived tile-footprint context to the legacy widget fetch callback. The qBittorrent Stats fetch requests torrent states only for a saved 3x4 tile; the other footprints and the unsaved connection test continue to read transfer info alone. Keep the existing auth, credential scope, hard timeout and abort path. This is a narrow shared interface extension, not a new client query parameter.
- **Count semantics:** categories are mutually exclusive. Downloading counts `downloading`, `forcedDL` and `metaDL`; Seeding counts `uploading` and `forcedUP`; Stalled counts `stalledDL` and `stalledUP`; Queued counts `queuedDL` and `queuedUP`. Paused/stopped, checking, allocating, moving, errors, missing files and unknown future states are omitted rather than mislabeled. These four counts do not claim to partition all torrents.
- **Partial failure:** transfer-info failure retains the existing whole-widget stale/error behavior. If only the additional torrent-state request fails or reaches its optional 1.5-second deadline, show the four transfer cards with an explicit activity-unavailable state; never turn missing activity into zero counts. Parent/route cancellation still propagates.
- **Validation:** test fetch selection by footprint, state classification and unknown states, authentication/session reuse, abort and partial failure. In the browser, verify all eight 3x4 cards in all themes with zero/large counts, state failure and stale refresh, stable card bounds, no clipping/scroll, and ordinary user CSS overrides. Recheck 3x2 and 6x2 unchanged.

### Validation ledger for this slice

- **Focused browser check:** the [qBittorrent browser spec](../../e2e/tests/qbittorrent-stats-widget.spec.ts) passed five tests in local Chromium after implementation. It checked three footprints across four themes, large values, long service text, initial/domain states, stale warning/recovery without card movement, and ordinary custom-CSS overrides. Dark-theme screenshots were captured for owner review in the task; temporary screenshot calls were removed from the committed test.
- **Independent review:** no material findings remain. The reviewer identified a missing browser assertion for the 3x4 two-by-two card geometry; explicit x/y assertions now cover all three compositions and the focused check passed again.
- **Baseline local gate:** lint passed with the pre-existing Netdata unused-import warning; type-check passed; coverage passed all 2,105 tests across 133 files when rerun with loopback access (the first sandboxed attempt hit `listen EPERM` in existing Docker/SSRF integration tests); nonvisual E2E passed 46 tests; production-auth E2E built successfully and passed 21 tests. This gate was run before the owner requested a further appearance adjustment, so rerun it after the final visual change and before commit.
- **Appearance history:** the owner found that 3x4's two centered 49px card rows left too much vertical space unused. A taller-card experiment was implemented prematurely and reverted. After brainstorming, the owner selected the four-count activity summary described above; earlier appearance options are historical only.
- **Superseded activity appearance check:** the initial 3x4 middle-strip design rendered Downloading, Seeding, Stalled and Queued between transfer card rows and passed six focused Chromium tests. The owner rejected its appearance, including unboxed and grouped-panel variations; those screenshots and results do not establish visual acceptance for the final design. API, route and component focused tests passed before the visual correction.
- **At that stage:** owner visual acceptance and delivery were pending. The eight-card design was later committed to draft PR #114 and passed remote CI, but the subsequent uniform-card correction supersedes its visual result. The qBittorrent tracker row remains `todo` until its completion rule is satisfied.

### Review correction — 2026-09-29

- **New evidence:** `migrateFixedGridConfig` resolves a pre-footprint widget tile with no explicit size from its current `preferredSize` (`src/config/loader.ts`). Changing qBittorrent Stats from `wide` to `normal` would silently migrate such an existing tile from its historical 6x2 display to 3x2. New service-editor tiles separately use the first supported footprint, so the new default and old migration fallback must be checked as distinct paths.
- **New evidence:** `GET /api/widget` wraps the transfer and optional torrent-state requests in one five-second hard timeout. A hanging torrent-state request can discard already fetched transfer values. The earlier partial-failure statement covered immediate errors but not this timing case.
- **Invalidated assumptions and dependency audit:** the claims that all existing wide tiles are preserved and that every activity-only failure retains transfer cards were incomplete. Recheck registration, fixed-grid migration, the server fetch contract, API tests, browser fixtures, README, tracker and full task diff against these cases. Existing geometry observations remain valid.
- **Corrected implementation:** preserve 6x2 when migrating historical qBittorrent Stats tiles with no saved geometry while keeping new editor tiles at 3x2. Bound only the optional activity request with a shorter child deadline inside the route's hard timeout, and return `activity: null` on that child deadline while still propagating parent cancellation. Exercise registered footprint-to-fetch selection directly for 3x2, 3x4 and 6x2.
- **Focused correction checks:** fixed-grid migration preserves the historical absent-geometry 6x2 tile and respects an explicit compact size; the service editor saves a newly selected tile at 3x2. The optional torrent fetch uses at most 1.5 seconds within a 4.5-second stats budget, leaving room before the route's five-second hard timeout. Tests cover cooperative and noncooperative activity deadlines, parent cancellation, budget exhaustion, direct footprint-to-fetch selection, and a real widget route response retaining transfer data when activity hangs. Focused config/editor/API/route suites pass.

### Visual model correction — 2026-09-30

- **Owner feedback:** the bare two-by-two count list, count-above-label variations and a single full-width activity panel all look incoherent beside the four shared stat cards. The premise that activity must occupy a visually separate middle strip is invalid. Reconsider the complete 3x4 composition while retaining the four transfer values and four selected activity categories.
- **Observed constraint:** the real 3x4 tile is 264px tall; its two original 49px card rows run from approximately y=48 to y=237, leaving about 189px for the card grid after header and notice space. Four rows of identical cards may fit only with a compact grid gap and vertical card padding. The shared `WidgetStat` token defaults are 6px vertical padding, 1rem value, 0.6875rem label and 6px grid gap; CSS variables allow a scoped compact variant without changing the shared component.
- **Invalidation sweep:** recheck the qBittorrent component structure and CSS, browser card-count/position assertions, no-scroll and custom-CSS checks, unit tests, README and tracker. Fetch selection, state classification, migration compatibility and timeout behavior are independent of presentation and remain valid.
- **Revised design:** 3x4 uses eight instances of the same `WidgetStat` component in a two-column, four-row grid: speeds, totals, Downloading/Seeding and Stalled/Queued. A qBittorrent-only compact token override reduces vertical padding, value/label size and grid gap; the 3x2 speed-only and 6x2 four-card compositions retain their existing styling. The earlier middle-strip and separate panel designs are superseded.
- **Browser proof:** the 340x264 real tile fits eight cards with large transfer values and five-digit counts, without clipped card text or scroll. Dark, light, OLED and high-contrast screenshots were inspected. The project-matched Playwright Chromium was installed into a disposable `/tmp` browser path after its default cache was found missing; all six focused browser checks pass there.
- **Review correction:** partial activity failure now retains all eight card positions, renders unknown activity values as dashes and announces “Activity unavailable” in the reserved notice row. Browser assertions prove the four 3x4 rows are equal-height and do not overlap, and that all card bounds remain stable in the unavailable state. This layout and ordinary custom-CSS override pass the focused browser suite.
- **Eight-card local gate:** `CI=true` lint passed with the existing Netdata unused-import warning; type-check passed; coverage passed 2,119 tests in 133 files; nonvisual E2E passed 47 tests; production-auth build and E2E passed 21 tests. Playwright used the project-matched Chromium installed in `/tmp` via `PLAYWRIGHT_BROWSERS_PATH`. These results predate the uniform-card correction.

### Uniform card correction — 2026-09-30

- **Owner correction:** stat cards must always use the shared card size. The compact padding, type and grid-gap override used to fit eight cards in 3x4 violates the design goal. The owner selected six 3x4 cards: four transfer values, Active and Queued. The existing 3x2 and 6x2 content stays selected.
- **Count contract:** Queued counts `queuedDL` and `queuedUP`. Active means every torrent returned by the unfiltered torrent-list request that is not in either queued state, including stopped/paused, stalled, checking, error, missing-files, unknown and future states. This is the owner's explicit definition; it differs from qBittorrent's own `active` filter. Count `active + queued` equals the returned list length. An activity-only request failure still yields unavailable values in both activity cards while preserving transfer values.
- **Evidence and invalidation:** the qBittorrent 3x4 CSS overrides shared card padding from 6px to 3px vertically, value text from 1rem to .875rem, label text from .6875rem to .625rem and grid gap from 6px to 4px. Four default rows plus gaps need about 214px in a roughly 194px grid. Three default rows need about 159px. The eight-card composition, four-category UI/API shape, tests, README and tracker claims are superseded; recheck them together. The server footprint selection, timeout and cancellation paths remain applicable.
- **Implementation and validation:** remove the compact qBittorrent sizing override, render three rows of default `WidgetStat` cards in 3x4, derive Active from the full torrent list and Queued from its two queued states, and update unit/browser fixtures and docs. Measure card padding, type, width, height, gap, text fit and scroll in real 3x4 and Immich tiles, including four themes, unavailable activity and stale errors. Run the full local gate, then update draft PR #114 and verify its remote CI. Visual acceptance remains separate.
- **Focused browser evidence:** the 3x4 tile's first card and an Immich 3x2 card have identical rendered width, height, padding, internal gap, value/label font sizes and grid gap in one real browser fixture. All seven qBittorrent browser tests pass, including four themes, unavailable activity, stale data, custom CSS and no scroll. The six-card screenshot was shown for owner review; visual acceptance remains pending.
- **Revised local gate:** `CI=true` lint passed with the existing Netdata unused-import warning; type-check passed; coverage passed 2,119 tests in 133 files; nonvisual E2E passed 48 tests; production-auth build and E2E passed 21 tests. The authenticated suite's test fixture was restored afterward. Independent read-only review found no material issue. Check draft PR #114 for current-head remote CI; the prior eight-card CI run is not verification of this correction. Owner visual acceptance remains separate.

### Activity-count correction — 2026-09-30

- **Owner correction:** stopped torrents must not count as Active. Replace the Queued card with Inactive and include queued and stopped torrents in it. The previous Active/Queued count contract and its all-non-queued test, tooltip, README, tracker and PR description are superseded. The six-card geometry, other footprints, shared card sizing, transfer fetching, optional activity deadline and unavailable state remain selected.
- **Confirmed state model:** The unfiltered `/api/v2/torrents/info` response provides a `state` string. The current [qBittorrent serializer](https://github.com/qbittorrent/qBittorrent/blob/master/src/webui/api/serialize/serialize_torrent.cpp) emits `stoppedDL`/`stoppedUP`; earlier [WebUI API documentation](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-%28qBittorrent-5.0%29) lists `pausedDL`/`pausedUP`. Both have `queuedDL`/`queuedUP`, `error` and `missingFiles`. Its [source implementation](https://github.com/qbittorrent/qBittorrent/blob/master/src/base/bittorrent/torrentimpl.cpp) defines the built-in active/inactive filter by current payload rate, so that filter would classify stalled torrents differently from the owner's intended categories. An `error` state can also be an upload-only torrent that is still transferring, so error and missing-files states must not be silently folded into Inactive.
- **Corrected contract:** Inactive counts exactly `queuedDL`, `queuedUP`, `stoppedDL`, `stoppedUP` and the legacy `pausedDL`, `pausedUP` aliases. Active counts every other returned state under the owner's complementary rule, including stalled, checking, error, missing-files and unknown/future states. The two counts are mutually exclusive and sum to the unfiltered list length. This is a dashboard definition, distinct from qBittorrent's transfer-rate-based inactive filter. An activity-only request failure still makes both counts unavailable without hiding transfer values.
- **Dependency audit and validation:** The API type/classifier, component labels and tooltips, unit and browser fixtures, README, tracker and draft PR body were checked together. The 3x2/6x2 data path still skips the torrent list, and the unit case covers both qBittorrent naming generations. A focused 66-test run passed. The full local gate passed with the existing Netdata lint warning: type-check, 2,119 coverage tests, 48 nonvisual E2E tests and 21 production-auth E2E tests. A read-only reviewer found no material issue. The final diff must pass the same required gate before commit, then current-head PR CI must be verified. Visual acceptance remains pending.

### PR #114 review triage — 2026-09-30

- **Observed review state:** Cubic submitted five P3 threads on head `2569bad`; lint, type-check, unit and E2E jobs passed on that head. The PR is ready for review and remains unmerged. Review comments are claims to verify, not automatic change requests.
- **Valid documentation findings:** the tracker still says current-head CI is pending, and the plan's current-state line still calls the completed activity correction unfinished. Update both current-state statements; preserve the tracker `todo` status until owner visual acceptance.
- **Valid small robustness findings:** the budget test assumes exactly two `performance.now()` reads; keep its first start-time value and make the elapsed-time value the default for later reads. The optional qBittorrent 4.5-second budget duplicates the shared five-second route default; derive it from `WIDGET_FETCH_TIMEOUT_MS` with the existing 500 ms margin. No qBittorrent per-widget override exists today; introducing one would require a separate context contract.
- **Rejected overflow finding:** the removed legacy qBittorrent grid scrolled because its former 6x2 layout placed four cards in two rows and overflowed. The selected layouts now use six equal cards in three rows at 3x4 and four in one row at 6x2. `e2e/tests/qbittorrent-stats-widget.spec.ts` measures tile/body/grid/card/text bounds and asserts no scrolling across all three footprints and four themes, including unavailable activity and stale data. Restoring scrolling would violate the selected no-scroll summary behavior; retain the current CSS and explain this in the review thread.
- **Next checks:** run focused tests, the full required pre-commit gate, audit the complete PR diff and staged paths, then commit/push only the valid fixes. Verify CI on the new head, reply to the review threads with evidence and resolve only those addressed or rejected with a reason. No merge or release is authorized.

### Completion — 2026-09-30

- The owner accepted the final six-card 3x4 visual in this task. All six applicable shared-library components are used across the selected 3x2, 3x4 and 6x2 footprints; no qBittorrent-specific stat-card sizing override remains.
- [PR #114](https://github.com/pmyszczynski/kokpit/pull/114) merged as `37e2fcb` after all five Cubic threads were resolved and Codex completed review of head `012807f`. Its lint, type-check, unit and E2E jobs passed in [CI run 36721761397](https://github.com/pmyszczynski/kokpit/actions/runs/36721761397).
- [v0.14.0](https://github.com/pmyszczynski/kokpit/releases/tag/v0.14.0) was published from `dd7ac8c`; [release workflow 36725407889](https://github.com/pmyszczynski/kokpit/actions/runs/36725407889) passed the full gate and Docker manifest verification. The qBittorrent Stats tracker status is now `migrated`.

## Prowlarr Stats slice — 2026-10-03

### Selected scope and implementation

- The owner selected Prowlarr Stats and, after reviewing the four-card prototype, selected six metrics at the existing 3x4 footprint. Render Enabled / Failing, Indexers / Total Grabs, and Usenet / Torrent in a two-column, three-row grid. Keep the existing polling, configuration, footprint and mobile fallback.
- Derive `usenetIndexers` and `torrentIndexers` from exact `protocol` values in the existing indexer response. Include enabled and disabled indexers in these totals, like total Indexers. Unknown/future protocols remain in the overall total without being silently classified as Usenet or Torrent. No additional upstream request is needed.
- Compose all six applicable library entries: tokens, Body, StatGrid, Stat, State and StaleNotice. Initial loading/error presentation opts into WidgetRenderer through `sharedUI`; direct no-data rendering preserves the blank domain-empty state.
- Extend WidgetStat with a named `alert` tone for nonzero Failing values, with theme-aware red tokens meeting 4.5:1 contrast on all four default card surfaces. Existing error red fails that threshold in dark and light themes; only the new stat tone uses the corrected palette. Preserve legacy Prowlarr class hooks. Remove only Prowlarr selectors from shared legacy rules, retaining other widgets' styles.
- Reserve the stale-notice row in healthy and failed-refresh states. Use accepted shared card padding/type/gaps. Opt into the existing desktop compact service header so long service text cannot consume stat/notice space. Full text stays accessible through titles; outer 340x264 geometry and mobile fallback remain unchanged.
- The owner accepted the final ordered six-card appearance. Prowlarr is `migrated` and WidgetStat (including its alert extension) is `done`; publication and remote CI remain separate. No other widget is selected.

### Browser evidence and validation

- Seven six-card Prowlarr browser checks pass: all four themes, two-column/three-row composition, actual text-range and inner bounds, large values, long service text, zero/nonzero failing counts, shared initial loading/error and blank null-data states, stale failure/recovery with exact stable bounds, ordinary custom-CSS overrides and equality with Immich card sizing.
- Current preview paths: [before/dark](../assets/widget-ui/prowlarr/before-dark.png), [six-card/dark](../assets/widget-ui/prowlarr/ordered-dark.png), [light](../assets/widget-ui/prowlarr/ordered-light.png), [OLED](../assets/widget-ui/prowlarr/ordered-oled.png), [high contrast](../assets/widget-ui/prowlarr/ordered-high-contrast.png) and [stale/dark](../assets/widget-ui/prowlarr/ordered-stale-dark.png). Screenshots use fixture data and the icon fallback; they are review evidence, not CI snapshot replacements.
- Local browser checks use installed Chromium 151 through ignored `.codex` config wrappers that change only the executable and resolve the original test/server paths. Playwright's pinned Chromium 145 download is blocked by the environment's host policy. CI must independently verify its pinned browser and visual baselines.
- Focused behavior validation: 42 tests across Prowlarr component/API/registration, WidgetStat and WidgetRenderer pass, including disabled/unknown protocols, empty indexer lists and unchanged request count. Before the subsequent card-order correction, all seven six-card browser checks and the full local gate passed: `CI=true` lint (existing Netdata unused-import warning), type-check, coverage (2,122 tests / 133 files), nonvisual E2E (54 tests) and production build/auth E2E (21 tests). Browser commands used the executable-only wrappers described above; no suites or assertions were skipped. Auth fixture changes and generated backups were restored/removed afterward.
- Delivery evidence: [PR #117](https://github.com/pmyszczynski/kokpit/pull/117) is open for `feature/prowlarr-widget-ui`. After the final card-order and acceptance edits, the full required local gate passed: lint, type-check, 2,122 coverage tests, 54 nonvisual E2E tests and 21 production-auth E2E tests. Implementation commit `20946f8` passed lint, type-check, unit and E2E jobs in [CI run 37149055288](https://github.com/pmyszczynski/kokpit/actions/runs/37149055288), including pinned-browser visual and authentication checks. No visual baselines needed regeneration. Inspect the PR for checks and reviews of later commits.

### Composition correction — historical

- The initial four-card 3x4 prototype passed the local gate (2,120 unit tests, 54 nonvisual browser tests and 21 production-auth tests), but the owner flagged its two-row composition as unbalanced beside qBittorrent's six-card view. Those results verify the historical four-card implementation only.
- The owner accepted the proposed Usenet/Torrent third row. The two-metric 3x2 alternative was not selected. Composition, API types/derivation, fixtures, README and tracking evidence were updated together; the six-card preview and validation established the final implementation. Shared card sizing and the stable notice slot remain the intended foundation.

### Card-order correction — 2026-10-03

- The owner selected Enabled / Failing for the top row, Indexers / Total Grabs for the middle row, and Usenet / Torrent for the bottom row. Reorder the DOM cards, expected browser values/labels and README together. Data derivation, shared card sizing, 3x4 geometry and feedback behavior stay as selected.
- Updated order verified: all nine Prowlarr component tests and seven widget browser checks pass, including all four themes, large values, custom CSS, initial states and stable stale-data feedback. Current previews above show the corrected order. The full pre-commit gate subsequently passed on the final ordered implementation, followed by independent GitHub CI as recorded above. The owner accepted this final appearance and requested PR publication with CI/review monitoring.

### PR review handoff — 2026-10-03 (historical)

- Approved order: Enabled / Failing, Indexers / Total Grabs, Usenet / Torrent. Preserve the accepted shared sizing and fixed notice slot during review fixes.
- Re-run the entire required local gate after final edits and immediately before each commit. Its final result is reported in the PR; do not treat older runs as current-head verification.
- Continue review of existing [PR #117](https://github.com/pmyszczynski/kokpit/pull/117) for this selected widget; inspect actual current-head check runs, including E2E, and review threads. If CI reports intentional visual differences, review its Ubuntu-generated artifact and commit only intended snapshots after another local gate.
- Historical pre-order preview: [six-card dark](../assets/widget-ui/prowlarr/six-card-dark.png). Current previews above show the owner-approved order.

### Merge and release preparation — 2026-10-04

- The owner authorized overriding the required-approval rule, merging PR #117 and making a release. The PR merged as `d45756d`; its final head `99e1a64` passed all CI checks in [run 37150122981](https://github.com/pmyszczynski/kokpit/actions/runs/37150122981), including visual and authentication E2E. Codex and Cubic completed review, and all three documentation threads were addressed and resolved.
- v0.15.0 is the next minor release for the six-card Prowlarr migration and protocol-count additions. The version metadata is updated in `package.json` and `package-lock.json` through the release PR. After confirming that metadata on `main`, use the existing release workflow to test, tag, release, publish and verify Docker. A version bump or merged feature alone does not establish release publication.

## Radarr Stats slice — 2026-10-04

- **Selected:** the owner requested Radarr Stats designed from the previous migrations and a browser preview. The v0.15.0 release was confirmed finished; release work is no longer the next action.
- **Inventory correction:** the source and API contain six metrics, not the five noted in the original tracker: Missing, Upcoming, Wanted, Queued, Available and Total. Preserve all six and their existing order and calculations.
- **Proposed layouts:** new tiles default to 3x4 with two columns and three rows, matching Prowlarr’s accepted card dimensions. Existing 6x2 tiles retain all six metrics in a single row. Extend WidgetStatGrid with an explicit six-column variant rather than adding local grid CSS.
- **Composition:** WidgetBody, WidgetStatGrid, WidgetStat, WidgetState, WidgetStaleNotice and shared tokens. Opt into the compact header and shared renderer feedback. Remove superseded Radarr Stats CSS without changing Radarr Queue.
- **Tones:** Missing uses alert when positive, Wanted and Queued use a shared warning tone when positive, Upcoming and Total use info, and Available uses positive. Zero Missing/Wanted/Queued counts remain neutral. The warning token has a darker light/high-contrast variant.
- **Feedback:** reserve the notice row in healthy and stale states, keep saved data visible, and expose the full refresh error accessibly. Initial loading/error selection remains with WidgetRenderer. Fetching, polling, configuration and mobile link fallback remain unchanged.
- **Validation:** lint passed with one pre-existing unused-import warning in Netdata Disk Space; type-check passed; coverage run passed all 2,127 tests across 133 files. The focused browser run passed all 28 checks covering Immich, qBittorrent Stats, Prowlarr and Radarr. Radarr checks cover both footprints and all four themes, text/card bounds, contrast, long service text, large values, initial/null/stale states, refresh recovery, custom CSS overrides and card parity with the accepted examples. [Browser checks](../../e2e/tests/radarr-stats-widget.spec.ts).
- **Preview evidence:** real-browser screenshots with sample data are in `/workspace/artifacts/radarr/`: `radarr-comparison-dark.png` and `radarr-comparison-light.png` show Prowlarr beside Radarr’s default 3x4, with Radarr’s retained 6x2 below. Per-footprint screenshots also cover dark, light, OLED and high-contrast themes. Letter icons in the comparison are fixture fallbacks, not a change to service icon behavior.
- **Status:** implementation and preview validation complete. The owner accepted the design and shared colors with the informational-category correction below. The implementation is included in the combined migration PR described by the current handoff.

## Shared stat color revision — 2026-10-04

- **Authorized:** the owner requested color unification after reviewing Radarr: add color-coded stats to the previous migrated widgets where their metric meaning supports it.
- **Implemented:** all four selected widgets compose the existing theme-aware `positive`, `info`, `warning`, `alert` and `neutral` tones. No widget-specific color CSS or new palette was introduced. Prowlarr Enabled is green and Indexers/Total Grabs/Usenet/Torrent blue; qBittorrent uses consistent green downloads, blue uploads, green positive Active counts and neutral Inactive/unavailable activity; Immich Storage joins Items in blue. Radarr Queued joins Wanted in amber when positive, and Total is blue.
- **Preserved:** metric labels, values, formatter behavior, footprints, card sizing, fetching, stale notices, custom CSS hooks and mobile behavior.
- **Validation:** lint passed with the existing Netdata unused-import warning; type-check passed; all 56 focused widget tests passed. All 30 distinct browser checks passed across the four widgets and the new color checks (the 28 existing checks passed in the combined run; both color checks passed after scoping a loading-state selector). Theme checks verify identical computed colors for each shared tone and at least 4.5:1 contrast for every stat value/label in dark, light, OLED and high-contrast themes. Zero pending/problem counts and unavailable activity remain neutral. [Color browser checks](../../e2e/tests/widget-stat-colors.spec.ts).
- **Preview evidence:** `/workspace/artifacts/widget-colors/stat-colors-{dark,light,oled,high-contrast}.png` shows qBittorrent, Prowlarr, Radarr and Immich together with sample data. Earlier Radarr preview screenshots remain under `/workspace/artifacts/radarr/` for comparison.
- **Review:** the owner accepted the design with the informational-category correction below. The correction is implemented, and both color browser checks pass across all four themes, including zero categories staying blue. Publication is authorized through the combined migration PR described by the current handoff.

- **Owner color correction:** the owner accepted the revised design with one change: category counts are informational, and neutral is reserved for inactive/no-activity states. Prowlarr Usenet/Torrent now use shared blue, including zero category counts. The browser color checks cover this distinction. Zero pending/problem counts remain neutral because there is no active pending/problem state.

## SABnzbd slice and publication — 2026-10-04

- **Selected:** the owner added SABnzbd to the authorized PR/merge/release work and requested the same shared UI treatment plus a preview. The owner corrected the first proposal: 3x2 must have two cards, 6x2 can have three, and 3x4 must be offered. The initial three-card compact preview is superseded.
- **Composition:** all six applicable shared entries: tokens, WidgetBody, WidgetStatGrid, WidgetStat, WidgetState and WidgetStaleNotice. Opt into compactHeader/sharedUI. Two compact cards: Speed / Queue. Three wide cards: Speed / Queue / Queue Size. Six detailed cards: Speed / Queue, Queue Size / Remaining, ETA / Status, matching the accepted two-column, three-row detailed pattern.
- **Footprints:** new editor tiles default to 3x2; existing 6x2 tiles remain supported; the size picker also offers 3x4. Use shared three-column placement only for 6x2. Preserve units, decimal formatting, polling, configuration and mobile fallback.
- **Detail data:** the documented [SABnzbd queue response](https://sabnzbd.org/wiki/configuration/4.5/api) already supplies `mbleft`, `timeleft` and `status`. Parse them from the same request as optional detail; missing/invalid detail becomes null without discarding valid summary metrics. Do not fabricate remaining size from the total. Missing detail shows “—”, and an empty queue has no ETA. No extra endpoint/request is introduced.
- **Colors:** green downloads, amber positive queue counts, neutral empty queue, informational blue sizes/ETA. Reported Downloading/Checking/Repairing/Extracting/Moving/Fetching states are active green; Paused/Idle/Stopped neutral; Queued amber; explicit Error/Failed red; unknown reported statuses informational blue. Missing status stays neutral.
- **CSS:** remove only SABnzbd selectors from the shared legacy family and its full-width local card rule. Preserve Unraid, Tdarr and Actual Budget rules. Retain integration class hooks for custom CSS, including the former queue-size hook without forcing full-width placement.
- **Evidence:** [browser checks](../../e2e/tests/sabnzbd-widget.spec.ts) cover three footprints, four themes, text/card bounds, contrast, large values, long service text, initial/null/empty/stale states, 10-second refresh failure/recovery, ordinary custom CSS overrides, and shared styling parity with qBittorrent. [Component tests](../../src/__tests__/integrations/SabnzbdWidget.test.tsx) preserve formatting and verify size-specific cards, missing detail and inactive status; [API/registration tests](../../src/__tests__/integrations/sabnzbd.test.ts) verify detailed parsing with one request, partial-response compatibility and all three footprint declarations.
- **Preview:** `/workspace/artifacts/sabnzbd/sabnzbd-comparison-{dark,light}.png` shows qBittorrent, corrected compact SABnzbd, detailed SABnzbd and wide SABnzbd together. Individual size/theme previews are alongside them. Fresh corrected previews are `sabnzbd-corrected-2-3-6-{dark,light}.png` and `sabnzbd-compact-two-cards-dark.png`, avoiding cached earlier images. PR #119 is published; owner-specific SABnzbd visual acceptance has not yet been recorded.
- **Publication:** the owner authorized PR publication, review/CI monitoring, merge and release. Include the 0.16.0 metadata bump in this PR so release.yml can verify it on main after merge. Await each AI review round, which can take about 15 minutes, and resolve findings before merging. Release workflow success must include verified Docker publication.

- **First review round:** implementation head `13e987c` passed all independent CI checks, including visual and authentication E2E. Codex and Cubic identified the same upgrade issue: pre-fixed-grid Radarr/SABnzbd tiles without saved geometry must retain their historical 6x2 layout. The loader now preserves those migration defaults while honoring explicit sizes/footprints; regression tests cover both widgets. New editor defaults remain unchanged. The former queue-size class is intentionally retained as a custom CSS compatibility hook, without a built-in full-row rule. Publication is complete; monitor the updated head and next review round before merge/release.

- **Second review round:** head `102ff50` passed all independent CI checks. Codex identified an additional legacy `large` SABnzbd upgrade path: unsupported 6x4 geometry must fall back to the historical wide summary rather than Compact. The loader now uses the retained historical-wide footprint for unsupported geometry, with explicit large-size and saved-6x4 regression coverage for Radarr/SABnzbd. Supported saved geometry and new editor defaults remain unchanged. Validate and monitor the updated head before merge/release.
