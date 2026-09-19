# Widget UI library: plan and session handoff

**Start here:** [component and widget tracking tables](widget-ui-library.md).

**Current state:** documentation only; no component or widget migration has started.

**Branch:** `codex/widget-consistency-plan`, based on `main` at `30c7861`.

**Next action:** the owner chooses when to begin the first component. Suggested first example: **Immich Stats**.

**Working location:** the branch's checkout; these documents are tracked under `docs/`, not the ignored `docs/plans/` directory.

## Agreed direction

All widgets should compose a shared UI library. Equivalent elements share their design and behavior; supported variants allow meaningful differences such as color, emphasis and density. Widgets continue to own their data and composition.

Build the library **one component at a time**, starting from patterns already in the widgets. Use **one example widget first** for visual iteration. After the owner accepts that example, migrate other widgets individually in the order they choose. The tables are a backlog and progress record, not authorization to work through everything automatically.

This plan supersedes the earlier broad widget-consistency proposal: its three-widget pilot, bulk family migrations, mandatory all-widget baseline before starting, and proposed mobile expansion are not the execution plan. The owner requested this smaller, controlled approach.

## How to work on the next step

1. Read this file, both [tracking tables](widget-ui-library.md), applicable `AGENTS.md`, and the current branch/diff. Preserve unrelated work. Confirm the owner-selected component/widget from the session; if none is selected, ask which step to start.
2. Inspect that component's existing consumers and variants before defining its shared contract. Keep the work bounded to the selected step. Read the relevant installed Next.js guide before application code changes.
3. Mark the selected component `in progress`. Define its minimal props, supported variants, tokens, fit/overflow behavior and accessible semantics. Implement under `src/widgets/ui/` using the current React/CSS approach; add no design-system dependency by default.
4. Introduce it only in the selected example widget. While the first example is being developed, keep all other widgets on their current implementations. Shared CSS must be scoped so they do not change accidentally.
5. Show before/after browser evidence on that widget's supported footprints, including large values, long text and stale-data errors. Iterate on the visual result with the owner. Do not declare a component `done` based on code completion alone.
6. Update component and widget rows, evidence links and the session handoff below. Commit the scoped change after required validation. Wait for the owner's next selection; do not start another widget or component on the strength of the backlog alone.

A later widget may introduce a primitive the first example did not need (for example, a progress bar or chart). Build that primitive when its selected widget needs it, with the same visual review loop. Do not put artificial content into the first example to demonstrate every library component.

## Proposed first example

**Immich Stats** is small enough to review and directly demonstrates the reported inconsistency: five metric cells, colored values, one full-width Storage cell, two supported footprints, and a stale-error state.

Start with `WidgetTokens` and `WidgetMetric`, then introduce `WidgetMetricGrid`, `WidgetBody`, `WidgetState` and `WidgetStaleNotice` as needed to finish this one example. This is a proposed order, not a request to implement them all in a single change. The owner can choose a different first widget.

Keep the existing five metrics and both 3x2/6x2 footprints initially. If real measurements show a readable composition cannot fit, present the concrete alternatives before removing information, changing saved sizes or adding summary scrolling. Do not solve clipping by hiding content or shrinking type until it is unreadable.

## Rules the library must enforce

- Use shared components and tokenized variants for equivalent elements. Integration-specific colors are acceptable; independent radius, spacing, typography or overflow implementations need a documented semantic reason.
- Metric cards, status badges, list rows and charts remain distinct patterns. Favor a small composition API over a universal configurable widget component.
- Fit against the **available widget body**, not just the outer footprint. Headers, descriptions, padding and stale notices consume space. Lists may deliberately scroll vertically; summary clipping is not a fit strategy.
- Keep data fetching, polling, units/formatters, domain status mappings, API/config contracts, Actual Budget privacy, and the dashboard grid unchanged. Retain integration class hooks where practical.
- Preserve initial loading/error ownership in `WidgetRenderer`, domain empty/partial states in widgets, and stale data plus an accessible refresh-error notice.
- Scope migrated styles in an appropriate layer before `user-custom` and remove their superseded unlayered rules. Prove ordinary custom CSS can override them without `!important`. Do not turn this into an unrelated app-wide CSS rewrite.
- Mobile summaries, new footprints, changing default sizes and removing metrics are separate product decisions. Current mobile fallback remains unchanged until explicitly selected as work.
- Once a component is accepted, new or migrated equivalent UI uses it. Review/test evidence should catch new style forks; expand an intentional shared variant rather than copying markup/CSS into another widget.

## Validation and completion

For each implementation step, run focused behavior tests and real-browser checks of the selected widget. Verify its declared footprints, four themes, ordinary custom-CSS overrides, loading/empty/error/stale states and relevant long/large content. Measure text/cell bounds and inner scroll dimensions so an outer clipping rule cannot produce a false pass. Preserve keyboard/accessibility behavior and deliberately scrollable lists. Add fixtures as widgets are selected, not all 28 before the first component.

A component is `done` after implementation, tests and owner visual acceptance in an example widget. Its final state is `migration of all widgets complete` only after every intended consumer adopts it. A widget stays `todo` during partial adoption and becomes `migrated` only after all applicable components and variants are verified. Record evidence in the tables with each change; do not rely on chat history.

Follow `AGENTS.md` for the required pre-commit validation sequence: lint, type-check, coverage, nonvisual E2E and production-auth E2E, each with `CI=true`. Commits stay scoped to the selected work. Push, PR and merge state must be reported separately and must not be implied by a local commit.

## Evidence and constraints for future sessions

Source audit baseline: `30c7861` (28 registrations in [src/integrations/index.ts](../src/integrations/index.ts)). The tracker links every current widget implementation. Similar stat markup currently shares some CSS in [globals.css](../src/app/globals.css), but Immich, Radarr, Seerr and other families diverge. [Netdata Sparkline](../src/integrations/netdata/Sparkline.tsx) and [Actual Amount](../src/integrations/actualbudget/Amount.tsx) are existing local shared helpers; their existence does not mean the new library migration is done.

[ServiceTile](../src/components/ServiceTile.tsx), [WidgetRenderer](../src/components/WidgetRenderer.tsx) and [grid geometry](../src/layout/grid.ts) own the rendering/footprint boundary. None of the 28 widgets currently declares a mobile renderer, so they become service links below 720px. The `dimensions` prop describes the outer tile, not measured body space. Existing [Prowlarr](../e2e/tests/prowlarr-widget.spec.ts) and [Plex](../e2e/tests/plex-widget.spec.ts) browser tests are useful starting points; component tests alone cannot prove visual fit.

Observed source facts establish the inventory; proposed library names and mappings are design targets. Exact token values and fit failures remain to be validated in the selected example. If a source discovery or owner decision changes component boundaries, update both tables and this plan before continuing dependent implementation.

## Session handoff

- **Completed:** source inventory and two linked tracking tables; 13 proposed shared components/foundations; 28 widgets, all `todo`.
- **Current selection:** none. Proposed first widget is Immich Stats; proposed first primitive is WidgetMetric with shared tokens.
- **Next session:** get the owner's selection, then implement only that step and show its visual result.
- **Deferred:** choosing exact visual tokens, mobile summaries and any necessary size/content changes. No blanket neutral-color decision or footprint migration has been approved.
- **Validation evidence:** documentation mappings checked against all 28 registry entries; no application code or visual changes in this documentation task. Record implementation test/screenshot evidence in the relevant tracker rows as work starts.
