# Tautulli Activity Widget — Design Spec

**Date:** 2026-07-25
**Status:** Approved

---

## Overview

Add one configurable Tautulli integration to Kokpit:

- `tautulli-activity` — current playback activity with an optional aggregate
  summary, an optional active-session list, or both.

The widget uses Tautulli's read-only API v2 `get_activity` command. It does not
fetch watch history. The default configuration displays both sections.

Tautulli currently appears only inside the broad, incomplete Phase 4 Tier-2
analytics item in `docs/Roadmap.md`; the detailed Phase 2 P0 item is Tdarr, a
different product. The roadmap will therefore be restructured so Tautulli can
be checked independently without marking Grafana or all Tier-2 integrations
complete.

---

## User-Facing Configuration

```yaml
services:
  - name: Tautulli
    url: http://192.168.1.10:8181
    widget:
      type: tautulli-activity
      config:
        url: http://192.168.1.10:8181
        api_key: YOUR_API_KEY
        sections:
          - summary
          - sessions
```

The widget configuration schema is:

```ts
const TautulliConfigSchema = z.object({
  url: z.string().url(),
  api_key: z.string().min(1),
  sections: z
    .array(z.enum(["summary", "sessions"]))
    .min(1)
    .default(["summary", "sessions"]),
});
```

The service editor exposes:

- `url` as a required URL field.
- `api_key` as a required password field.
- `sections` as a "Display sections" multiselect with "Summary" and
  "Active sessions" options.

At least one section must be selected. Users can display the summary only, the
session list only, or both. Existing YAML that omits `sections` receives the
default of both sections at widget-validation time without rewriting the YAML.

---

## Files and Registration

```text
src/integrations/tautulli/
  api.ts                 API configuration, upstream schemas, normalization,
                         privacy filtering, and exported widget-facing types
  activityWidget.tsx     component and "tautulli-activity" registration

src/__tests__/integrations/
  tautulli.test.ts
  TautulliActivityWidget.test.tsx
```

`src/integrations/index.ts` will import
`./tautulli/activityWidget` so the existing client and server widget registries
discover it.

No Tautulli-specific Next.js route or top-level config-schema change is
required. The existing authenticated `/api/widget` and `/api/widget/test`
routes validate widget configuration, keep credentials server-side, apply the
hard timeout, and expose the registered widget automatically.

The widget registration will use:

```ts
{
  id: "tautulli-activity",
  name: "Tautulli Activity",
  refreshInterval: 10_000,
  preferredSize: "large",
  minSize: "wide"
}
```

Its service-editor preset uses "Tautulli" as the default tile name and the
verified Dashboard Icons asset:

```text
https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main/svg/tautulli.svg
```

---

## API Request and Authentication

The server normalizes the configured base URL while preserving any reverse
proxy base path, then sends:

```text
GET <base-url>/api/v2?apikey=<api-key>&cmd=get_activity
```

Tautulli documents API-key authentication through the `apikey` query
parameter; the integration will not invent header authentication. The API key
is used only by the server-side fetcher and is never returned to the browser,
rendered into markup, or included in an error message.

The fetcher:

1. Preserves a configured HTTP root such as
   `https://example.test/tautulli/`.
2. Forwards the provided `AbortSignal`.
3. Rejects non-2xx HTTP responses.
4. Parses JSON and validates Tautulli's
   `{ response: { result, message, data } }` envelope.
5. Treats any result other than `success` as an API failure, even when the
   HTTP status is 2xx.
6. Accepts documented numeric fields supplied as either numbers or numeric
   strings, applies finite-number fallbacks, and clamps progress to 0–100.
7. Returns a minimized widget-facing object containing only the configured
   sections.

The request URL, query string, and API key must never appear in thrown errors.
HTTP failures use `Tautulli responded with <status>`. Invalid JSON and invalid
response shapes use bounded service-specific messages. An API-envelope message
may be included only after removing line breaks, limiting it to 200 characters,
and ensuring it cannot contain the configured API key.

---

## Widget-Facing Data

```ts
type TautulliSection = "summary" | "sessions";

interface TautulliSummary {
  streamCount: number;
  directPlayCount: number;
  directStreamCount: number;
  transcodeCount: number;
  totalBandwidthKbps: number;
}

interface TautulliSession {
  username: string;
  title: string;
  progressPercent: number;
  state: string;
  mediaType: string;
  transcodeDecision: string;
}

interface TautulliActivityData {
  summary?: TautulliSummary;
  sessions?: TautulliSession[];
}
```

Summary values map from Tautulli's `stream_count`,
`stream_count_direct_play`, `stream_count_direct_stream`,
`stream_count_transcode`, and `total_bandwidth`.

For each active session:

- `username` resolves from `username`, then `user`, then `friendly_name`, then
  `"Unknown user"`.
- `title` resolves from `full_title`, then `title`, then `"Unknown title"`.
- Missing `state`, `media_type`, or `transcode_decision` becomes `"unknown"`.
- Missing or invalid progress becomes `0`.

The session list is sourced only from `get_activity.response.data.sessions`.
The aggregate stream count remains authoritative rather than being derived
from the session array.

Even though Tautulli returns richer session objects, Kokpit deliberately
discards email addresses, IP addresses, machine and device identifiers, file
paths, player/platform details, and artwork URLs before data crosses the
server/client boundary.

---

## Presentation

### Summary section

Render one compact row containing:

- Active
- Direct Play
- Direct Stream
- Transcoding
- Bandwidth

Bandwidth is formatted from kilobits per second into `Kbps`, `Mbps`, or `Gbps`
using decimal units. The row remains usable at the minimum `wide` tile size.

### Active sessions section

Render a vertically scrollable list. Each entry contains:

- Username and playback state.
- Media title and transcode mode.
- A progress bar with a visible percentage.

An empty list displays "No active streams." User-provided upstream strings are
rendered as ordinary React text, not HTML.

When both sections are enabled, the summary remains fixed above the scrollable
session list. The default `large` tile size gives the list useful vertical
space. A summary-only or sessions-only tile can be resized by the user while
respecting the widget's `wide` minimum.

The component follows existing widget state conventions:

- No data plus loading: show a loading hint.
- No data plus error: show the error.
- Data plus a refresh error: keep the data visible and show an alert.
- Data with an empty sessions array: show the explicit empty state.

---

## Error Handling

- Network and abort behavior remains governed by the existing widget route and
  hard-timeout wrapper.
- Non-2xx responses fail even if a response body resembles a success envelope.
- A 2xx response with `result: "error"` also fails.
- Malformed JSON or missing envelope data fails with a Tautulli-specific
  message rather than leaking parser internals.
- A missing or non-array `sessions` field is normalized to an empty session
  list because aggregate activity data remains independently useful.
- Optional fields within an otherwise valid activity response use the
  documented fallbacks instead of failing the entire widget.
- Refresh failures preserve the last successful data through the existing
  `useWidget` behavior.

---

## Testing

### API and registration tests

`src/__tests__/integrations/tautulli.test.ts` will verify:

- Base URL and reverse-proxy HTTP-root normalization.
- `cmd=get_activity` and query-parameter API-key authentication.
- API-key absence from thrown error messages.
- `AbortSignal` forwarding.
- Successful parsing of numeric strings and numbers.
- Summary field mapping and progress clamping.
- Username, title, and optional-field fallbacks.
- Privacy minimization of session records.
- Summary-only, sessions-only, and combined returned data.
- HTTP error, API-envelope error, malformed JSON, and malformed envelope
  behavior.
- Widget registration metadata, refresh interval, size hints, editor preset,
  config fields, defaults, and rejection of empty or unknown section
  selections.

### Component tests

`src/__tests__/integrations/TautulliActivityWidget.test.tsx` will verify:

- Summary-only rendering and bandwidth formatting.
- Sessions-only rendering.
- Combined rendering.
- Username, title, state, transcode mode, percentage, and progress semantics.
- Empty active-session state.
- Loading, initial error, and stale-data error states.
- Absence of an unselected section.

The focused tests run first during TDD. Completion verification runs the full
unit suite, ESLint, and TypeScript checking.

---

## Documentation and Roadmap

`README.md` will gain a Tautulli widget section covering:

- API-key prerequisites.
- The YAML example.
- The three valid section combinations.
- Displayed summary and session fields.
- The fact that usernames are intentionally displayed.
- The sensitive Tautulli fields that Kokpit intentionally discards.

`settings.example.yaml` will gain a commented example with both sections
enabled.

The Phase 4 extended-integrations analytics line in `docs/Roadmap.md` will be
expanded into independently trackable nested items. Tautulli will be marked
complete with its delivered activity-widget scope; Grafana and the parent
Tier-2 integration item will remain incomplete.

---

## Out of Scope

- Watch history and recently watched lists.
- Tautulli user email, IP, device, machine, path, player, platform, and artwork
  fields.
- API-key creation or management.
- Configuration of Tautulli itself.
- Shared fetch caching across multiple Tautulli widgets.
- A second Tautulli widget.
- Grafana or any other Tier-2 integration.
