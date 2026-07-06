# Docker Container-List Widget Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A `docker` widget (the roadmap's "Docker auto-discovery" item, clarified): a service tile that lists all running containers on the host — name, state, uptime — with a running/total summary, fed by the Docker socket.

**Architecture:** Follows the existing integration pattern exactly: `src/integrations/docker/api.ts` (Zod config schema + server-side fetcher) and `src/integrations/docker/widget.tsx` (list component + `registerWidget`), registered via side-effect import in `src/integrations/index.ts`. The fetcher is a zero-dependency, read-only Docker Engine API call (`node:http` over the unix socket, `GET /v1.41/containers/json?all=1`) that honors the `AbortSignal` passed by `/api/widget`'s 5s timeout. Raw Docker payloads are parsed into a narrow, Zod-validated shape server-side — only mapped display fields reach the browser.

**Tech stack:** No new runtime dependencies. `node:http` with `socketPath`, Zod, Vitest (+ Testing Library for the component).

---

## Design decisions

1. **Widget, not label discovery.** One tile with a scrollable container list, same UX family as `qbittorrent-torrents` and `seerr-requests`. No container labels involved.
2. **Read-only, single endpoint.** Only `GET /containers/json` is ever called. Fetch with `all=1` so the summary can show "N running / M total", but the list displays running containers only (per the feature intent). Stopped/exited containers are counted, not listed.
3. **Socket path is widget config**, defaulting to `/var/run/docker.sock`, overridable per-widget in the service editor and via `KOKPIT_DOCKER_SOCKET` env (env is the fallback default, explicit widget config wins). No new `settings.yaml` sections needed — `widget.config` already covers it.
4. **Failure degrades like every other widget**: socket missing/unreadable surfaces as the widget's error state on the tile (with an actionable message: "socket not mounted?" / "permission denied — see README"), never breaks the dashboard.
5. **Non-root socket access handled in the entrypoint.** The runner image starts as root and `su-exec`s to `nextjs`; the entrypoint will detect a mounted `/var/run/docker.sock`, match its GID to a group, and add `nextjs` to it before dropping privileges — so `-v /var/run/docker.sock:/var/run/docker.sock:ro` just works. Docs also recommend docker-socket-proxy (`CONTAINERS=1`) for hardened setups.
6. **Auth gap in `/api/widget` gets fixed as part of this feature.** The route currently has no auth check, so any widget's fetched data (and with this feature, the host's container inventory) is readable unauthenticated when the dashboard is exposed. Add the same `checkAuth` gate used by `/api/settings`. Small, and a prerequisite for shipping a socket-backed widget responsibly.

## Widget spec

- **id:** `docker` · **name:** "Docker" · **serviceEditorPreset:** `{ defaultName: "Docker", defaultIconUrl: "https://cdn.simpleicons.org/docker/2496ED" }`
- **refreshInterval:** 15 000 ms

**Config (`widget.config`):**

| Field | Required | Default | Notes |
| --- | --- | --- | --- |
| `socket_path` | No | `KOKPIT_DOCKER_SOCKET` env → `/var/run/docker.sock` | Unix socket path inside the kokpit container |
| `max_items` | No | 10 | Rows shown before the list scrolls/truncates (1–50) |

**Data shape returned to the browser:**

```ts
{
  running: number,
  total: number,
  containers: Array<{
    id: string,        // short 12-char id (stable React key)
    name: string,      // primary name, leading "/" stripped
    image: string,
    state: string,     // "running" | "paused" | "restarting" | ...
    status: string,    // human uptime, e.g. "Up 3 days"
  }>  // running (non-stopped) containers only, sorted by name
}
```

**Render:** summary header ("4 running / 6 total"), then rows: colored state dot (green running / yellow paused/restarting), name (title-attr for overflow), image (dimmed), status text. Empty state: "No running containers". Error and stale-error states mirror `QbittorrentTorrentsWidget`.

**YAML example (for README):**

```yaml
services:
  - name: Docker
    icon: docker
    widget:
      type: docker
      config: {}   # socket_path defaults to /var/run/docker.sock
```

Out of scope (deferred): TCP Docker hosts (`tcp://…`), multiple hosts, per-container actions (start/stop), CPU/mem per container, label-based tile auto-discovery (separate feature — see superseded plan note at bottom).

---

## Pre-flight notes

- `api.ts` tests MUST include `// @vitest-environment node` (unix-socket `node:http`; jsdom is wrong for this). Component tests stay jsdom like the other widget tests.
- Unix-socket client tests spin up a real `http.createServer` listening on a socket path in a temp dir (Linux CI fine; keep paths short — sockaddr limit ~104 chars).
- `fetchData` must honor the `AbortSignal` from `/api/widget` (pass `signal` to `http.request`) and add its own 3s connect guard so a dead socket fails fast, inside the route's 5s budget.
- Follow existing conventions: config schema exported from `api.ts`, widget CSS classes in the same stylesheet the other list widgets use, tests mirroring source layout under `src/__tests__/integrations/`.
- Save plan copy to: `docs/plans/2026-07-06-docker-widget.md`

---

### Task 1: Auth gate on `/api/widget`

**Files:**
- Modify: `src/app/api/widget/route.ts`
- Modify: `src/__tests__/api/` widget route tests

**Step 1:** Extract/reuse the `checkAuth` helper pattern from `src/app/api/settings/route.ts` (respecting `auth.enabled` and `KOKPIT_AUTH_DISABLED`); return 401 before any widget work. Apply the same to `/api/ping` if it's equally unguarded (verify while in there).

**Step 2:** Tests — 401 when auth enabled + no session; 200 path unchanged when auth disabled.

**Step 3: Verify + commit**

```
npm run type-check && npm test -- api
git commit -m "fix(api): require auth for widget and ping routes when auth is enabled"
```

---

### Task 2: Docker Engine API client + data mapping (`api.ts`)

**Files:**
- Create: `src/integrations/docker/api.ts`
- Create: `src/__tests__/integrations/docker/api.test.ts`

**Step 1: Config schema**

```ts
export const DockerConfigSchema = z.object({
  socket_path: z.string().min(1).optional(),
  max_items: z.number().int().min(1).max(50).default(10),
});
```

Effective socket path resolution: `config.socket_path ?? process.env.KOKPIT_DOCKER_SOCKET ?? "/var/run/docker.sock"`.

**Step 2: `fetchDockerData(config, signal): Promise<DockerData>`**

- `node:http` GET `{ socketPath, path: "/v1.41/containers/json?all=1" }`, forward `signal`, 3s timeout guard.
- Parse response with a narrow Zod schema (`Id`, `Names`, `Image`, `State`, `Status`); ignore unknown fields; tolerate extra containers failing validation individually (skip + count as total? no — fail loud on malformed payload, it means an incompatible API).
- Map to the data shape above: strip leading `/` from names, short id, filter list to non-`exited`/`created`/`dead` states, sort by name, cap at `max_items` (but `running`/`total` counts reflect the full set).
- Error translation: ENOENT → "Docker socket not found at <path> — is it mounted?"; EACCES → "Permission denied reading Docker socket — see README"; ECONNREFUSED/timeout → generic unreachable message. Throw `Error` with these messages ( `/api/widget` relays `err.message`).

**Step 3: Tests** (`// @vitest-environment node`)

- Fixture server on temp unix socket → mapped shape correct (names stripped, sorted, exited filtered from list but counted in total, max_items cap).
- Nonexistent socket → ENOENT message. Non-200 → rejects. Aborted signal → rejects promptly.
- Env fallback: `KOKPIT_DOCKER_SOCKET` used when config omits `socket_path`; config wins when both set.

**Step 4: Verify + commit**

```
npm run type-check && npm test -- docker
git commit -m "feat(docker): read-only Docker Engine API client and container mapping"
```

---

### Task 3: Widget component + registration

**Files:**
- Create: `src/integrations/docker/widget.tsx`
- Modify: `src/integrations/index.ts` (add `import "./docker/widget";`)
- Create: `src/__tests__/integrations/docker/widget.test.tsx`
- Modify: widget CSS (same stylesheet as other list widgets)

**Step 1:** `DockerWidget` component per the render spec (summary header, state-dot rows, empty/loading/error/stale-error states mirroring `QbittorrentTorrentsWidget`). BEM classes `docker-widget__*`, colors via existing CSS variables.

**Step 2:** `registerWidget<DockerConfig, DockerData>` with id `docker`, preset, `refreshInterval: 15_000`, and `configFields`:

- `{ key: "socket_path", label: "Socket path", type: "text", placeholder: "/var/run/docker.sock", description: "Leave empty for default" }`
- `{ key: "max_items", label: "Max rows", type: "number", placeholder: "10" }`

**Step 3:** Tests — renders rows from data; running/total summary; empty state; error state; loading state; registry contains `docker` after importing `@/integrations`.

**Step 4: Verify + commit**

```
npm run type-check && npm test
git commit -m "feat(docker): container list widget"
```

---

### Task 4: Container plumbing — entrypoint socket permissions + compose example

**Files:**
- Modify: `docker-entrypoint.sh`
- Modify: `docker-compose.yml` (commented-out socket mount in both services)

**Step 1: Entrypoint** — after the `/data` chown block, before `su-exec`:

```sh
if [ -S /var/run/docker.sock ]; then
  SOCK_GID=$(stat -c '%g' /var/run/docker.sock)
  if [ "$SOCK_GID" != "0" ]; then
    getent group "$SOCK_GID" >/dev/null 2>&1 || addgroup -g "$SOCK_GID" dockersock
    addgroup nextjs "$(getent group "$SOCK_GID" | cut -d: -f1)" 2>/dev/null || true
  else
    echo "WARN: docker.sock is group-root; mount via docker-socket-proxy or adjust permissions (see README)"
  fi
fi
```

**Step 2: Compose** — commented `# - /var/run/docker.sock:/var/run/docker.sock:ro` with README pointer.

**Step 3: Manual verify** — build runner image, run with socket mounted + a `docker` widget configured → tile lists containers; run *without* the socket → clean startup, widget shows the "not mounted" error, everything else fine.

**Step 4: Commit**

```
git commit -m "feat(docker): grant nextjs user docker socket access when mounted"
```

---

### Task 5: Documentation + roadmap

**Files:**
- Modify: `README.md` — new "Docker" widget section in the Widgets list: prerequisites (socket mount snippet with `:ro`), YAML example, config field table, security note (socket is powerful even read-only; recommend [docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy) with `CONTAINERS=1`).
- Modify: `docs/Roadmap.md` — reword the item to match its actual intent ("**Docker widget** — container list via Docker socket (running containers, state, uptime)") and mark `[x]`.
- Modify: `Claude.md` — update "Current Focus" if stale.

**Verify + commit**

```
npm run lint && npm run type-check && npm test
git commit -m "docs: docker widget usage and security notes"
```

---

### Task 6: Final gate

- `npm run lint && npm run type-check && npm test` all green; E2E suite passes (no default-on behavior changes).
- Push branch, open PR.

---

> **Note:** This plan supersedes `2026-07-05-docker-auto-discovery.md` (label-based tile auto-discovery), which was a misreading of the roadmap item's intent. Label-based discovery remains a possible future feature; that plan was removed from the repo but lives in this branch's history (commit 6298ad6).
