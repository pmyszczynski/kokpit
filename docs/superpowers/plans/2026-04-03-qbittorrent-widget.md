# qBittorrent Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two independent qBittorrent widgets (`qbittorrent-stats` and `qbittorrent-torrents`) to the kokpit widget system, sharing a module-level SID cache with 403-triggered re-login.

**Architecture:** Two widget registrations (`qbittorrent-stats` at 10s, `qbittorrent-torrents` at 30s) backed by a shared `api.ts` that handles cookie-based qBittorrent auth. Auth SID is cached in a module-level variable and refreshed automatically on 403. The API route and client never share credentials — all fetching happens server-side following the existing Plex pattern.

**Tech Stack:** Next.js 15 App Router, Vitest + Testing Library (jsdom/node), Zod, React, TypeScript.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/integrations/qbittorrent/api.ts` | Create | Types, SID cache, `getSession`, `fetchTransferInfo`, `fetchTorrents`, `clearSidCache` |
| `src/integrations/qbittorrent/statsWidget.tsx` | Create | Registers `qbittorrent-stats`, renders 2×2 stats grid |
| `src/integrations/qbittorrent/torrentsWidget.tsx` | Create | Registers `qbittorrent-torrents`, renders scrollable torrent list |
| `src/integrations/index.ts` | Modify | Add two new integration imports |
| `settings.yaml` | Modify | Add example qBittorrent service entries |
| `src/__tests__/integrations/qbittorrent.test.ts` | Create | Node-env tests: fetch helpers + SID cache + 403 retry + widget registration |
| `src/__tests__/integrations/QbittorrentStatsWidget.test.tsx` | Create | React component tests for stats widget |
| `src/__tests__/integrations/QbittorrentTorrentsWidget.test.tsx` | Create | React component tests for torrents widget |

---

## Task 1: API layer

**Files:**
- Create: `src/integrations/qbittorrent/api.ts`
- Test: `src/__tests__/integrations/qbittorrent.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/integrations/qbittorrent.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearRegistry } from "@/widgets";
import { fetchTransferInfo, fetchTorrents, clearSidCache } from "@/integrations/qbittorrent/api";

const BASE_CONFIG = {
  url: "http://qbt.local:8080",
  username: "admin",
  password: "adminadmin",
};

const MOCK_TRANSFER_INFO = {
  dl_info_speed: 5_500_000,
  up_info_speed: 500_000,
  dl_info_data: 1_200_000_000,
  up_info_data: 345_000_000,
};

const MOCK_TORRENTS = [
  { name: "Ubuntu 24.04", progress: 0.74, dlspeed: 12_000_000, upspeed: 0 },
  { name: "Fedora 40", progress: 1.0, dlspeed: 0, upspeed: 1_000_000 },
];

function makeLoginResponse(sid: string) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "set-cookie" ? `SID=${sid}; Path=/` : null,
    },
  };
}

function makeJsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  };
}

function make403Response() {
  return { ok: false, status: 403, headers: { get: () => null } };
}

// ---------------------------------------------------------------------------
// fetchTransferInfo
// ---------------------------------------------------------------------------

describe("fetchTransferInfo", () => {
  beforeEach(() => clearSidCache());
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("logs in and returns transfer info", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(makeLoginResponse("sid123"))
        .mockResolvedValueOnce(makeJsonResponse(MOCK_TRANSFER_INFO))
    );
    const result = await fetchTransferInfo(BASE_CONFIG);
    expect(result).toEqual(MOCK_TRANSFER_INFO);
  });

  it("POSTs credentials as form-encoded body to /api/v2/auth/login", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeLoginResponse("sid"))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_TRANSFER_INFO));
    vi.stubGlobal("fetch", mockFetch);

    await fetchTransferInfo(BASE_CONFIG);

    const loginCall = mockFetch.mock.calls.find(([url]: [string]) =>
      url.includes("/auth/login")
    );
    expect(loginCall).toBeDefined();
    expect(loginCall[1].method).toBe("POST");
    expect(loginCall[1].body).toContain("username=admin");
    expect(loginCall[1].body).toContain("password=adminadmin");
  });

  it("attaches SID cookie to the data request", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeLoginResponse("mySession"))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_TRANSFER_INFO));
    vi.stubGlobal("fetch", mockFetch);

    await fetchTransferInfo(BASE_CONFIG);

    const dataCall = mockFetch.mock.calls.find(([url]: [string]) =>
      url.includes("/transfer/info")
    );
    expect(dataCall![1].headers.Cookie).toBe("SID=mySession");
  });

  it("caches SID and does not re-login on second call", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeLoginResponse("cachedSid"))
      .mockResolvedValue(makeJsonResponse(MOCK_TRANSFER_INFO));
    vi.stubGlobal("fetch", mockFetch);

    await fetchTransferInfo(BASE_CONFIG);
    await fetchTransferInfo(BASE_CONFIG);

    const loginCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      url.includes("/auth/login")
    );
    expect(loginCalls).toHaveLength(1);
  });

  it("re-logins on 403 and retries the request", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeLoginResponse("oldSid"))
      .mockResolvedValueOnce(make403Response())
      .mockResolvedValueOnce(makeLoginResponse("newSid"))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_TRANSFER_INFO));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchTransferInfo(BASE_CONFIG);
    expect(result).toEqual(MOCK_TRANSFER_INFO);

    const loginCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      url.includes("/auth/login")
    );
    expect(loginCalls).toHaveLength(2);
  });

  it("throws when login fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, headers: { get: () => null } })
    );
    await expect(fetchTransferInfo(BASE_CONFIG)).rejects.toThrow("401");
  });

  it("forwards the AbortSignal to the data request", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeLoginResponse("sid"))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_TRANSFER_INFO));
    vi.stubGlobal("fetch", mockFetch);

    const controller = new AbortController();
    await fetchTransferInfo(BASE_CONFIG, controller.signal);

    const dataCall = mockFetch.mock.calls.find(([url]: [string]) =>
      url.includes("/transfer/info")
    );
    expect(dataCall![1]).toMatchObject({ signal: controller.signal });
  });
});

// ---------------------------------------------------------------------------
// fetchTorrents
// ---------------------------------------------------------------------------

describe("fetchTorrents", () => {
  beforeEach(() => clearSidCache());
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("logs in and returns torrent list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(makeLoginResponse("sid123"))
        .mockResolvedValueOnce(makeJsonResponse(MOCK_TORRENTS))
    );
    const result = await fetchTorrents(BASE_CONFIG);
    expect(result).toEqual(MOCK_TORRENTS);
  });

  it("attaches SID cookie to the torrents request", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeLoginResponse("mySid"))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_TORRENTS));
    vi.stubGlobal("fetch", mockFetch);

    await fetchTorrents(BASE_CONFIG);

    const dataCall = mockFetch.mock.calls.find(([url]: [string]) =>
      url.includes("/torrents/info")
    );
    expect(dataCall![1].headers.Cookie).toBe("SID=mySid");
  });

  it("throws when data request returns non-2xx after retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(makeLoginResponse("sid"))
        .mockResolvedValueOnce({ ok: false, status: 500, headers: { get: () => null } })
    );
    await expect(fetchTorrents(BASE_CONFIG)).rejects.toThrow("500");
  });
});

// ---------------------------------------------------------------------------
// Widget registration — qbittorrent-stats
// ---------------------------------------------------------------------------

describe("qbittorrent-stats widget registration", () => {
  beforeEach(() => {
    clearRegistry();
    vi.resetModules();
  });

  it("registers a widget with id 'qbittorrent-stats' on import", async () => {
    await import("@/integrations/qbittorrent/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("qbittorrent-stats")).toBeDefined();
  });

  it("widget name is 'qBittorrent Stats'", async () => {
    await import("@/integrations/qbittorrent/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("qbittorrent-stats")?.name).toBe("qBittorrent Stats");
  });

  it("refreshInterval is 10000", async () => {
    await import("@/integrations/qbittorrent/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("qbittorrent-stats")?.refreshInterval).toBe(10_000);
  });

  it("configSchema accepts valid config", async () => {
    await import("@/integrations/qbittorrent/statsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("qbittorrent-stats")!.configSchema.safeParse({
      url: "http://192.168.1.10:8080",
      username: "admin",
      password: "adminadmin",
    });
    expect(result.success).toBe(true);
  });

  it("configSchema rejects invalid URL", async () => {
    await import("@/integrations/qbittorrent/statsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("qbittorrent-stats")!.configSchema.safeParse({
      url: "not-a-url",
      username: "admin",
      password: "adminadmin",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Widget registration — qbittorrent-torrents
// ---------------------------------------------------------------------------

describe("qbittorrent-torrents widget registration", () => {
  beforeEach(() => {
    clearRegistry();
    vi.resetModules();
  });

  it("registers a widget with id 'qbittorrent-torrents' on import", async () => {
    await import("@/integrations/qbittorrent/torrentsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("qbittorrent-torrents")).toBeDefined();
  });

  it("widget name is 'qBittorrent Torrents'", async () => {
    await import("@/integrations/qbittorrent/torrentsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("qbittorrent-torrents")?.name).toBe("qBittorrent Torrents");
  });

  it("refreshInterval is 30000", async () => {
    await import("@/integrations/qbittorrent/torrentsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("qbittorrent-torrents")?.refreshInterval).toBe(30_000);
  });

  it("configSchema accepts valid config", async () => {
    await import("@/integrations/qbittorrent/torrentsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("qbittorrent-torrents")!.configSchema.safeParse({
      url: "http://192.168.1.10:8080",
      username: "admin",
      password: "adminadmin",
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Create a stub `api.ts` so TypeScript can resolve the imports**

Create `src/integrations/qbittorrent/api.ts`:

```typescript
export interface QbittorrentConfig {
  url: string;
  username: string;
  password: string;
}

export interface TransferInfo {
  dl_info_speed: number;
  up_info_speed: number;
  dl_info_data: number;
  up_info_data: number;
}

export interface Torrent {
  name: string;
  progress: number;
  dlspeed: number;
  upspeed: number;
}

export function clearSidCache(): void {
  throw new Error("not implemented");
}

export async function fetchTransferInfo(
  _config: QbittorrentConfig,
  _signal?: AbortSignal
): Promise<TransferInfo> {
  throw new Error("not implemented");
}

export async function fetchTorrents(
  _config: QbittorrentConfig,
  _signal?: AbortSignal
): Promise<Torrent[]> {
  throw new Error("not implemented");
}
```

Also create stub widget files so the registration tests can import them:

Create `src/integrations/qbittorrent/statsWidget.tsx`:

```typescript
// stub — will be implemented in Task 2
```

Create `src/integrations/qbittorrent/torrentsWidget.tsx`:

```typescript
// stub — will be implemented in Task 3
```

- [ ] **Step 3: Run the API tests and confirm they fail**

```bash
npm test -- src/__tests__/integrations/qbittorrent.test.ts
```

Expected: tests in `fetchTransferInfo` and `fetchTorrents` describe blocks fail with "not implemented". Registration tests fail because the stub widget files export nothing to register.

- [ ] **Step 4: Implement `api.ts`**

Replace `src/integrations/qbittorrent/api.ts` with:

```typescript
export interface QbittorrentConfig {
  url: string;
  username: string;
  password: string;
}

export interface TransferInfo {
  dl_info_speed: number;
  up_info_speed: number;
  dl_info_data: number;
  up_info_data: number;
}

export interface Torrent {
  name: string;
  progress: number;
  dlspeed: number;
  upspeed: number;
}

let sidCache: { url: string; sid: string } | null = null;

export function clearSidCache(): void {
  sidCache = null;
}

async function getSession(
  config: QbittorrentConfig,
  signal?: AbortSignal
): Promise<string> {
  if (sidCache && sidCache.url === config.url) {
    return sidCache.sid;
  }

  const loginUrl = new URL("/api/v2/auth/login", config.url).toString();
  const body = new URLSearchParams({
    username: config.username,
    password: config.password,
  }).toString();

  const response = await fetch(loginUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal,
  });

  if (!response.ok) {
    throw new Error(`qBittorrent login failed with ${response.status}`);
  }

  const setCookie = response.headers.get("set-cookie") ?? "";
  const sidMatch = setCookie.match(/SID=([^;]+)/);
  if (!sidMatch) {
    throw new Error("qBittorrent login did not return a SID cookie");
  }

  const sid = sidMatch[1];
  sidCache = { url: config.url, sid };
  return sid;
}

async function fetchWithAuth(
  config: QbittorrentConfig,
  path: string,
  signal?: AbortSignal
): Promise<Response> {
  const sid = await getSession(config, signal);
  const url = new URL(path, config.url).toString();

  let response = await fetch(url, {
    headers: { Cookie: `SID=${sid}` },
    signal,
  });

  if (response.status === 403) {
    sidCache = null;
    const newSid = await getSession(config, signal);
    response = await fetch(url, {
      headers: { Cookie: `SID=${newSid}` },
      signal,
    });
  }

  if (!response.ok) {
    throw new Error(`qBittorrent responded with ${response.status}`);
  }

  return response;
}

export async function fetchTransferInfo(
  config: QbittorrentConfig,
  signal?: AbortSignal
): Promise<TransferInfo> {
  const response = await fetchWithAuth(config, "/api/v2/transfer/info", signal);
  return response.json() as Promise<TransferInfo>;
}

export async function fetchTorrents(
  config: QbittorrentConfig,
  signal?: AbortSignal
): Promise<Torrent[]> {
  const response = await fetchWithAuth(config, "/api/v2/torrents/info", signal);
  return response.json() as Promise<Torrent[]>;
}
```

- [ ] **Step 5: Run API tests (excluding registration tests) and confirm they pass**

```bash
npm test -- src/__tests__/integrations/qbittorrent.test.ts
```

Expected: all `fetchTransferInfo` and `fetchTorrents` tests PASS. Registration tests still fail (stubs not yet implemented — that's fine, they run in Task 2 and 3).

- [ ] **Step 6: Commit**

```bash
git add src/integrations/qbittorrent/api.ts src/__tests__/integrations/qbittorrent.test.ts src/integrations/qbittorrent/statsWidget.tsx src/integrations/qbittorrent/torrentsWidget.tsx
git commit -m "feat: add qBittorrent API layer with SID cache and 403 retry"
```

---

## Task 2: Stats widget

**Files:**
- Create: `src/integrations/qbittorrent/statsWidget.tsx`
- Test: `src/__tests__/integrations/QbittorrentStatsWidget.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Create `src/__tests__/integrations/QbittorrentStatsWidget.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QbittorrentStatsWidget } from "@/integrations/qbittorrent/statsWidget";

const noop = () => {};

const SAMPLE_DATA = {
  dl_info_speed: 5_500_000,
  up_info_speed: 500_000,
  dl_info_data: 1_200_000_000,
  up_info_data: 345_000_000,
};

describe("QbittorrentStatsWidget", () => {
  it("shows loading hint when data is null and loading", () => {
    render(
      <QbittorrentStatsWidget data={null} loading={true} error={null} refresh={noop} />
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error message when data is null and error is set", () => {
    render(
      <QbittorrentStatsWidget data={null} loading={false} error="connection refused" refresh={noop} />
    );
    expect(screen.getByText("connection refused")).toBeInTheDocument();
  });

  it("renders download speed above 1 MB/s as MB/s", () => {
    render(
      <QbittorrentStatsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("↓ 5.5 MB/s")).toBeInTheDocument();
  });

  it("renders upload speed below 1 MB/s as KB/s", () => {
    render(
      <QbittorrentStatsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("↑ 500.0 KB/s")).toBeInTheDocument();
  });

  it("renders session download total above 1 GB as GB", () => {
    render(
      <QbittorrentStatsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("↓ total 1.2 GB")).toBeInTheDocument();
  });

  it("renders session upload total below 1 GB as MB", () => {
    render(
      <QbittorrentStatsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("↑ total 345.0 MB")).toBeInTheDocument();
  });

  it("shows stale error alongside data when data is non-null and error is set", () => {
    render(
      <QbittorrentStatsWidget data={SAMPLE_DATA} loading={false} error="refresh failed" refresh={noop} />
    );
    expect(screen.getByText("↓ 5.5 MB/s")).toBeInTheDocument();
    expect(screen.getByText("refresh failed")).toBeInTheDocument();
  });

  it("renders nothing meaningful when data is null and neither loading nor error", () => {
    const { container } = render(
      <QbittorrentStatsWidget data={null} loading={false} error={null} refresh={noop} />
    );
    expect(container.querySelector(".qbt-stats-widget--empty")).toBeInTheDocument();
    expect(screen.queryByText(/MB\/s/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run component tests and confirm they fail**

```bash
npm test -- src/__tests__/integrations/QbittorrentStatsWidget.test.tsx
```

Expected: FAIL — `QbittorrentStatsWidget` is not exported from the stub file.

- [ ] **Step 3: Implement `statsWidget.tsx`**

Replace `src/integrations/qbittorrent/statsWidget.tsx` with:

```tsx
import { z } from "zod";
import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { fetchTransferInfo } from "./api";
import type { QbittorrentConfig, TransferInfo } from "./api";

const QbittorrentConfigSchema = z.object({
  url: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
});

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1_000_000) {
    return `${(bytesPerSec / 1_000_000).toFixed(1)} MB/s`;
  }
  return `${(bytesPerSec / 1_000).toFixed(1)} KB/s`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) {
    return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  }
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function QbittorrentStatsWidget({
  data,
  loading,
  error,
}: WidgetProps<TransferInfo>) {
  if (!data) {
    return (
      <div className="qbt-stats-widget qbt-stats-widget--empty">
        {loading && (
          <span className="qbt-stats-widget__hint">Loading&hellip;</span>
        )}
        {error && (
          <span className="qbt-stats-widget__hint qbt-stats-widget__hint--error">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="qbt-stats-widget" aria-label="qBittorrent stats">
      <div className="qbt-stats-widget__row">
        <span className="qbt-stats-widget__stat">
          ↓ {formatSpeed(data.dl_info_speed)}
        </span>
        <span className="qbt-stats-widget__stat">
          ↑ {formatSpeed(data.up_info_speed)}
        </span>
      </div>
      <div className="qbt-stats-widget__row">
        <span className="qbt-stats-widget__stat">
          ↓ total {formatBytes(data.dl_info_data)}
        </span>
        <span className="qbt-stats-widget__stat">
          ↑ total {formatBytes(data.up_info_data)}
        </span>
      </div>
      {error && (
        <span className="qbt-stats-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<QbittorrentConfig, TransferInfo>({
  id: "qbittorrent-stats",
  name: "qBittorrent Stats",
  configSchema: QbittorrentConfigSchema,
  fetchData: fetchTransferInfo,
  refreshInterval: 10_000,
  component: QbittorrentStatsWidget,
  configFields: [
    {
      key: "url",
      label: "URL",
      type: "url",
      required: true,
      placeholder: "http://192.168.1.x:8080",
    },
    {
      key: "username",
      label: "Username",
      type: "text",
      required: true,
      placeholder: "admin",
    },
    { key: "password", label: "Password", type: "password", required: true },
  ],
});
```

- [ ] **Step 4: Run both component tests and registration tests and confirm they pass**

```bash
npm test -- src/__tests__/integrations/QbittorrentStatsWidget.test.tsx src/__tests__/integrations/qbittorrent.test.ts
```

Expected: all `QbittorrentStatsWidget` tests PASS. `qbittorrent-stats` registration tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/qbittorrent/statsWidget.tsx src/__tests__/integrations/QbittorrentStatsWidget.test.tsx
git commit -m "feat: add qbittorrent-stats widget with speed and total formatting"
```

---

## Task 3: Torrents widget

**Files:**
- Create: `src/integrations/qbittorrent/torrentsWidget.tsx`
- Test: `src/__tests__/integrations/QbittorrentTorrentsWidget.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Create `src/__tests__/integrations/QbittorrentTorrentsWidget.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QbittorrentTorrentsWidget } from "@/integrations/qbittorrent/torrentsWidget";

const noop = () => {};

const SAMPLE_TORRENTS = [
  { name: "Ubuntu 24.04", progress: 0.74, dlspeed: 12_000_000, upspeed: 0 },
  { name: "Fedora 40", progress: 1.0, dlspeed: 0, upspeed: 1_000_000 },
];

describe("QbittorrentTorrentsWidget", () => {
  it("shows loading hint when data is null and loading", () => {
    render(
      <QbittorrentTorrentsWidget data={null} loading={true} error={null} refresh={noop} />
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error message when data is null and error is set", () => {
    render(
      <QbittorrentTorrentsWidget data={null} loading={false} error="connection refused" refresh={noop} />
    );
    expect(screen.getByText("connection refused")).toBeInTheDocument();
  });

  it("shows 'No torrents' when list is empty", () => {
    render(
      <QbittorrentTorrentsWidget data={[]} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("No torrents")).toBeInTheDocument();
  });

  it("renders torrent names", () => {
    render(
      <QbittorrentTorrentsWidget data={SAMPLE_TORRENTS} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("Ubuntu 24.04")).toBeInTheDocument();
    expect(screen.getByText("Fedora 40")).toBeInTheDocument();
  });

  it("renders progress as rounded percentage", () => {
    render(
      <QbittorrentTorrentsWidget data={SAMPLE_TORRENTS} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("74%")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("renders download speed above 1 MB/s as MB/s", () => {
    render(
      <QbittorrentTorrentsWidget data={SAMPLE_TORRENTS} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("12.0 MB/s")).toBeInTheDocument();
  });

  it("renders upload speed above 1 MB/s as MB/s", () => {
    render(
      <QbittorrentTorrentsWidget data={SAMPLE_TORRENTS} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("1.0 MB/s")).toBeInTheDocument();
  });

  it("renders zero speed as KB/s", () => {
    render(
      <QbittorrentTorrentsWidget data={SAMPLE_TORRENTS} loading={false} error={null} refresh={noop} />
    );
    // Two zero-speed values: Ubuntu upspeed=0 and Fedora dlspeed=0
    const zeros = screen.getAllByText("0.0 KB/s");
    expect(zeros).toHaveLength(2);
  });

  it("shows stale error alongside data when data is non-null and error is set", () => {
    render(
      <QbittorrentTorrentsWidget
        data={SAMPLE_TORRENTS}
        loading={false}
        error="refresh failed"
        refresh={noop}
      />
    );
    expect(screen.getByText("Ubuntu 24.04")).toBeInTheDocument();
    expect(screen.getByText("refresh failed")).toBeInTheDocument();
  });

  it("renders nothing meaningful when data is null and neither loading nor error", () => {
    const { container } = render(
      <QbittorrentTorrentsWidget data={null} loading={false} error={null} refresh={noop} />
    );
    expect(container.querySelector(".qbt-torrents-widget--empty")).toBeInTheDocument();
    expect(screen.queryByText("Ubuntu 24.04")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run component tests and confirm they fail**

```bash
npm test -- src/__tests__/integrations/QbittorrentTorrentsWidget.test.tsx
```

Expected: FAIL — `QbittorrentTorrentsWidget` is not exported from the stub file.

- [ ] **Step 3: Implement `torrentsWidget.tsx`**

Replace `src/integrations/qbittorrent/torrentsWidget.tsx` with:

```tsx
import { z } from "zod";
import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { fetchTorrents } from "./api";
import type { QbittorrentConfig, Torrent } from "./api";

const QbittorrentConfigSchema = z.object({
  url: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
});

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1_000_000) {
    return `${(bytesPerSec / 1_000_000).toFixed(1)} MB/s`;
  }
  return `${(bytesPerSec / 1_000).toFixed(1)} KB/s`;
}

export function QbittorrentTorrentsWidget({
  data,
  loading,
  error,
}: WidgetProps<Torrent[]>) {
  if (!data) {
    return (
      <div className="qbt-torrents-widget qbt-torrents-widget--empty">
        {loading && (
          <span className="qbt-torrents-widget__hint">Loading&hellip;</span>
        )}
        {error && (
          <span className="qbt-torrents-widget__hint qbt-torrents-widget__hint--error">
            {error}
          </span>
        )}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="qbt-torrents-widget qbt-torrents-widget--empty">
        <span className="qbt-torrents-widget__hint">No torrents</span>
      </div>
    );
  }

  return (
    <div className="qbt-torrents-widget" aria-label="qBittorrent torrents">
      <div className="qbt-torrents-widget__header">
        <span>Name</span>
        <span>Progress</span>
        <span>↓ Speed</span>
        <span>↑ Speed</span>
      </div>
      <div className="qbt-torrents-widget__list">
        {data.map((torrent) => (
          <div key={torrent.name} className="qbt-torrents-widget__row">
            <span
              className="qbt-torrents-widget__name"
              title={torrent.name}
            >
              {torrent.name}
            </span>
            <span className="qbt-torrents-widget__progress">
              {Math.round(torrent.progress * 100)}%
            </span>
            <span className="qbt-torrents-widget__dlspeed">
              {formatSpeed(torrent.dlspeed)}
            </span>
            <span className="qbt-torrents-widget__upspeed">
              {formatSpeed(torrent.upspeed)}
            </span>
          </div>
        ))}
      </div>
      {error && (
        <span className="qbt-torrents-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<QbittorrentConfig, Torrent[]>({
  id: "qbittorrent-torrents",
  name: "qBittorrent Torrents",
  configSchema: QbittorrentConfigSchema,
  fetchData: fetchTorrents,
  refreshInterval: 30_000,
  component: QbittorrentTorrentsWidget,
  configFields: [
    {
      key: "url",
      label: "URL",
      type: "url",
      required: true,
      placeholder: "http://192.168.1.x:8080",
    },
    {
      key: "username",
      label: "Username",
      type: "text",
      required: true,
      placeholder: "admin",
    },
    { key: "password", label: "Password", type: "password", required: true },
  ],
});
```

- [ ] **Step 4: Run all three test files and confirm they pass**

```bash
npm test -- src/__tests__/integrations/QbittorrentTorrentsWidget.test.tsx src/__tests__/integrations/qbittorrent.test.ts src/__tests__/integrations/QbittorrentStatsWidget.test.tsx
```

Expected: all tests in all three files PASS.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/qbittorrent/torrentsWidget.tsx src/__tests__/integrations/QbittorrentTorrentsWidget.test.tsx
git commit -m "feat: add qbittorrent-torrents widget with scrollable torrent list"
```

---

## Task 4: Wire up registration and settings example

**Files:**
- Modify: `src/integrations/index.ts`
- Modify: `settings.yaml`

- [ ] **Step 1: Add both integrations to the barrel**

Edit `src/integrations/index.ts` — add two lines after the plex import:

```typescript
// Importing each integration registers its widget as a side effect.
// Add new integrations here as they are implemented.
import "./plex/widget";
import "./qbittorrent/statsWidget";
import "./qbittorrent/torrentsWidget";

export type IntegrationStatus = "ok" | "error" | "unknown";
```

- [ ] **Step 2: Add example entries to `settings.yaml`**

Add the following under the existing Plex service entry in `settings.yaml`:

```yaml
  - name: qBittorrent Stats
    url: http://192.168.1.x:8080
    widget:
      type: qbittorrent-stats
      config:
        url: http://192.168.1.x:8080
        username: admin
        password: adminadmin

  - name: qBittorrent Torrents
    url: http://192.168.1.x:8080
    widget:
      type: qbittorrent-torrents
      config:
        url: http://192.168.1.x:8080
        username: admin
        password: adminadmin
```

- [ ] **Step 3: Run the full test suite to confirm nothing is broken**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/integrations/index.ts settings.yaml
git commit -m "feat: register qBittorrent widgets and add example settings.yaml entries"
```
