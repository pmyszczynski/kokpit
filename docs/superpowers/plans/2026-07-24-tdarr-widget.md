# Tdarr Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Tdarr stats widget (`tdarr-stats`) to the kokpit widget system, displaying transcode queue status, worker activity, and storage savings via the Tdarr Server API.

**Architecture:** Single widget registration (`tdarr-stats` at 10s refresh) backed by a shared `api.ts` that handles Tdarr API calls with optional API key support. The optional `x-api-key` header is sent server-side only; the widget never exposes credentials to the browser, following the existing Plex/qBittorrent pattern.

**Tech Stack:** Next.js 15 App Router, Vitest + Testing Library (jsdom/node), Zod, React, TypeScript.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/integrations/tdarr/api.ts` | Create | Types, API helpers (`fetchStatistics`, `fetchNodes`), optional API key header support |
| `src/integrations/tdarr/statsWidget.tsx` | Create | Registers `tdarr-stats`, renders 6-stat grid (queue, health checks, errors, space saved, workers, FPS) |
| `src/integrations/index.ts` | Modify | Add single new integration import |
| `settings.yaml` | Modify | Add example Tdarr service entry |
| `src/__tests__/integrations/tdarr.test.ts` | Create | Node-env tests: API helpers, optional API key handling |
| `src/__tests__/integrations/TdarrStatsWidget.test.tsx` | Create | React component tests for stats widget |

---

## Task 1: API layer

**Files:**
- Create: `src/integrations/tdarr/api.ts`
- Test: `src/__tests__/integrations/tdarr.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/integrations/tdarr.test.ts` with tests for:
- `fetchStatistics`: POST to `/api/v2/cruddb` with body `{"data":{"collection":"StatisticsJSONDB","mode":"getById","docID":"statistics"}}` and optional `x-api-key` header
- `fetchNodes`: POST to `/api/v2/get-nodes` with optional `x-api-key` header (best-effort, returns empty array on error)
- Config validation: URL required, API key optional
- Proper error handling when API is unreachable

- [ ] **Step 2: Create stub `api.ts`**

Create `src/integrations/tdarr/api.ts` with type stubs and function signatures:

```typescript
export interface TdarrConfig {
  url: string;
  apikey?: string;
}

export interface Statistics {
  statId: string;
  FFmpegErrors: number;
  transcode_attempted: number;
  transcode_completed: number;
  transcode_erred: number;
  cache_size: number;
  total_transcoded_files: number;
  transcode_size: number;
  space_saved: number;
  transcode_count: number;
  // Add other fields as needed from Tdarr StatisticsJSONDB
}

export interface NodeInfo {
  // Best-effort worker node info
  nodeName?: string;
  // Add other fields as needed
}

export async function fetchStatistics(
  config: TdarrConfig,
  signal?: AbortSignal
): Promise<Statistics> {
  throw new Error("not implemented");
}

export async function fetchNodes(
  config: TdarrConfig,
  signal?: AbortSignal
): Promise<NodeInfo[]> {
  throw new Error("not implemented");
}
```

Also create stub widget file:

Create `src/integrations/tdarr/statsWidget.tsx`:
```typescript
// stub — will be implemented in Task 2
```

- [ ] **Step 3: Run the API tests and confirm they fail**

```bash
npm test -- src/__tests__/integrations/tdarr.test.ts
```

Expected: tests fail with "not implemented". Registration test fails because stub widget exports nothing.

- [ ] **Step 4: Implement `api.ts`**

Implement the API layer with:
- `fetchStatistics`: POST to `/api/v2/cruddb` with stats query body and optional `x-api-key` header
- `fetchNodes`: POST to `/api/v2/get-nodes` for active worker count (best-effort, returns `[]` on failure)
- Proper error handling and AbortSignal support

- [ ] **Step 5: Run API tests and confirm they pass**

```bash
npm test -- src/__tests__/integrations/tdarr.test.ts
```

Expected: all API and config tests PASS. Registration test still fails (stub not yet implemented).

- [ ] **Step 6: Commit**

```bash
git add src/integrations/tdarr/api.ts src/__tests__/integrations/tdarr.test.ts src/integrations/tdarr/statsWidget.tsx
git commit -m "feat: add Tdarr API layer with optional API key support"
```

---

## Task 2: Stats widget

**Files:**
- Create: `src/integrations/tdarr/statsWidget.tsx`
- Test: `src/__tests__/integrations/TdarrStatsWidget.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Create `src/__tests__/integrations/TdarrStatsWidget.test.tsx` with tests for:
- Loading state when data is null and loading=true
- Error message when data is null and error is set
- Render of all six stats: transcode queue, health checks queue, errored count, space saved, active workers, FPS
- Proper formatting of space saved (GB/MB with appropriate precision)
- Stale error display when data is present but error is set
- Empty state when data is null and neither loading nor error

- [ ] **Step 2: Run component tests and confirm they fail**

```bash
npm test -- src/__tests__/integrations/TdarrStatsWidget.test.tsx
```

Expected: FAIL — `TdarrStatsWidget` is not exported from stub file.

- [ ] **Step 3: Implement `statsWidget.tsx`**

Implement the component with:
- 6-stat grid layout: transcode queue, health checks queue, errored, space saved, active workers, FPS
- Proper number formatting (space saved in GB/MB, FPS with 1 decimal place)
- Loading and error states
- Register widget with ID `tdarr-stats`, name "Tdarr Stats", refresh interval 10000ms
- Zod config schema requiring `url`, optional `apikey`

- [ ] **Step 4: Run component and registration tests and confirm they pass**

```bash
npm test -- src/__tests__/integrations/TdarrStatsWidget.test.tsx src/__tests__/integrations/tdarr.test.ts
```

Expected: all `TdarrStatsWidget` tests PASS. `tdarr-stats` registration test PASS.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/tdarr/statsWidget.tsx src/__tests__/integrations/TdarrStatsWidget.test.tsx
git commit -m "feat: add tdarr-stats widget with transcode queue and worker metrics"
```

---

## Task 3: Wire up registration and settings example

**Files:**
- Modify: `src/integrations/index.ts`
- Modify: `settings.yaml`

- [ ] **Step 1: Add integration to the barrel**

Edit `src/integrations/index.ts` — add one line after the plex import:

```typescript
import "./tdarr/statsWidget";
```

- [ ] **Step 2: Add example entry to `settings.yaml`**

Add the following under the existing integrations in `settings.yaml`:

```yaml
  - name: Tdarr
    url: http://192.168.1.x:8265
    icon: tdarr
    widget:
      type: tdarr-stats
      config:
        url: http://192.168.1.x:8265
        apikey: YOUR_API_KEY_IF_ENABLED
```

- [ ] **Step 3: Run the full test suite to confirm nothing is broken**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/integrations/index.ts settings.yaml
git commit -m "feat: register Tdarr widget and add example settings.yaml entry"
```

---

## API Endpoints Used

### Primary

```
POST {url}/api/v2/cruddb
Headers: x-api-key (optional)
Body: {"data":{"collection":"StatisticsJSONDB","mode":"getById","docID":"statistics"}}
Response: Statistics object with queue counts, error counts, space saved, etc.
```

### Secondary (best-effort)

```
POST {url}/api/v2/get-nodes
Headers: x-api-key (optional)
Response: Array of node objects; used to count active workers and derive FPS
```

---

## Config Schema (Zod)

```ts
const TdarrConfigSchema = z.object({
  url: z.string().url(),
  apikey: z.string().optional(),
});
```

---

## Displayed Metrics

- **Transcode Queue:** count of items queued for transcoding
- **Health Checks Queue:** count of items in health check queue
- **Errored:** count of items with errors
- **Space Saved:** cumulative bytes saved through transcoding (formatted as GB/MB)
- **Workers (active):** number of currently active transcode workers
- **FPS:** current frames per second across all active transcoders
