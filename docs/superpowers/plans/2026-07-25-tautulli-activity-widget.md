# Tautulli Activity Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one configurable Tautulli widget that displays aggregate current
activity, a privacy-minimized active-session list with usernames, or both.

**Architecture:** A dedicated server-side API module calls Tautulli API v2's
`get_activity`, validates its envelope, normalizes mixed upstream types, and
returns only the selected DTO sections. A registered React widget renders the
summary and session list through the existing generic widget routes, while a
small generic config-field default capability keeps the service editor's
multiselect state aligned with the Zod default.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Zod 4, Vitest,
Testing Library, CSS custom properties.

## Global Constraints

- Widget ID is exactly `tautulli-activity`.
- Configuration keys are exactly `url`, `api_key`, and `sections`.
- `sections` accepts only `summary` and `sessions`, requires at least one, and
  defaults to `["summary", "sessions"]`.
- Authentication uses Tautulli's documented `apikey` query parameter and never
  sends the API key to the browser.
- Fetch only the read-only `get_activity` command; do not fetch watch history.
- Browser-visible session data is limited to username, title, progress, state,
  media type, and transcode decision.
- Discard email, IP, machine/device, path, player/platform, and artwork fields.
- Preserve configured reverse-proxy base paths and forward `AbortSignal`.
- Never include the request URL, query string, or API key in an error.
- Use `refreshInterval: 10_000`, `preferredSize: "large"`, and
  `minSize: "wide"`.
- Custom CSS remains able to override widget styles without `!important`.
- Follow TDD: demonstrate each focused test failing before production changes.

---

## File Structure

### New files

- `src/integrations/tautulli/api.ts` — config schema, upstream validation,
  error sanitization, data minimization, and `fetchActivity`.
- `src/integrations/tautulli/activityWidget.tsx` — formatting, rendering, and
  widget registration.
- `src/__tests__/integrations/tautulli.test.ts` — API and registration tests.
- `src/__tests__/integrations/TautulliActivityWidget.test.tsx` — component
  tests.

### Modified files

- `src/widgets/index.ts` — add optional `defaultValue` config-field metadata.
- `src/components/ServiceForm.tsx` — render a field's default only when saved
  config has no value.
- `src/__tests__/components/ServiceForm.test.tsx` — verify default sections,
  deselection, and saved explicit selection.
- `src/integrations/index.ts` — register the new widget by side-effect import.
- `src/app/globals.css` — Tautulli summary, list, progress, empty, and error
  styles.
- `README.md` — prerequisites, YAML, sections, fields, and privacy behavior.
- `settings.example.yaml` — commented Tautulli example.
- `docs/Roadmap.md` — independently mark Tautulli complete while leaving
  Grafana and Tier 2 incomplete.

---

### Task 1: Tautulli API client and privacy-minimized DTO

**Files:**

- Create: `src/integrations/tautulli/api.ts`
- Create: `src/__tests__/integrations/tautulli.test.ts`

**Interfaces:**

- Produces:

```ts
export const TAUTULLI_SECTIONS = ["summary", "sessions"] as const;
export type TautulliSection = (typeof TAUTULLI_SECTIONS)[number];

export const TautulliConfigSchema = z.object({
  url: z.string().url(),
  api_key: z.string().min(1),
  sections: z
    .array(z.enum(TAUTULLI_SECTIONS))
    .min(1)
    .default(["summary", "sessions"]),
});
export type TautulliConfig = z.infer<typeof TautulliConfigSchema>;

export interface TautulliSummary {
  streamCount: number;
  directPlayCount: number;
  directStreamCount: number;
  transcodeCount: number;
  totalBandwidthKbps: number;
}

export interface TautulliSession {
  username: string;
  title: string;
  progressPercent: number;
  state: string;
  mediaType: string;
  transcodeDecision: string;
}

export interface TautulliActivityData {
  summary?: TautulliSummary;
  sessions?: TautulliSession[];
}

export async function fetchActivity(
  config: TautulliConfig,
  signal?: AbortSignal
): Promise<TautulliActivityData>;
```

- Consumes only platform `fetch`, `URL`, `AbortSignal`, and Zod.

- [ ] **Step 1: Write failing API tests**

Create a node-environment test with a success envelope containing mixed numeric
strings/numbers and deliberately sensitive fields:

```ts
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchActivity,
  TautulliConfigSchema,
} from "@/integrations/tautulli/api";
import type { TautulliConfig } from "@/integrations/tautulli/api";

const BASE_CONFIG: TautulliConfig = {
  url: "http://tautulli.local:8181",
  api_key: "super-secret-key",
  sections: ["summary", "sessions"],
};

const ACTIVITY_RESPONSE = {
  response: {
    result: "success",
    message: null,
    data: {
      stream_count: "2",
      stream_count_direct_play: 1,
      stream_count_direct_stream: "0",
      stream_count_transcode: 1,
      total_bandwidth: "12500",
      sessions: [
        {
          username: "alice",
          user: "legacy-alice",
          friendly_name: "Alice Friendly",
          full_title: "The Expanse · S02E05",
          title: "Home",
          progress_percent: "42.8",
          state: "playing",
          media_type: "episode",
          transcode_decision: "transcode",
          email: "alice@example.test",
          ip_address: "203.0.113.5",
          machine_id: "private-machine",
          file: "/media/private/file.mkv",
          platform: "Private Device",
          thumb: "/library/metadata/1/thumb/1",
        },
      ],
    },
  },
};
```

Add tests that assert:

```ts
expect(await fetchActivity(BASE_CONFIG)).toEqual({
  summary: {
    streamCount: 2,
    directPlayCount: 1,
    directStreamCount: 0,
    transcodeCount: 1,
    totalBandwidthKbps: 12500,
  },
  sessions: [{
    username: "alice",
    title: "The Expanse · S02E05",
    progressPercent: 42.8,
    state: "playing",
    mediaType: "episode",
    transcodeDecision: "transcode",
  }],
});
```

Cover these exact cases in the same test file:

```ts
it("preserves a reverse-proxy HTTP root and sends documented query auth");
it("forwards the AbortSignal");
it("returns only summary when sections is summary-only");
it("returns only sessions when sections is sessions-only");
it("uses username, user, friendly_name, and neutral fallbacks in that order");
it("uses full_title, title, and a neutral fallback in that order");
it("clamps progress to zero through one hundred");
it("normalizes missing or non-array sessions to an empty list");
it("normalizes absent or non-finite optional metrics to zero");
it("throws a status-only message for non-2xx responses");
it("rejects an error envelope and redacts the configured API key");
it("rejects invalid JSON with a Tautulli-specific message");
it("rejects a malformed success envelope");
it("defaults omitted sections to summary and sessions");
it("rejects an empty sections array");
it("rejects unknown section names");
```

For URL assertions, parse the first fetch argument and assert:

```ts
expect(url.pathname).toBe("/root/tautulli/api/v2");
expect(url.searchParams.get("cmd")).toBe("get_activity");
expect(url.searchParams.get("apikey")).toBe("super-secret-key");
```

For privacy, assert the serialized result contains none of:

```ts
expect(JSON.stringify(result)).not.toMatch(
  /alice@example|203\.0\.113\.5|private-machine|private\/file|Private Device|thumb/
);
```

- [ ] **Step 2: Run the API tests and confirm the expected failure**

Run:

```bash
npx vitest run src/__tests__/integrations/tautulli.test.ts
```

Expected: FAIL because `@/integrations/tautulli/api` does not exist.

- [ ] **Step 3: Implement the config and upstream schemas**

In `api.ts`, implement:

```ts
import { z } from "zod";

export const TAUTULLI_SECTIONS = ["summary", "sessions"] as const;
export type TautulliSection = (typeof TAUTULLI_SECTIONS)[number];

export const TautulliConfigSchema = z.object({
  url: z.string().url(),
  api_key: z.string().min(1),
  sections: z
    .array(z.enum(TAUTULLI_SECTIONS))
    .min(1)
    .default(["summary", "sessions"]),
});
export type TautulliConfig = z.infer<typeof TautulliConfigSchema>;

const NumericValueSchema = z
  .union([z.number(), z.string()])
  .transform((value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  })
  .catch(0);

const NullableTextSchema = z.string().nullish();

const RawSessionSchema = z.object({
  username: NullableTextSchema,
  user: NullableTextSchema,
  friendly_name: NullableTextSchema,
  full_title: NullableTextSchema,
  title: NullableTextSchema,
  progress_percent: NumericValueSchema.optional().default(0),
  state: NullableTextSchema,
  media_type: NullableTextSchema,
  transcode_decision: NullableTextSchema,
});

const ActivityDataSchema = z.object({
  stream_count: NumericValueSchema.optional().default(0),
  stream_count_direct_play: NumericValueSchema.optional().default(0),
  stream_count_direct_stream: NumericValueSchema.optional().default(0),
  stream_count_transcode: NumericValueSchema.optional().default(0),
  total_bandwidth: NumericValueSchema.optional().default(0),
  sessions: z.array(RawSessionSchema).catch([]).optional().default([]),
});

const EnvelopeSchema = z.object({
  response: z.object({
    result: z.string(),
    message: z.string().nullish(),
    data: z.unknown(),
  }),
});
```

Define the exported DTO interfaces exactly as listed in this task's interface
block.

- [ ] **Step 4: Implement safe errors, URL construction, and mapping**

Use these helpers and behavior:

```ts
function withTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function nonBlank(value: string | null | undefined, fallback: string): string {
  return value?.trim() ? value : fallback;
}

function sanitizeApiMessage(
  message: string | null | undefined,
  apiKey: string
): string {
  const cleaned = (message ?? "")
    .replaceAll(apiKey, "[redacted]")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 200);
  return cleaned
    ? `Tautulli API error: ${cleaned}`
    : "Tautulli API request failed";
}
```

`fetchActivity` must:

```ts
const url = new URL("api/v2", withTrailingSlash(config.url));
url.searchParams.set("apikey", config.api_key);
url.searchParams.set("cmd", "get_activity");

const response = await fetch(url.toString(), { signal });
if (!response.ok) {
  throw new Error(`Tautulli responded with ${response.status}`);
}
```

Catch only JSON decoding and convert it to
`Tautulli returned invalid JSON`. Parse the envelope separately. If
`result !== "success"`, throw `sanitizeApiMessage`. Parse `response.data` with
`ActivityDataSchema`; convert its Zod failure to
`Tautulli returned an invalid activity response`.

Clamp session progress with:

```ts
Math.min(100, Math.max(0, raw.progress_percent))
```

Construct the result conditionally:

```ts
const selected = new Set(config.sections);
return {
  ...(selected.has("summary") ? { summary } : {}),
  ...(selected.has("sessions") ? { sessions } : {}),
};
```

- [ ] **Step 5: Run the focused API tests**

Run:

```bash
npx vitest run src/__tests__/integrations/tautulli.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run focused static checks**

Run:

```bash
npx eslint src/integrations/tautulli/api.ts src/__tests__/integrations/tautulli.test.ts
npx tsc --noEmit
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit the API task**

```bash
git add src/integrations/tautulli/api.ts src/__tests__/integrations/tautulli.test.ts
git commit -m "feat(tautulli): add activity API client"
```

---

### Task 2: Configurable widget UI, registration, defaults, and styles

**Files:**

- Create: `src/integrations/tautulli/activityWidget.tsx`
- Create: `src/__tests__/integrations/TautulliActivityWidget.test.tsx`
- Modify: `src/__tests__/integrations/tautulli.test.ts`
- Modify: `src/widgets/index.ts`
- Modify: `src/components/ServiceForm.tsx`
- Modify: `src/__tests__/components/ServiceForm.test.tsx`
- Modify: `src/integrations/index.ts`
- Modify: `src/app/globals.css`

**Interfaces:**

- Consumes all Task 1 exports.
- Adds to `WidgetConfigField`:

```ts
defaultValue?: string | number | string[];
```

- Produces:

```ts
export function formatBandwidth(kbps: number): string;
export function TautulliActivityWidget(
  props: WidgetProps<TautulliActivityData>
): React.ReactElement;
```

- Registers `getWidget("tautulli-activity")`.

- [ ] **Step 1: Write failing component tests**

Create `TautulliActivityWidget.test.tsx` with this representative combined
fixture:

```ts
const SAMPLE_DATA = {
  summary: {
    streamCount: 2,
    directPlayCount: 1,
    directStreamCount: 0,
    transcodeCount: 1,
    totalBandwidthKbps: 12_500,
  },
  sessions: [{
    username: "alice",
    title: "The Expanse · S02E05",
    progressPercent: 42.8,
    state: "playing",
    mediaType: "episode",
    transcodeDecision: "transcode",
  }],
};
```

Cover:

```ts
it("renders the five summary values and labels");
it("formats bandwidth as Kbps, Mbps, and Gbps at decimal thresholds");
it("renders username, state, title, media type, and transcode mode");
it("renders an accessible clamped progress bar and rounded percentage");
it("renders summary-only data without a session list");
it("renders sessions-only data without a summary row");
it('shows "No active streams" for an empty selected session list');
it("shows loading when data is null");
it("shows an initial error when data is null");
it("keeps data visible with a stale error alert");
it("renders the empty CSS state when data, loading, and error are absent");
```

Use accessible assertions:

```ts
expect(screen.getByRole("progressbar", { name: /alice progress/i }))
  .toHaveAttribute("aria-valuenow", "43");
expect(screen.queryByLabelText("Tautulli summary")).not.toBeInTheDocument();
expect(screen.queryByLabelText("Active Tautulli sessions")).not.toBeInTheDocument();
```

- [ ] **Step 2: Add failing registration and service-form tests**

Append registration assertions to `tautulli.test.ts`:

```ts
expect(widget.id).toBe("tautulli-activity");
expect(widget.name).toBe("Tautulli Activity");
expect(widget.refreshInterval).toBe(10_000);
expect(widget.preferredSize).toBe("large");
expect(widget.minSize).toBe("wide");
expect(widget.serviceEditorPreset).toEqual({
  defaultName: "Tautulli",
  defaultIconUrl:
    "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main/svg/tautulli.svg",
});
expect(widget.configFields?.map((field) => field.key)).toEqual([
  "url",
  "api_key",
  "sections",
]);
```

Add a `ServiceForm – Tautulli defaults` test that:

1. Selects `tautulli-activity`.
2. Asserts name and icon are prefilled.
3. Asserts the `Summary` and `Active sessions` checkboxes are checked before
   user interaction.
4. Fills URL and API key.
5. Unchecks `Summary`.
6. Attempts to uncheck `Active sessions` and confirms it remains checked
   because a required multiselect cannot be empty.
7. Saves and expects:

```ts
widget: {
  type: "tautulli-activity",
  config: {
    url: "http://tautulli.local:8181",
    api_key: "secret",
    sections: ["sessions"],
  },
}
```

Add a second form test that leaves both default checkboxes untouched, saves
after filling URL and API key, and verifies `sections` is omitted from the
stored config while:

```ts
const parsed = getWidget("tautulli-activity")!.configSchema.safeParse(
  saved.widget!.config
);
expect(parsed.success).toBe(true);
if (!parsed.success) throw parsed.error;
expect(parsed.data.sections).toEqual(["summary", "sessions"]);
```

This confirms the schema still applies both sections.

- [ ] **Step 3: Run the UI tests and confirm the expected failures**

Run:

```bash
npx vitest run \
  src/__tests__/integrations/TautulliActivityWidget.test.tsx \
  src/__tests__/integrations/tautulli.test.ts \
  src/__tests__/components/ServiceForm.test.tsx
```

Expected: FAIL because the component/registration and default metadata do not
exist.

- [ ] **Step 4: Add generic config-field default rendering**

In `src/widgets/index.ts`, extend `WidgetConfigField`:

```ts
/** Initial editor value when the saved widget config omits this key. */
defaultValue?: string | number | string[];
```

In `WidgetConfigFields`, replace:

```ts
const value = config[field.key];
```

with:

```ts
const value = config[field.key] ?? field.defaultValue;
```

After computing `next` in the multiselect change handler, keep the final
required option selected:

```ts
if (field.required && next.length === 0) return;
onChange(field.key, next);
```

Do not mutate or materialize defaults in saved YAML until the user changes the
field. Zod remains the source of truth when an untouched field is omitted.

- [ ] **Step 5: Implement formatting, component, and registration**

`formatBandwidth` uses decimal thresholds:

```ts
export function formatBandwidth(kbps: number): string {
  if (kbps >= 1_000_000) return `${(kbps / 1_000_000).toFixed(1)} Gbps`;
  if (kbps >= 1_000) return `${(kbps / 1_000).toFixed(1)} Mbps`;
  return `${kbps.toFixed(0)} Kbps`;
}
```

Implement `TautulliActivityWidget` with this outer state structure:

```tsx
if (!data) {
  return (
    <div className="tautulli-activity-widget tautulli-activity-widget--empty">
      {loading && <span className="tautulli-activity-widget__hint">Loading&hellip;</span>}
      {error && (
        <span className="tautulli-activity-widget__hint tautulli-activity-widget__hint--error">
          {error}
        </span>
      )}
    </div>
  );
}

return (
  <div className="tautulli-activity-widget" aria-label="Tautulli activity">
    {data.summary && (
      <div className="tautulli-activity-widget__summary" aria-label="Tautulli summary">
        {[
          ["Active", String(data.summary.streamCount)],
          ["Direct Play", String(data.summary.directPlayCount)],
          ["Direct Stream", String(data.summary.directStreamCount)],
          ["Transcoding", String(data.summary.transcodeCount)],
          ["Bandwidth", formatBandwidth(data.summary.totalBandwidthKbps)],
        ].map(([label, value]) => (
          <div className="tautulli-activity-widget__stat" key={label}>
            <span className="tautulli-activity-widget__value">{value}</span>
            <span className="tautulli-activity-widget__label">{label}</span>
          </div>
        ))}
      </div>
    )}
    {data.sessions && (
      <div
        className="tautulli-activity-widget__sessions"
        aria-label="Active Tautulli sessions"
      >
        {data.sessions.length === 0
          ? <span className="tautulli-activity-widget__no-sessions">No active streams</span>
          : data.sessions.map((session, index) => {
              const progress = Math.round(
                Math.min(100, Math.max(0, session.progressPercent))
              );
              return (
                <div
                  className="tautulli-activity-widget__session"
                  key={`${session.username}:${session.title}:${index}`}
                >
                  <div className="tautulli-activity-widget__session-heading">
                    <span className="tautulli-activity-widget__username">
                      {session.username}
                    </span>
                    <span>{formatLabel(session.state)}</span>
                  </div>
                  <div className="tautulli-activity-widget__session-media">
                    <span className="tautulli-activity-widget__title">
                      {session.title}
                    </span>
                    <span>
                      {formatLabel(session.mediaType)} ·{" "}
                      {formatLabel(session.transcodeDecision)}
                    </span>
                  </div>
                  <div
                    className="tautulli-activity-widget__progress"
                    role="progressbar"
                    aria-label={`${session.username} progress`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                  >
                    <span style={{ width: `${progress}%` }} />
                  </div>
                  <span className="tautulli-activity-widget__progress-label">
                    {progress}%
                  </span>
                </div>
              );
            })}
      </div>
    )}
    {error && (
      <span className="tautulli-activity-widget__stale-error" role="alert">
        {error}
      </span>
    )}
  </div>
);
```

Render strings as React text only. Use a local label formatter that converts
underscores to spaces and title-cases the result, so `direct_play` displays as
`Direct Play`.

Register with:

```ts
registerWidget<TautulliConfig, TautulliActivityData>({
  id: "tautulli-activity",
  name: "Tautulli Activity",
  configSchema: TautulliConfigSchema,
  fetchData: fetchActivity,
  refreshInterval: 10_000,
  preferredSize: "large",
  minSize: "wide",
  component: TautulliActivityWidget,
  serviceEditorPreset: {
    defaultName: "Tautulli",
    defaultIconUrl:
      "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main/svg/tautulli.svg",
  },
  configFields: [
    {
      key: "url",
      label: "URL",
      type: "url",
      required: true,
      placeholder: "http://192.168.1.x:8181",
    },
    {
      key: "api_key",
      label: "API Key",
      type: "password",
      required: true,
    },
    {
      key: "sections",
      label: "Display sections",
      type: "multiselect",
      required: true,
      defaultValue: ["summary", "sessions"],
      options: [
        { value: "summary", label: "Summary" },
        { value: "sessions", label: "Active sessions" },
      ],
      description: "Select at least one section.",
    },
  ],
});
```

- [ ] **Step 6: Register the integration and add styles**

Add this import to `src/integrations/index.ts`:

```ts
import "./tautulli/activityWidget";
```

Append a dedicated CSS block. Use these layout constraints:

```css
.tautulli-activity-widget {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  overflow: hidden;
}

.tautulli-activity-widget__summary {
  display: grid;
  flex-shrink: 0;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 4px;
}

.tautulli-activity-widget__sessions {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  gap: 5px;
  min-height: 0;
  overflow-y: auto;
}

.tautulli-activity-widget__progress {
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--color-surface-2);
}

.tautulli-activity-widget__progress > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-accent);
}
```

Add focused selectors for stat cards, values, labels, session cards, metadata
rows, ellipsis, percentage text, no-sessions centering, stale errors, and
loading/error hints using:

```css
.tautulli-activity-widget__stat,
.tautulli-activity-widget__session {
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-surface-2);
}

.tautulli-activity-widget__stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 5px 3px;
}

.tautulli-activity-widget__value {
  max-width: 100%;
  overflow: hidden;
  color: var(--color-text);
  font-size: 0.9rem;
  font-weight: 700;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tautulli-activity-widget__label {
  color: var(--color-text-muted);
  font-size: 0.58rem;
  font-weight: 500;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  white-space: nowrap;
}

.tautulli-activity-widget__session {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 8px;
  padding: 6px;
}

.tautulli-activity-widget__session-heading,
.tautulli-activity-widget__session-media {
  display: flex;
  grid-column: 1 / -1;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  color: var(--color-text-muted);
  font-size: 0.68rem;
}

.tautulli-activity-widget__username,
.tautulli-activity-widget__title {
  overflow: hidden;
  color: var(--color-text);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tautulli-activity-widget__progress-label {
  color: var(--color-text-muted);
  font-size: 0.65rem;
  line-height: 1;
}

.tautulli-activity-widget__no-sessions {
  margin: auto;
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.tautulli-activity-widget__stale-error {
  flex-shrink: 0;
  color: #f87171;
  font-size: 0.7rem;
  text-align: center;
}

.tautulli-activity-widget--empty {
  align-items: center;
  justify-content: center;
  min-height: 2rem;
}

.tautulli-activity-widget__hint {
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

.tautulli-activity-widget__hint--error {
  color: #f87171;
}
```

Do not use `!important`, fixed pixel widths, or unthemed foreground colors
except the existing `#f87171` error convention.

- [ ] **Step 7: Run focused tests**

Run:

```bash
npx vitest run \
  src/__tests__/integrations/TautulliActivityWidget.test.tsx \
  src/__tests__/integrations/tautulli.test.ts \
  src/__tests__/components/ServiceForm.test.tsx \
  src/__tests__/integrations/sizeHints.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run focused static checks**

Run:

```bash
npx eslint \
  src/integrations/tautulli/activityWidget.tsx \
  src/widgets/index.ts \
  src/components/ServiceForm.tsx \
  src/__tests__/integrations/TautulliActivityWidget.test.tsx \
  src/__tests__/integrations/tautulli.test.ts \
  src/__tests__/components/ServiceForm.test.tsx
npx tsc --noEmit
```

Expected: both commands exit 0.

- [ ] **Step 9: Commit the widget UI task**

```bash
git add \
  src/integrations/tautulli/activityWidget.tsx \
  src/__tests__/integrations/TautulliActivityWidget.test.tsx \
  src/__tests__/integrations/tautulli.test.ts \
  src/widgets/index.ts \
  src/components/ServiceForm.tsx \
  src/__tests__/components/ServiceForm.test.tsx \
  src/integrations/index.ts \
  src/app/globals.css
git commit -m "feat(tautulli): add configurable activity widget"
```

---

### Task 3: User documentation, example configuration, and roadmap tracking

**Files:**

- Modify: `README.md`
- Modify: `settings.example.yaml`
- Modify: `docs/Roadmap.md`

**Interfaces:**

- Documents the exact Task 1 config and Task 2 UI behavior.
- Does not modify runtime `settings.yaml`.

- [ ] **Step 1: Add the commented example configuration**

Immediately after the Plex example in `settings.example.yaml`, add:

```yaml
#
#   - name: Tautulli
#     url: http://192.168.1.x:8181
#     group: Media
#     size: large
#     widget:
#       type: tautulli-activity
#       config:
#         url: http://192.168.1.x:8181
#         api_key: <your-tautulli-api-key>
#         sections:
#           - summary
#           - sessions
```

- [ ] **Step 2: Add the README widget documentation**

Immediately after the Plex section, add `### Tautulli` with:

- Prerequisite: enable Tautulli's API and copy the generated API key.
- The same YAML example as `settings.example.yaml`.
- A config table:

```markdown
| Field | Required | Description |
| --- | --- | --- |
| `url` | Yes | Base URL of the Tautulli instance, including any HTTP root |
| `api_key` | Yes | Tautulli API key; used only by Kokpit's server |
| `sections` | No | Non-empty list containing `summary`, `sessions`, or both; defaults to both |
```

- A summary table listing Active, Direct Play, Direct Stream, Transcoding, and
  Bandwidth.
- A sessions description listing username, media title/type, playback state,
  transcode mode, and progress.
- A privacy paragraph stating that usernames are intentionally displayed while
  email, IP, machine/device IDs, file paths, player/platform details, and
  artwork are discarded server-side.

- [ ] **Step 3: Make the roadmap item independently trackable**

Replace:

```markdown
  - Analytics: Tautulli, Grafana embed widget
```

with:

```markdown
  - Analytics:
    - [x] Tautulli — configurable current activity widget (summary, active sessions, or both)
    - [ ] Grafana embed widget
```

Keep the parent `Extended integrations (Tier 2)` checkbox unchecked.

- [ ] **Step 4: Verify documentation consistency**

Run:

```bash
rg -n -C 4 "tautulli-activity|Tautulli" \
  README.md settings.example.yaml docs/Roadmap.md
git diff --check
```

Expected: all three files contain the exact widget ID and field names; no
whitespace errors.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md settings.example.yaml docs/Roadmap.md
git commit -m "docs: document Tautulli activity widget"
```

---

### Task 4: Integrated verification

**Files:**

- Verify all changed files; modify only the smallest relevant file if a
  verification failure identifies a real defect.

**Interfaces:**

- Consumes the complete Tautulli integration.
- Produces a clean, passing branch ready for final review.

- [ ] **Step 1: Run the complete unit suite**

```bash
npm test
```

Expected: all Vitest suites pass.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: exit 0 with no ESLint errors.

- [ ] **Step 3: Run TypeScript checking**

```bash
npm run type-check
```

Expected: exit 0 with no type errors.

- [ ] **Step 4: Run the production build**

```bash
npm run build
```

Expected: Next.js production build exits 0.

- [ ] **Step 5: Inspect the final diff and repository state**

```bash
git diff --check
git status --short
git log --oneline -5
```

Expected: no whitespace errors, no uncommitted implementation changes, and
separate API, UI, and documentation commits.
