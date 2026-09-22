# Widget component and migration tracker

[Execution plan and session handoff](widget-consistency-plan.md)

**Current state:** the first Immich slice is complete locally. `WidgetTokens`, `WidgetBody`, `WidgetStatGrid`, `WidgetStat`, `WidgetState` and `WidgetStaleNotice` are `done`; Immich is `migrated`. The other seven library entries and 27 widget migrations remain `todo`. Full local validation passes. The owner authorized PR delivery and CI/review monitoring on 2026-09-22; see the plan for the delivery scope. No merge or release is implied.

These tables describe **target adoption based on the current widget UI**, not components already imported today. Names and groups reflect the agreed library organization; exact APIs and visual tokens remain to be validated in selected examples. Update both tables and the execution plan together if a boundary changes.

## Organization

See the [agreed directory structure and component boundaries](widget-consistency-plan.md#agreed-organization-and-naming). Each React component lives in `src/widgets/ui/<group>/<Component>/` with `<Component>.tsx`, `<Component>.test.tsx`, `<Component>.css` and `index.ts`. Component-specific helpers/types stay alongside it when needed; whole-widget browser tests stay in `e2e/`. The root `src/widgets/ui/index.ts` provides public imports through `@/widgets/ui`.

`WidgetTokens` is the CSS foundation at `foundation/tokens.css`, not a React component. The table's group column records placement: `foundation` for tokens, `layout` for containers, `data-display` for content primitives and `feedback` for states/notices. Create component directories as selected work begins.

`WidgetStatRow` represents a labeled measurement (for example, memory used/total); `WidgetListItem` represents an item in a collection (for example, a torrent with name, status, speed and progress). `WidgetBar` covers both progress and usage while retaining their distinct accessible semantics. `WidgetMiniChart` is the compact history line chart seeded from Netdata's existing local `Sparkline`.

## Status rules

- Component `todo`: not started under the shared-library contract (existing duplicated CSS or a local helper does not count).
- Component `in progress`: the owner-selected component is being implemented or visually iterated.
- Component `done`: implemented, documented and tested in at least one example widget, with its appearance accepted by the owner; other consumers may still be pending.
- Component `migration of all widgets complete`: `done`, and every listed consumer has adopted it with evidence. A widget may still be `todo` for another component.
- Widget `todo`: no migration or only a partial migration. Record partial adoption and evidence in that row; do not invent another status.
- Widget `migrated`: all applicable listed components adopted, old conflicting rules removed, intended variants/states tested and the result reviewed. Optional sections count even if disabled in the default fixture.

Each status change must include a short evidence link in its row (implementation, test, screenshot/review reference or commit). Component completion is independent of whole-widget completion.

## 1. Shared components

All consumer IDs below refer to the second table. `All 28` includes indirect use via the shared renderer and tokens.

| Component | Group | Status | Widgets that should use it | Description and intended appearance | Evidence / next step |
| --- | --- | --- | --- | --- | --- |
| `WidgetTokens (CSS)` | `foundation` | done | All 28 | Shared CSS foundation: one spacing/type/radius/border scale, theme surfaces and semantic tones. Color/emphasis may vary through named tokens; per-widget shape/spacing forks do not. Exact values are settled visually in the pilot. | [Tokens](../../src/widgets/ui/foundation/tokens.css). Shared stat, grid and notice tokens; approved Immich appearance preserved exactly. |
| `WidgetBody` | `layout` | done | All 28 | Inner widget layout only: consistent gaps, shrinkable content and a separate stale-notice slot. Owns body layout, not service header or outer tile size. Summary and list compositions remain distinct; never hide overflow to pretend content fits. | [Component and colocated tests](../../src/widgets/ui/layout/WidgetBody/WidgetBody.tsx). Stable reserved notice slot, centered state layout and caller attributes; verified without movement during refresh failure/recovery. |
| `WidgetStat` | `data-display` | done | `plex`, `qbittorrent-stats`, `sabnzbd`, `tdarr-stats`, `prowlarr-stats`, `radarr-stats`, `seerr-stats`, `immich-stats`, `unraid-stats`, `netdata-cpu`, `netdata-ram`, `netdata-net`, `netdata-disk-io`, `netdata-disk-space`, `netdata-load`, `netdata-sensor`, `tautulli-activity`, `actualbudget-summary` | Value, label, optional unit/subvalue and composition slots. Card variant: rounded surface with consistent border, padding and type; plain variant: the same type system without a box for monitoring widgets. Explicit tone/density/order variants; do not silently clip significant digits or units. Already formatted values come from the widget. | [Component and colocated tests](../../src/widgets/ui/data-display/WidgetStat/WidgetStat.tsx). Accepted stacked-card appearance; formatting remains caller-owned. Other variants can be added for subsequently selected consumers. |
| `WidgetStatGrid` | `layout` | done | `plex`, `qbittorrent-stats`, `sabnzbd`, `tdarr-stats`, `prowlarr-stats`, `radarr-stats`, `seerr-stats`, `immich-stats`, `unraid-stats`, `tautulli-activity`, `actualbudget-summary` | Arrange Stat cards with consistent gaps, explicit columns and optional full-width cells. Adapt to available body space and approved footprints; support variable field counts. Do not stretch typography or remove fields to force a fit. | [Component and colocated tests](../../src/widgets/ui/layout/WidgetStatGrid/WidgetStatGrid.tsx). Shared 1–4-column arrangement and spacing; ordinary custom CSS overrides verified. |
| `WidgetStatRow` | `data-display` | todo | `system-stats` | One labeled measurement in a compact horizontal row with optional subvalue and bar slot, based on System Stats. Consistent alignment and spacing; caller supplies units, optional fields and domain meaning. | — |
| `WidgetList` | `layout` | todo | `qbittorrent-torrents`, `sonarr-calendar`, `sonarr-queue`, `radarr-queue`, `seerr-requests`, `docker`, `tautulli-activity`, `actualbudget-categories`, `actualbudget-accounts`, `actualbudget-schedules` | One deliberate vertical scroll region, plus optional fixed header/summary/footer slots. Consistent gaps and empty-state placement; all rows remain reachable. Does not choose data, sorting, limits or column definitions. | — |
| `WidgetListItem` | `data-display` | todo | `qbittorrent-torrents`, `sonarr-calendar`, `sonarr-queue`, `radarr-queue`, `seerr-requests`, `docker`, `tautulli-activity`, `actualbudget-categories`, `actualbudget-accounts`, `actualbudget-schedules` | One collection item in a dense list/table row shell with title, secondary text, value and accessory slots; consistent padding, separators and alignment. Caller owns columns and semantics. Long titles may truncate with a complete accessible name; meaningful numeric values stay readable. | — |
| `WidgetBadge` | `data-display` | todo | `sonarr-calendar`, `seerr-requests`, `actualbudget-accounts` | Small text pill with a shared shape, padding and type scale. Named status tones and neutral/category variants; labels and status mapping remain domain-owned. A stat card is not a badge. | — |
| `WidgetStatusDot` | `data-display` | todo | `docker` | Small circular indicator with a consistent size, named state colors and an accessible state label. Based on Docker container rows; separate from text badges and the outer service reachability indicator. | — |
| `WidgetBar` | `data-display` | todo | `qbittorrent-torrents`, `sonarr-queue`, `radarr-queue`, `tautulli-activity`, `system-stats`, `actualbudget-categories` | Shared horizontal track/fill with a consistent height/radius and tone variants. Task progress and resource usage need explicit semantic variants (progressbar versus meter/appropriate labeled usage semantics). Clamp visual fill safely; preserve visible domain percentages, including over-budget values. | — |
| `WidgetMiniChart` | `data-display` | todo | `netdata-cpu`, `netdata-ram`, `netdata-net`, `netdata-disk-io`, `netdata-sensor` | Small responsive SVG history line chart, typically without axes or detailed labels, with consistent stroke, fill, height and color tokens. Start from the existing Netdata Sparkline; preserve data/scale and missing-history behavior. Do not add charts to widgets that do not have them. | Existing seed: [Netdata Sparkline](../../src/integrations/netdata/Sparkline.tsx); not yet migrated. |
| `WidgetState` | `feedback` | done | All 28 | Consistent loading, empty, missing-data and initial-error presentation with widget-supplied copy. Keep the states distinct. Reuse through WidgetRenderer where it owns initial loading/error and in widgets for domain empty/partial states; do not move polling ownership. | [Component and colocated tests](../../src/widgets/ui/feedback/WidgetState/WidgetState.tsx). Shared loading/error/empty presentation; WidgetRenderer opts in Immich via sharedUI and retains fetching/state ownership. |
| `WidgetStaleNotice` | `feedback` | done | All 28 | Compact, consistently placed refresh-error notice outside the data grid/list, using semantic error styling and accessible alert behavior. Preserve existing data and budget space for the notice; it must not obscure metrics or become a grid cell. | [Component and colocated tests](../../src/widgets/ui/feedback/WidgetStaleNotice/WidgetStaleNotice.tsx). Accessible error-only content with full error context; Body owns the permanently reserved slot. |

## 2. Widget migration

**Common components for every row:** `WidgetTokens`, `WidgetBody`, `WidgetState`, `WidgetStaleNotice`. The component column adds each widget's content primitives to this common set. Source links show today's implementation. The final column records deliberate specialist behavior; the component table is not permission to redesign it.

| Widget / registry ID | Target components | Status | Preserve / migration evidence |
| --- | --- | --- | --- |
| [Plex](../../src/integrations/plex/widget.tsx) (`plex`) | Common + `WidgetStat`, `WidgetStatGrid` | todo | Keep configured fields and bandwidth units. |
| [qBittorrent Stats](../../src/integrations/qbittorrent/statsWidget.tsx) (`qbittorrent-stats`) | Common + `WidgetStat`, `WidgetStatGrid` | todo | Keep download/upload rates and totals. |
| [qBittorrent Torrents](../../src/integrations/qbittorrent/torrentsWidget.tsx) (`qbittorrent-torrents`) | Common + `WidgetList`, `WidgetListItem`, `WidgetBar` | todo | Keep columns, torrent state and progress. |
| [Sonarr Calendar](../../src/integrations/sonarr/calendarWidget.tsx) (`sonarr-calendar`) | Common + `WidgetList`, `WidgetListItem`, `WidgetBadge` | todo | Keep date/episode formatting and downloaded/upcoming status. |
| [Sonarr Queue](../../src/integrations/sonarr/queueWidget.tsx) (`sonarr-queue`) | Common + `WidgetList`, `WidgetListItem`, `WidgetBar` | todo | Keep queue columns, ETA and status text. |
| [SABnzbd](../../src/integrations/sabnzbd/widget.tsx) (`sabnzbd`) | Common + `WidgetStat`, `WidgetStatGrid` | todo | Keep queue, disk and transfer formatting. |
| [Tdarr Stats](../../src/integrations/tdarr/statsWidget.tsx) (`tdarr-stats`) | Common + `WidgetStat`, `WidgetStatGrid` | todo | Keep missing/optional data and worker/queue meanings. |
| [Prowlarr Stats](../../src/integrations/prowlarr/statsWidget.tsx) (`prowlarr-stats`) | Common + `WidgetStat`, `WidgetStatGrid` | todo | Preserve the verified 3x4 no-scroll layout and alert tone. |
| [Radarr Stats](../../src/integrations/radarr/statsWidget.tsx) (`radarr-stats`) | Common + `WidgetStat`, `WidgetStatGrid` | todo | Keep five stats and semantic emphasis. |
| [Radarr Queue](../../src/integrations/radarr/queueWidget.tsx) (`radarr-queue`) | Common + `WidgetList`, `WidgetListItem`, `WidgetBar` | todo | Keep queue columns, ETA and status text. |
| [Seerr Stats](../../src/integrations/seerr/statsWidget.tsx) (`seerr-stats`) | Common + `WidgetStat`, `WidgetStatGrid` | todo | Keep request status meanings; tones are variants. |
| [Seerr Requests](../../src/integrations/seerr/requestsWidget.tsx) (`seerr-requests`) | Common + `WidgetList`, `WidgetListItem`, `WidgetBadge` | todo | Use status and media-type badge variants; keep titles/request metadata. |
| [Immich Stats](../../src/integrations/immich/statsWidget.tsx) (`immich-stats`) | Common + `WidgetStat`, `WidgetStatGrid` | migrated | Uses all six applicable library entries for body, grid, cards and feedback; no Immich presentation CSS remains. Approved 3x2 Storage + Items preserved, warning row does not move cards, 6x2 removed. Initial state selection stays in WidgetRenderer; library presentation is explicitly opted in. Full local gate passes. [Evidence](widget-consistency-plan.md#validation-ledger). |
| [Unraid Stats](../../src/integrations/unraid/statsWidget.tsx) (`unraid-stats`) | Common + `WidgetStat`, `WidgetStatGrid` | todo | Keep optional metrics, array/parity state and health warnings. |
| [Netdata CPU](../../src/integrations/netdata/cpuWidget.tsx) (`netdata-cpu`) | Common + `WidgetStat`, `WidgetMiniChart` | todo | Plain stat variant; retain existing history behavior. |
| [Netdata RAM](../../src/integrations/netdata/ramWidget.tsx) (`netdata-ram`) | Common + `WidgetStat`, `WidgetMiniChart` | todo | Plain stat variant; keep used/total units and history. |
| [Netdata Network](../../src/integrations/netdata/netWidget.tsx) (`netdata-net`) | Common + `WidgetStat`, `WidgetMiniChart` | todo | Plain stat variant; keep both directions and existing history series. |
| [Netdata Disk I/O](../../src/integrations/netdata/diskIoWidget.tsx) (`netdata-disk-io`) | Common + `WidgetStat`, `WidgetMiniChart` | todo | Plain stat variant; keep read/write rates and existing history series. |
| [Netdata Disk Space](../../src/integrations/netdata/diskSpaceWidget.tsx) (`netdata-disk-space`) | Common + `WidgetStat` | todo | Plain stat variant; keep used/total and percentage. No chart today. |
| [Netdata Load Average](../../src/integrations/netdata/loadWidget.tsx) (`netdata-load`) | Common + `WidgetStat` | todo | Plain stat variant; keep all load intervals. No chart today. |
| [Netdata Sensor](../../src/integrations/netdata/sensorWidget.tsx) (`netdata-sensor`) | Common + `WidgetStat`, `WidgetMiniChart` | todo | Plain stat variant; preserve configured title, unit and history. |
| [Docker](../../src/integrations/docker/widget.tsx) (`docker`) | Common + `WidgetList`, `WidgetListItem`, `WidgetStatusDot` | todo | Keep running/total summary, state, image and uptime; summary is a List header slot. |
| [Tautulli Activity](../../src/integrations/tautulli/activityWidget.tsx) (`tautulli-activity`) | Common + `WidgetStat`, `WidgetStatGrid`, `WidgetList`, `WidgetListItem`, `WidgetBar` | todo | Components depend on selected summary/sessions sections; preserve usernames and playback state. |
| [System Stats](../../src/integrations/systemstats/widget.tsx) (`system-stats`) | Common + `WidgetStatRow`, `WidgetBar` | todo | Keep optional host fields, network/load rows and partial Docker errors. |
| [Actual Budget Summary](../../src/integrations/actualbudget/summaryWidget.tsx) (`actualbudget-summary`) | Common + `WidgetStat`, `WidgetStatGrid` | todo | Keep local Amount, currency/locale, negative values and widget-level privacy behavior. |
| [Actual Budget Categories](../../src/integrations/actualbudget/categoriesWidget.tsx) (`actualbudget-categories`) | Common + `WidgetList`, `WidgetListItem`, `WidgetBar` | todo | Keep local Amount/privacy, groups, filters, limits and overspending semantics. |
| [Actual Budget Accounts](../../src/integrations/actualbudget/accountsWidget.tsx) (`actualbudget-accounts`) | Common + `WidgetList`, `WidgetListItem`, `WidgetBadge` | todo | Keep local Amount/privacy, off-budget badge and net-worth footer. |
| [Actual Budget Schedules](../../src/integrations/actualbudget/schedulesWidget.tsx) (`actualbudget-schedules`) | Common + `WidgetList`, `WidgetListItem` | todo | Keep local Amount/privacy, ranges, due dates and summary footer. |

Actual Budget's existing `Amount` and privacy behavior remain integration-owned; they compose inside shared primitives. No new generic currency/privacy component is planned. Widget-specific formatters, filters, status calculations, data fetching, config and service-tile chrome remain outside this library.

Before adding a new widget or changing a mapping, update both tables in the same change. If a newly discovered visual pattern needs another component, add its source evidence and intended consumers before implementing it.
