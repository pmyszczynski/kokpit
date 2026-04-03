# qBittorrent Widget — Design Spec

**Date:** 2026-04-03
**Status:** Approved

---

## Overview

Add qBittorrent integration to the kokpit widget system as two independent widgets:

- `qbittorrent-stats` — global transfer stats tile (download/upload speed + session totals)
- `qbittorrent-torrents` — full torrent list tile (name, progress %, download speed, upload speed)

Both widgets authenticate via the qBittorrent Web API cookie-based session (`SID`), with the SID cached in a module-level variable and refreshed on 403.

---

## Files

```
src/integrations/qbittorrent/
  api.ts              ← shared auth/SID cache, fetch helpers, all exported types
  statsWidget.tsx     ← registers "qbittorrent-stats", renders global stats grid
  torrentsWidget.tsx  ← registers "qbittorrent-torrents", renders torrent list
```

`src/integrations/index.ts` — add two imports:
```ts
import "./qbittorrent/statsWidget";
import "./qbittorrent/torrentsWidget";
```

Tests:
```
src/__tests__/integrations/qbittorrent.test.ts
src/__tests__/integrations/QbittorrentStatsWidget.test.tsx
src/__tests__/integrations/QbittorrentTorrentsWidget.test.tsx
```

---

## API Layer (`api.ts`)

### Auth / SID Cache

```ts
const sidCache = new Map<string, string>(); // key: `${url}::${username}`
const loginInFlight = new Map<string, Promise<string>>();

async function getSession(config: QbittorrentConfig, signal?: AbortSignal): Promise<string>
```

- If `sidCache` has an entry for `url+username`, return the cached SID.
- If a login is already in-flight for that key, return the existing promise (deduplicates concurrent cold-start requests).
- Otherwise POST `/api/v2/auth/login` with `username`/`password` form-encoded, extract `SID` from `Set-Cookie`, store in `sidCache`, return SID.
- On 403, `sidCache.delete(key)` and call `getSession` once more before retrying the original request.

### Fetch Helpers

```ts
export async function fetchTransferInfo(config: QbittorrentConfig, signal?: AbortSignal): Promise<TransferInfo>
export async function fetchTorrents(config: QbittorrentConfig, signal?: AbortSignal): Promise<Torrent[]>
```

- `fetchTransferInfo` calls `GET /api/v2/transfer/info`
- `fetchTorrents` calls `GET /api/v2/torrents/info`
- Both attach `Cookie: SID=<sid>` and implement the 403 → re-login → retry pattern.

### Exported Types

```ts
interface QbittorrentConfig {
  url: string;
  username: string;
  password: string;
}

interface TransferInfo {
  dl_info_speed: number;   // bytes/s, current download speed
  up_info_speed: number;   // bytes/s, current upload speed
  dl_info_data: number;    // bytes, session total downloaded
  up_info_data: number;    // bytes, session total uploaded
}

interface Torrent {
  hash: string;            // stable unique key (used as React list key in torrentsWidget)
  name: string;
  progress: number;        // 0.0–1.0
  dlspeed: number;         // bytes/s
  upspeed: number;         // bytes/s
}
```

---

## Widget: `qbittorrent-stats`

**File:** `statsWidget.tsx`
**Refresh interval:** 10 seconds

Renders a compact 2×2 stats grid:

```
↓ 45.2 MB/s     ↑ 12.1 MB/s
↓ total 1.2 GB  ↑ total 345 MB
```

- Speed formatted as `MB/s` or `KB/s` based on magnitude (threshold: 1 MB/s).
- Totals formatted as `GB` / `MB` based on magnitude (threshold: 1 GB).

**`settings.yaml` entry:**
```yaml
- name: qBittorrent Stats
  url: http://192.168.1.x:8080
  widget:
    type: qbittorrent-stats
    config:
      url: http://192.168.1.x:8080
      username: admin
      password: adminadmin
```

---

## Widget: `qbittorrent-torrents`

**File:** `torrentsWidget.tsx`
**Refresh interval:** 30 seconds

Renders a scrollable table of all torrents with fixed-height container:

| Name | Progress | ↓ Speed | ↑ Speed |
|------|----------|---------|---------|
| Ubuntu 24.04... | 74% | 12 MB/s | 0 KB/s |
| Fedora 40... | 100% | 0 KB/s | 1 MB/s |

- Name truncated with `text-overflow: ellipsis`.
- Progress shown as percentage only (no progress bar).
- Speed formatted same as stats widget.
- Overflow scroll on the list container.
- Empty state: "No torrents" message when list is empty.

**`settings.yaml` entry:**
```yaml
- name: qBittorrent Torrents
  url: http://192.168.1.x:8080
  widget:
    type: qbittorrent-torrents
    config:
      url: http://192.168.1.x:8080
      username: admin
      password: adminadmin
```

---

## Config Schema (shared, Zod)

```ts
const QbittorrentConfigSchema = z.object({
  url: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
});
```

---

## Tests

### `qbittorrent.test.ts` (`@vitest-environment node`)

- `fetchTransferInfo`: stubs `fetch`, verifies `SID` cookie attached, returns mocked `TransferInfo`
- `fetchTorrents`: same pattern, returns mocked `Torrent[]`
- SID caching: verifies login called once across two consecutive fetches
- 403 retry: verifies login called again when SID rejected, original request retried once

### `QbittorrentStatsWidget.test.tsx`

- Renders loading state
- Renders stats with correctly formatted speeds and totals
- Renders error state

### `QbittorrentTorrentsWidget.test.tsx`

- Renders loading state
- Renders torrent rows with name, percentage, formatted speeds
- Renders empty state ("No torrents")
- Renders error state
