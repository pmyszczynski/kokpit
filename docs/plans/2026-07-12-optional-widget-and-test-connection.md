# Optional widget config + "Test connection" button

**Date:** 2026-07-12
**Status:** Planned

## Problem

Adding a service through the UI currently forces an all-or-nothing choice:

1. Picking an integration tile type (e.g. "Plex") in `ServiceForm` marks the
   widget's required config fields (`url`, `token`, …) as HTML-`required`, so
   the form cannot be submitted without full widget credentials. You can't
   just add "Plex" with a name + URL and configure the widget later.
2. On save the form always writes `widget: { type, config }`. On the
   dashboard, any `service.widget` mounts `WidgetRenderer`, which renders an
   error box when the config is empty or invalid — instead of a plain tile.
3. There is no way to verify widget credentials from the add/edit form; you
   have to save and watch the dashboard tile fail.

## Decisions (confirmed with owner)

- **YAML shape:** a service with an integration selected but no widget config
  keeps the marker: `widget: { type: plex }` (no `config` key). Re-opening the
  edit form shows Plex still selected; the schema already allows this
  (`config` is optional in `ServiceWidgetSchema`) — no migration needed.
- **Rendering rule:** *any* widget config that fails the widget's
  `configSchema` (empty, partial, or typo'd) renders the service as a plain
  tile — silent degradation, no error box. An **unknown widget type** keeps
  the current "Unknown widget type" error, since that signals a YAML typo of
  `type` itself, not a missing config.
- **Test button:** covers the widget connection only (no generic URL ping in
  the form).

## Changes

### 1. Dashboard: render plain tile when widget config doesn't validate

`src/components/ServiceGrid.tsx` (server component):

- Import `@/integrations` so the widget registry is populated server-side.
- For each service with a `widget`, resolve `getWidget(widget.type)`:
  - Type unknown → pass the widget through unchanged (error box preserved).
  - Type known → run `configSchema.safeParse(widget.config ?? {})`. On
    failure, pass **no widget** to `ServiceTile` → plain tile.
- Pass a **sanitized widget prop** to the client: `{ type,
  refresh_interval_ms }` only. Today `ServiceGrid` serializes the full
  `widget.config` (including tokens) into the RSC payload sent to the
  browser; the widget data API already looks config up server-side by service
  name, so the client never needs it. This closes that leak as part of the
  same change.

`src/components/ServiceTile.tsx`: narrow the `widget` prop type to the
sanitized shape (`{ type: string; refresh_interval_ms?: number }`). No
behavioral change otherwise.

### 2. ServiceForm: widget config becomes optional

`src/components/ServiceForm.tsx`:

- Drop the HTML `required` attribute from widget config fields. Keep the `*`
  marker but reword the widget section with a hint: *"Leave empty to add a
  plain link tile — you can configure the widget later."*
- On submit with a tile type selected, always emit `widget: { type }`;
  attach `config` only when it contains at least one non-empty value.
  Strip empty strings / empty arrays from `widgetConfig` first, so fields
  that were touched and cleared don't count as "configured".
- Live status line in the widget section (client-side `safeParse` against
  the registry's `configSchema`, which is already imported client-side):
  *"Widget active"* vs *"Widget disabled — tile will render as a plain link
  until required fields are filled"*. This keeps the silent dashboard
  degradation from being surprising.
- Same treatment applies to orphan widgets (types without an editor preset):
  they already save whatever raw config exists; no `required` change needed
  there since their fields were never enforced.

### 3. `POST /api/widget/test` — test connection endpoint

New route `src/app/api/widget/test/route.ts`:

- Body: `{ type: string, config: unknown }` — the config comes from the form
  as currently typed (it may not be saved yet, so the existing
  lookup-by-service-name GET route can't be reused).
- **Auth required.** Extract the `checkAuth()` helper currently private to
  `src/app/api/settings/route.ts` into a shared module (e.g.
  `src/app/api/_auth.ts`) and use it here; the settings route adopts the
  shared helper. This endpoint triggers server-side fetches to
  user-supplied URLs with user-supplied credentials, so it must not be
  callable unauthenticated.
- Flow mirrors the GET route: resolve widget (404 if unknown) →
  `configSchema.safeParse` (400 with joined issue messages) → run
  `widget.fetchData(parsed.data, signal)` under an `AbortController` with the
  same 5 s timeout → `{ ok: true }` on success, `{ ok: false, error }` with
  504 (timeout) / 500 (fetch failure) otherwise. No widget data is returned —
  the form only needs pass/fail + message.

### 4. ServiceForm: Test connection button

- A "Test connection" button inside the widget section, next to the config
  fields. Disabled while a test is in flight or when the current config fails
  client-side `safeParse` (no point sending a config we know is incomplete).
- On click: `POST /api/widget/test` with the current `{ type, config }`
  (works for both preset tile types and orphan widgets, which keep raw
  config client-side).
- Inline result states: idle → testing (spinner/label) → success ("Connection
  OK ✓") or error (server's error message). Any config field change resets
  the result to idle so a stale "OK" never lingers over edited credentials.

## Tests

- `src/__tests__/components/ServiceForm.test.tsx`
  - Selecting an integration and saving with empty widget fields succeeds;
    `onSave` receives `widget: { type }` with no `config`.
  - Empty-string values are stripped (config with only `""` values → no
    `config` key).
  - Filling required fields still produces `widget: { type, config }`.
  - Test button: disabled with incomplete config; success and error paths
    with mocked `fetch`; result resets when a config field changes.
- `src/__tests__/components/ServiceGrid.test.tsx` (or `ServiceTile.test.tsx`)
  - Widget with valid config → widget rendered.
  - Widget with missing/partial/invalid config → plain tile, no
    `.service-tile__widget`.
  - Unknown widget type → error box preserved.
  - Sanitized prop: rendered output/props contain no credential values.
- `src/__tests__/api/widget-test.test.ts` (new)
  - 401 when auth enabled and no session; 404 unknown type; 400 invalid
    config; 200 `{ ok: true }` on success; 504 on timeout; 500 with message
    on fetch failure.
- E2E (`e2e/tests`): extend the service-management spec — add a service with
  an integration selected but no widget config, assert it appears as a plain
  tile, then edit it to add config and assert the widget section appears.

## Out of scope / follow-ups

- `GET /api/widget` currently has no auth check (dashboard pages are
  protected, the API route is not). Worth a separate hardening pass together
  with `GET /api/ping` (SSRF surface). Noted here so it isn't forgotten; the
  new test endpoint ships auth-protected from day one.
