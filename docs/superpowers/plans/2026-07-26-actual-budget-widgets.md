# Actual Budget Widgets Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four Actual Budget widgets (`actualbudget-summary`, `actualbudget-categories`, `actualbudget-accounts`, `actualbudget-schedules`) to the kokpit widget system, reading from a self-hosted [`actual-http-api`](https://github.com/jhonderson/actual-http-api) sidecar.

**Roadmap item:** Phase 4 `P1` — Extended integrations (Tier 2) → Finance: Actual Budget.

---

## Architecture & rationale

### Why a sidecar, not `@actual-app/api`

Actual Budget has **no read API**. The `actual-server` speaks an encrypted protobuf/CRDT sync stream; every client (the official Node package, the Python `actualpy` reimplementation) works by downloading the whole budget and reconstructing it as a local SQLite database. There is no "GET my balance" endpoint at any layer.

Embedding `@actual-app/api` would therefore require, inside the kokpit process: a native `better-sqlite3` binary (bundler config, no Edge runtime, glibc/musl-specific prebuilds), a persistent writable `dataDir` volume, a full budget download on cold start, and the user's real Actual server password. It would be the first vendor SDK in a repo where even Unraid's GraphQL API is called with raw `fetch`.

The sidecar re-exposes the same data as plain JSON over HTTP with an `x-api-key` header — **identical in shape to every existing kokpit integration**. Kokpit never sees the Actual server password; the sidecar holds it. Homepage, Homarr and Glance have no native Actual widget either, and their users all point generic custom-API widgets at this same sidecar, so this matches settled ecosystem practice.

**Cost to the user:** one extra container in their compose file. This must be documented prominently — a user who configures the widget against their *Actual server URL* instead of the *sidecar URL* will get confusing errors.

### Data flow

| Widget | Endpoint(s) | Calls |
|---|---|---|
| `actualbudget-summary` | `GET /months/{YYYY-MM}` + `GET /accounts?include_balances=true` | 2 (parallel) |
| `actualbudget-categories` | `GET /months/{YYYY-MM}` | 1 |
| `actualbudget-accounts` | `GET /accounts?include_balances=true` | 1 |
| `actualbudget-schedules` | `GET /schedules` + `GET /payees` (best-effort) | 1 + 1 |

`include_balances=true` returns every account balance in one response — do **not** call the per-account `/balance` endpoint in a loop.

---

## Verified API contract (`actual-http-api`)

Source-verified against tag `26.7.0`. Do not deviate without re-checking the source.

**Base URL shape:** `{sidecar_url}/v1/budgets/{budget_sync_id}/{resource}` — the budget sync ID is a **path segment**, not a header.

**Headers:**
- `x-api-key: {api_key}` — required. The sidecar's own key, *not* the Actual server password. Auth is only enforced when the sidecar runs with `NODE_ENV=production` (the published Docker image sets this).
- `budget-encryption-password: {…}` — optional, only for end-to-end-encrypted budgets, only needed on first contact.

**Success envelope:** every GET returns `{"data": …}`. Never bare.
**Error envelope:** `{"error": "message"}` (bare, never wrapped). `403 {"error":"Forbidden"}` on bad/missing API key. 400/404/500 otherwise with upstream text passed through.

### `GET /accounts?include_balances=true&exclude_closed=&exclude_offbudget=`
```jsonc
{"data": [{
  "id": "…", "name": "Current", "offbudget": false, "closed": false,
  // present only when include_balances=true:
  "clearedBalance": 210412, "unclearedBalance": 0, "workingBalance": 210412
}]}
```
`exclude_closed` is only honoured when `include_balances=true` — we always send `include_balances=true`, so both filters work.

### `GET /months/{YYYY-MM}`
```jsonc
{"data": {
  "month": "2026-07",
  "toBudget": 41200,          // ← "To Be Budgeted"
  "incomeAvailable": …, "fromLastMonth": …, "lastMonthOverspent": …, "forNextMonth": …,
  "totalBudgeted": …, "totalIncome": …, "totalSpent": …, "totalBalance": …,
  "categoryGroups": [{
    "id": "…", "name": "Everyday", "is_income": false, "hidden": false,
    "budgeted": …, "spent": …, "balance": …,        // "received" instead of "spent" on income groups
    "categories": [{
      "id": "…", "name": "Groceries", "is_income": false, "hidden": false, "group_id": "…",
      "budgeted": 40000, "spent": -31200, "balance": 8800, "carryover": false
    }]
  }]
}}
```

### `GET /schedules`
```jsonc
{"data": [{
  "id": "…", "name": "Mortgage", "next_date": "2026-08-01",
  "completed": false, "posts_transaction": false,
  "payee": "payee-id-or-null", "account": "account-id-or-null",
  "amount": -124000,               // OR {"num1":…,"num2":…} when amountOp === "isbetween"
  "amountOp": "is" | "isapprox" | "isbetween",
  "date": "2026-08-01" | { "frequency": "monthly", "interval": 1, … }
}]}
```
`next_date` is always the computed next due date, for both one-off and recurring schedules — **do not decode `date`/`RecurConfig`**; it is only needed if we ever want to display the recurrence rule, which this plan does not.

`payee` is an **ID, not a name**. Resolve via `GET /payees` (`{"data":[{"id","name",…}]}`) — best-effort only.

---

## Critical conventions (get these wrong and the numbers are wrong)

1. **Amounts are integers in the minor currency unit (cents).** `$120.30` → `12030`. Divide by 100 for display.
2. **Sign convention: outflows are negative.** Category `spent` and `totalSpent` come back **negative**. Display `Math.abs(spent)`. Compute "overspent" as `balance < 0`, *never* as `spent > budgeted`.
3. **The API carries no currency information.** Currency and locale must be config fields.
4. **`/categories` (flat) may return `is_income`/`hidden` as raw `0`/`1` integers**, while `/categorygroups` normalises them to real booleans. This plan reads booleans only from the **month** endpoint's nested `categoryGroups`; still coerce defensively in zod (`z.union([z.boolean(), z.number()]).transform(Boolean)` or equivalent) rather than assuming.
5. **`amount` on a schedule may be an object.** Handle `amountOp === "isbetween"` by rendering a range or the midpoint — never `NaN`.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/widgets/index.ts` | Modify | Add optional `fetchTimeoutMs` to `WidgetDefinition` |
| `src/app/api/widget/route.ts` | Modify | Pass `widget.fetchTimeoutMs` into `fetchWithHardTimeout` |
| `src/app/api/widget/test/route.ts` | Modify | Same passthrough |
| `src/integrations/actualbudget/api.ts` | Create | Config schema, HTTP client, 4 fetch functions, types |
| `src/integrations/actualbudget/format.ts` | Create | `formatMoney`, `centsToUnits`, `daysUntil` |
| `src/integrations/actualbudget/Amount.tsx` | Create | Shared privacy-aware amount renderer |
| `src/integrations/actualbudget/summaryWidget.tsx` | Create | Registers `actualbudget-summary` |
| `src/integrations/actualbudget/categoriesWidget.tsx` | Create | Registers `actualbudget-categories` |
| `src/integrations/actualbudget/accountsWidget.tsx` | Create | Registers `actualbudget-accounts` |
| `src/integrations/actualbudget/schedulesWidget.tsx` | Create | Registers `actualbudget-schedules` |
| `src/integrations/index.ts` | Modify | Four new import side-effect lines |
| `src/app/globals.css` | Modify | `.actualbudget-*` widget styles + privacy blur |
| `src/__tests__/integrations/actualbudget.test.ts` | Create | Node-env: api.ts + all 4 registrations |
| `src/__tests__/integrations/ActualBudget{Summary,Categories,Accounts,Schedules}Widget.test.tsx` | Create | Component tests (5 states each) |
| `README.md` | Modify | `### Actual Budget` section under `## Widgets`, incl. compose snippet |
| `settings.example.yaml` | Modify | Commented example service block |
| `AGENTS.md` | Modify | Append to `src/integrations/` prose list |
| `docs/Roadmap.md` | Modify | Note Actual Budget done under Tier 2 |

---

## Task 0: Per-widget fetch timeout (shared layer)

**Why:** `src/app/api/widget/route.ts:54` calls `fetchWithHardTimeout` with the default `WIDGET_FETCH_TIMEOUT_MS = 5000`. A sidecar that is cold-syncing a budget will exceed that and surface as a 504. `WidgetDefinition` currently has no way to override it.

- [ ] Add `fetchTimeoutMs?: number` to `WidgetDefinition` in `src/widgets/index.ts` (documented as "overrides the default 5s widget fetch timeout").
- [ ] In `src/app/api/widget/route.ts`, pass `widget.fetchTimeoutMs` as the third argument to `fetchWithHardTimeout`. Passing `undefined` must keep the 5000 default — verify the parameter default still applies.
- [ ] Same change in `src/app/api/widget/test/route.ts`.
- [ ] Add/extend tests covering: a widget with no `fetchTimeoutMs` still times out at the default, and a widget with one uses it. Locate the existing route tests first and extend them in place rather than creating a parallel file.
- [ ] **No existing widget sets this field** — behaviour for all current widgets must be byte-identical.

---

## Task 1: API layer

**Files:** create `src/integrations/actualbudget/api.ts`, `format.ts`; test `src/__tests__/integrations/actualbudget.test.ts`

### Config schema (shared base)

```ts
const BaseConfigSchema = z.object({
  url: z.string().url(),              // sidecar base URL, e.g. http://actual-http-api:5007
  api_key: z.string().min(1),
  budget_sync_id: z.string().min(1),
  encryption_password: z.string().optional(),
  currency: z.string().length(3).default("USD"),
  locale: z.string().optional(),
  privacy_mode: z.boolean().default(true),
});
```

Per-widget extensions:
- summary — none
- categories — `limit` (int, default 8), `hide_income` (bool, default true), `hide_empty` (bool, default true — omit categories where `budgeted === 0 && spent === 0`)
- accounts — `exclude_closed` (bool, default true), `exclude_offbudget` (bool, default false)
- schedules — `limit` (int, default 6), `days_ahead` (int, default 30)

Match the repo's prevailing style: `z.string().url()`, snake_case keys (consistent with `api_key` elsewhere in settings.yaml).

### Client

One internal helper, in the spirit of `src/integrations/shared/http.ts` but local to this integration because of the path-nesting and second optional header:

```ts
async function actualFetch<T>(config, path, schema, signal): Promise<T>
```
- Builds `new URL(`/v1/budgets/${encodeURIComponent(config.budget_sync_id)}${path}`, config.url)`.
- Sets `x-api-key`, and `budget-encryption-password` only when `encryption_password` is set.
- On non-2xx: parse `{error}` from the body if present and throw `Error(\`Actual Budget responded with ${status}: ${message}\`)`, falling back to `Error(\`Actual Budget responded with ${status}\`)` when the body isn't JSON. **Never include the API key or any header value in the error message.**
- Unwraps the `{data: …}` envelope and validates with the passed zod schema. Use `.passthrough()`/loose object schemas for upstream shapes so a sidecar version bump adding fields doesn't break the widget (the Tdarr precedent).
- Forwards `signal`; does not implement its own timeout (Task 0 owns that).

### Exported functions

- [ ] `fetchAccounts(config, signal)` → `ActualAccount[]` with `{id, name, offbudget, closed, balance}` where `balance = workingBalance ?? clearedBalance ?? 0`. Applies `exclude_closed`/`exclude_offbudget` as query params.
- [ ] `fetchBudgetMonth(config, month, signal)` → normalised `{month, toBudget, totalBudgeted, totalSpent, totalBalance, totalIncome, categories: ActualCategory[]}` where categories are flattened out of `categoryGroups` with their group name attached.
- [ ] `fetchSummary(config, signal)` → `Promise.all([fetchBudgetMonth(current), fetchAccounts])`. **The accounts call is best-effort** (`.catch(() => null)`, Tdarr precedent) so a net-worth failure never blanks the whole summary; the month call is required.
- [ ] `fetchSchedules(config, signal)` → upcoming schedules, `completed === false`, `next_date` within `days_ahead`, sorted ascending by `next_date`, sliced to `limit`. Payee names resolved via a best-effort `GET /payees`; fall back to the schedule's own `name`, then `"—"`.
- [ ] Current month is computed as local-time `YYYY-MM`. Do **not** use `toISOString()` — it is UTC and will pick the wrong month for the first/last hours of a month in non-UTC zones.

### `format.ts`

- [ ] `formatMoney(cents, currency, locale)` — `Intl.NumberFormat(locale, {style:"currency", currency})` over `cents / 100`. Guard against an invalid currency code throwing (`RangeError`) by falling back to a plain number format.
- [ ] `daysUntil(isoDate)` — whole days from today in local time, for the schedules widget.

### Steps

- [ ] **Step 1:** Write `src/__tests__/integrations/actualbudget.test.ts` (`// @vitest-environment node`, `vi.stubGlobal("fetch", …)` — no MSW). Cover: URL construction incl. sync-id path segment and query params; `x-api-key` header; encryption header present only when configured; `{data:…}` unwrapping; `{error:…}` message extraction; 403 handling; **the API key never appearing in a thrown message**; negative-`spent` handling; `amountOp: "isbetween"` object amount; best-effort payee/accounts failure paths; local-time month computation.
- [ ] **Step 2:** Create stub `api.ts`/`format.ts` with signatures throwing `not implemented`, plus four empty stub widget files so the barrel import in Task 3 doesn't fail.
- [ ] **Step 3:** Run `npm test -- src/__tests__/integrations/actualbudget.test.ts` — confirm failures.
- [ ] **Step 4:** Implement `api.ts` + `format.ts`.
- [ ] **Step 5:** Re-run — API tests pass (registration tests still fail, stubs are empty).
- [ ] **Step 6:** Commit.

---

## Task 2: Widget components

**Files:** create the four `*Widget.tsx` + `Amount.tsx`; modify `src/app/globals.css`

### Shared rendering rules (all four)

Follow the established kokpit widget contract exactly:
- `({ data, loading, error, refresh }: WidgetProps<T>)`.
- `if (!data)` → `<div className="actualbudget-x-widget actualbudget-x-widget--empty">` with a `__hint` (loading) / `__hint __hint--error` (error) / nothing (true empty).
- When `data` **and** `error` are both present, render the data plus a separate `<span className="…__stale-error" role="alert">{error}</span>` — the "stale error" pattern the tests assert on.
- Do not handle top-level spinner/crash states; `WidgetRenderer`/`WidgetErrorBoundary` own those.

### `Amount.tsx`

```tsx
<Amount cents={…} currency={…} locale={…} />  →  <span className="actualbudget-amount">…</span>
```
Add `actualbudget-amount--negative` when `cents < 0` so CSS can colour it. Privacy is **not** per-amount: the widget root gets `actualbudget-widget--private` when `privacy_mode` is on, and CSS blurs all descendant `.actualbudget-amount`, clearing on `:hover`/`:focus-within` of the root. One hover reveals the whole widget, which is far better UX than per-figure hover, and keeps the text readable to screen readers (blur is presentational only — do **not** add `aria-hidden`).

### Widgets

- [ ] **`summaryWidget.tsx`** — `actualbudget-summary`, name "Actual Budget Summary", `preferredSize: "normal"`. Six stats: To Assign (`toBudget`), Budgeted, Spent (abs), Remaining (`totalBalance`), overspent-category count (`categories.filter(c => c.balance < 0).length`), Net Worth (sum of account balances; render `—` when the best-effort accounts call failed).
- [ ] **`categoriesWidget.tsx`** — `actualbudget-categories`, `preferredSize: "tall"`. Per-category row: name, `spent/budgeted`, progress bar. Reuse `calcProgress` from `src/integrations/shared/queue.ts` and the Radarr-queue progress-bar CSS patterns. Colour modifier classes: `--ok` / `--warn` (≥85%) / `--over` (`balance < 0`). Apply `hide_income`, `hide_empty`, `limit`; sort by percentage spent descending.
- [ ] **`accountsWidget.tsx`** — `actualbudget-accounts`, `preferredSize: "tall"`. Row per account: name, off-budget marker, balance. Footer total row labelled "Net worth".
- [ ] **`schedulesWidget.tsx`** — `actualbudget-schedules`, `preferredSize: "tall"`. Row per schedule: payee/name, amount, relative due ("2d", "today", "overdue"). Footer: count due within 7 days.

All four: `refreshInterval: 300_000` (5 min — budget data is slow-moving and every sidecar request may trigger a sync; do not hammer it), `fetchTimeoutMs: 15_000`, and a `serviceEditorPreset` of `{ defaultName: "Actual Budget", defaultIconUrl: … }`.

- [ ] **Verify the icon slug before hardcoding it.** Read how `src/integrations/tdarr/statsWidget.tsx` and a Radarr widget spell `defaultIconUrl` and match that form exactly. Confirm the Actual Budget slug resolves (dashboard-icons and selfh.st both publish one; `di-actual-budget` is the expected form) — if it cannot be confirmed, use the same fallback style as an existing widget rather than inventing a URL.
- [ ] `configFields` must mirror the config schema, with `api_key` and `encryption_password` as `type: "password"`. Give `url` a `description` that says explicitly **"URL of your actual-http-api sidecar, not your Actual Budget server"** — this is the single most likely misconfiguration.

### CSS

- [ ] One `/* ── Actual Budget widgets ── */` block in `src/app/globals.css`. Join the existing shared stat-grid rule set for the summary widget's `__stat`/`__value`/`__label` if it fits; add dedicated rules for the list/progress-bar widgets.
- [ ] Privacy rules:
```css
.actualbudget-widget--private .actualbudget-amount { filter: blur(0.35rem); transition: filter .15s ease; }
.actualbudget-widget--private:hover .actualbudget-amount,
.actualbudget-widget--private:focus-within .actualbudget-amount { filter: none; }
```
Use existing theme CSS variables for all colours — no hardcoded hex. Custom CSS must be able to override without `!important` (project non-negotiable #5).

- [ ] Commit.

---

## Task 3: Registration & wiring

- [ ] `src/integrations/index.ts` — add four import lines.
- [ ] Confirm all four appear in the tile-type picker (they will, automatically, via `serviceEditorPreset`).
- [ ] `npm test` — full suite green.
- [ ] Commit.

---

## Task 4: Component tests

**Files:** four `src/__tests__/integrations/ActualBudget*Widget.test.tsx`

- [ ] Each covers the five required states: normal render, loading-only, error-only, stale-error (data **and** error), and the `--empty` class.
- [ ] Plus per-widget specifics: negative/abs formatting of spent; overspent colour class; privacy class present when `privacy_mode` on and absent when off; `isbetween` schedule amount; empty-list rendering (no accounts / no upcoming schedules); `limit` truncation.
- [ ] Extend `actualbudget.test.ts` with a `describe("actualbudget widget registration")` block using `clearRegistry()` + dynamic `await import(...)`, asserting id, name, refreshInterval, `fetchTimeoutMs`, preferredSize, serviceEditorPreset, and configSchema accept/reject cases for all four.
- [ ] Commit.

---

## Task 5: Documentation

- [ ] **`README.md`** — new `### Actual Budget` section under `## Widgets`, placed after Tdarr, matching the existing per-integration structure (description → Prerequisites → `#### {widget-id}` per widget → YAML example → Config fields table → Displayed stats table → `---`).
  - **Must lead with the sidecar requirement** and include a ready-to-paste `docker-compose.yml` snippet for `jhonderson/actual-http-api` showing `ACTUAL_SERVER_URL`, `ACTUAL_SERVER_PASSWORD`, `API_KEY`, and a `/data` volume.
  - Explain the three distinct secrets so they can't be confused: the **Actual server password** (goes in the sidecar only), the **sidecar `API_KEY`** (goes in kokpit's `api_key`), and the optional **budget encryption password**.
  - Say where the Sync ID comes from: Actual → Settings → Show advanced settings → Sync ID.
  - Note: pin the sidecar image tag to match your Actual server version line; a mismatch produces cryptic errors.
  - Note the privacy blur behaviour and `privacy_mode: false` to disable.
- [ ] **`settings.example.yaml`** — commented example block after Tdarr's, showing all four widget types.
- [ ] **`AGENTS.md`** — append "Actual Budget" to the `src/integrations/` prose list (line ~68).
- [ ] **`docs/Roadmap.md`** — under Phase 4 `P1` "Extended integrations (Tier 2)", mark the Finance line as partially done, noting Actual Budget shipped and Firefly III still open. Follow the existing style for partially-complete items (nested `[x]`/`[ ]` sub-bullets, as used in the Theme engine and Mobile-responsive entries).
- [ ] Commit.

---

## Task 6: Gate & PR

- [ ] `npm run lint && npm run type-check && npm test` — all green.
- [ ] Push to `claude/actual-budget-integration-pl272w`.
- [ ] Open a **draft** PR. Per `AGENTS.md`, a PR opened via the API may produce no CI run at all — verify with `pull_request_read` / `get_check_runs` and push a commit or mark ready-for-review if `ci.yml` jobs are absent. E2E only runs in CI; a green local gate is not a substitute.

---

## Out of scope

- Write operations (creating transactions, setting budget amounts). Read-only by design.
- ActualQL `/run-query` passthrough — explicitly undocumented internals per Actual's own docs, and unnecessary given the endpoints above cover every field these four widgets need.
- Decoding `RecurConfig` to display recurrence rules — `next_date` is sufficient.
- Supporting a direct `@actual-app/api` embed as an alternative backend.
