# Docker Auto-Discovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect running containers via the Docker socket and auto-populate service tiles from container labels (`dashboard.name`, `dashboard.url`, `dashboard.icon`, `dashboard.group`), per the Phase 2 roadmap item.

**Architecture:** A zero-dependency, read-only Docker Engine API client (`node:http` over the unix socket) feeds a label→Service mapper. Discovered services are **ephemeral**: merged into the dashboard at render time (in `ServiceGrid`, a server component), never written to `settings.yaml`. YAML-defined services always win on name collision. Discovery is **off by default** and gated by a new `discovery.docker` config section (plus env overrides). Results are cached in-memory with a TTL so page loads don't hammer the socket. Raw Docker API data never reaches the browser — only the mapped tile fields, via server render.

**Tech stack:** No new runtime dependencies. `node:http` with `socketPath` for the Docker Engine API (`GET /v1.41/containers/json`), Zod for label/config validation, Vitest for tests.

---

## Design decisions (and why)

1. **Ephemeral merge, not YAML writes.** Containers churn; writing them into `settings.yaml` would bloat and thrash the user's config file and fight the "YAML is user-authored source of truth" principle. Discovered tiles are runtime data, like ping status. A "pin to YAML" action (converting a discovered tile to a permanent service) is a natural follow-up, not in scope here.
2. **Opt-in per container.** Only containers carrying at least one `dashboard.*` label appear. `dashboard.enabled: "false"` explicitly hides a container even if other labels exist. Showing *all* containers would flood the dashboard with databases, sidecars, and infra containers nobody wants tiles for.
3. **Discovery off by default.** Reading the Docker socket is root-equivalent access on the host. It must be a deliberate user choice (`discovery.docker.enabled: true` in YAML/UI), consistent with the project's security posture ("secure enough to expose to the internet").
4. **Label prefix `dashboard.*`** as specified in the roadmap. (Alternative considered: `kokpit.*` for brand-uniqueness, like Homepage's `homepage.*`. Sticking with the roadmap spec; changing later is a docs-level change since the prefix is a constant.)
5. **Server-side merge in `ServiceGrid`.** It already reads `getConfig()` server-side; awaiting `getDiscoveredServices()` there is the smallest possible integration. Discovery failures log a warning and render the YAML-only dashboard — discovery must never break the page.
6. **Non-root socket access handled in the entrypoint.** The runner image starts as root and `su-exec`s to `nextjs`. The entrypoint will detect a mounted `/var/run/docker.sock`, read its GID, and grant the `nextjs` user membership in a matching group before dropping privileges — so `-v /var/run/docker.sock:/var/run/docker.sock:ro` "just works". Docs also cover `docker-socket-proxy` as the recommended hardened setup.

## Label schema

| Label | Required | Maps to | Notes |
| --- | --- | --- | --- |
| `dashboard.name` | No* | `service.name` | Falls back to container name (leading `/` stripped) |
| `dashboard.url` | No | `service.url` | Must parse as a URL, otherwise dropped with a warning |
| `dashboard.icon` | No | `service.icon` | |
| `dashboard.group` | No | `service.group` | |
| `dashboard.description` | No | `service.description` | Bonus beyond roadmap; trivial to support |
| `dashboard.enabled` | No | — | `"false"` hides the container |

\* A container is discovered when it has **any** `dashboard.*` label (other than `dashboard.enabled: "false"`).

## New config section (`settings.yaml`)

```yaml
discovery:
  docker:
    enabled: false                       # default off
    socket_path: /var/run/docker.sock    # or set KOKPIT_DOCKER_SOCKET
    cache_ttl_ms: 15000                  # min 5000; server-side cache of container list
```

Env overrides: `KOKPIT_DOCKER_SOCKET` (path), `KOKPIT_DOCKER_DISCOVERY` (`true`/`false`, wins over YAML — useful for compose-only setups).

Out of scope (deferred): TCP Docker hosts (`tcp://…`), multiple Docker hosts, widget configuration via labels, "pin discovered tile to YAML" action, live client-side polling of discovered tiles (tiles appear on page load; ping indicators still work since `ServiceTile` handles that client-side).

---

## Pre-flight notes

- Discovery unit tests MUST include `// @vitest-environment node` (they exercise `node:http` over unix sockets; jsdom is wrong for this).
- Unix-socket client tests spin up a real `node:http` server listening on a socket path in a temp dir (works on Linux CI; keep paths short — sockaddr limit is ~104 chars).
- All server-only code lives in `src/discovery/` and must never be imported from client components.
- Follow existing patterns: Zod schema in `src/config/schema.ts`, section-wise PATCH in `src/app/api/settings/route.ts`, tests mirroring source layout under `src/__tests__/`.
- Save plan copy to: `docs/plans/2026-07-05-docker-auto-discovery.md`

---

### Task 1: Config schema — `discovery` section

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `src/__tests__/config/schema.test.ts`
- Modify: `settings.example.yaml`

**Step 1: Add schema**

In `src/config/schema.ts`, add:

```ts
const DockerDiscoverySchema = z.object({
  enabled: z.boolean().default(false),
  socket_path: z.string().default("/var/run/docker.sock"),
  cache_ttl_ms: z.number().int().min(5000).default(15000),
});

export const DiscoverySchema = z
  .object({
    docker: DockerDiscoverySchema.default({}),
  })
  .default({});
```

Wire into `KokpitConfigSchema` as `discovery: DiscoverySchema` and export `type DockerDiscoveryConfig`. Re-export from `src/config/index.ts`.

**Step 2: Tests**

- Default config (no `discovery` key) parses with `discovery.docker.enabled === false` and default socket path.
- Explicit values round-trip; `cache_ttl_ms: 1000` rejected.

**Step 3: Update `settings.example.yaml`** with a commented `discovery:` block.

**Step 4: Verify + commit**

```
npm run type-check && npm test -- schema
git commit -m "feat(config): add discovery.docker section to settings schema"
```

---

### Task 2: Docker Engine API client

**Files:**
- Create: `src/discovery/docker/client.ts`
- Create: `src/__tests__/discovery/client.test.ts`

**Step 1: Implement `listContainers(socketPath: string): Promise<DockerContainer[]>`**

- `node:http` request: `{ socketPath, path: "/v1.41/containers/json", method: "GET" }` (running containers only — no `all=true`).
- Hard timeout (3s) via `req.setTimeout` + abort; reject on non-200; parse JSON.
- Return a *narrow* typed subset validated with Zod: `{ Id, Names, Labels, State }`. Unknown fields ignored/stripped — raw payload never leaves this module.
- Typed error class `DockerUnavailableError` (ENOENT/EACCES/ECONNREFUSED/timeout) so callers can degrade gracefully with a useful log message ("socket not mounted?", "permission denied — see docs").

**Step 2: Tests** (`// @vitest-environment node`)

- Real `http.createServer` on a temp-dir unix socket serving fixture JSON → client returns parsed containers.
- Non-200 response → rejects.
- Nonexistent socket path → `DockerUnavailableError`.
- Slow server (no response) → times out.

**Step 3: Verify + commit**

```
npm run type-check && npm test -- discovery
git commit -m "feat(discovery): minimal read-only Docker Engine API client over unix socket"
```

---

### Task 3: Label → Service mapper

**Files:**
- Create: `src/discovery/docker/map.ts`
- Create: `src/__tests__/discovery/map.test.ts`

**Step 1: Implement `containersToServices(containers: DockerContainer[]): Service[]`**

Pure function. Rules:
- Skip containers with no `dashboard.*` labels; skip `dashboard.enabled: "false"`.
- `name`: `dashboard.name` → fallback container name (strip leading `/`); trim; cap at 100 chars; skip if empty after trim.
- `url`: only if it parses via `new URL()` and protocol is http/https — otherwise omit the field (tile still renders, matching `ServiceSchema` where `url` is optional).
- `icon` / `group` / `description`: pass through trimmed, length-capped (these render in the DOM; React escapes them, but caps keep the grid sane).
- Dedupe *within* discovered set by `serviceNameUniquenessKey` (first wins, warn on drop) — the grid keys tiles by name.
- Stable sort by name so tile order doesn't jitter between refreshes.

**Step 2: Tests** — full label set maps correctly; no-label containers skipped; `enabled=false` skipped; name fallback; invalid URL dropped but tile kept; duplicate names deduped; ordering stable.

**Step 3: Verify + commit**

```
git commit -m "feat(discovery): map container labels to service tiles"
```

---

### Task 4: Discovery service — gating, caching, error handling

**Files:**
- Create: `src/discovery/index.ts`
- Create: `src/__tests__/discovery/index.test.ts`

**Step 1: Implement `getDiscoveredServices(): Promise<Service[]>`**

- Resolve effective config: YAML `discovery.docker` + env overrides (`KOKPIT_DOCKER_DISCOVERY`, `KOKPIT_DOCKER_SOCKET`). Disabled → `[]` immediately.
- Module-level cache `{ services, fetchedAt }`; return cached result within `cache_ttl_ms`. Concurrent callers share one in-flight promise (no thundering herd on the socket).
- On error: log **once per state change** (not per request) via a "last error was logged" flag, return `[]` (or last-good cache) — the dashboard must always render.
- Export `invalidateDiscoveryCache()` for tests and for the settings PATCH path (toggling discovery in the UI takes effect on next load, not after stale TTL).

**Step 2: Tests** — disabled returns `[]` without touching client (mock client module); enabled calls client and maps; cache honored within TTL, refetch after; error → `[]` + no throw; env override wins over YAML.

**Step 3: Verify + commit**

```
git commit -m "feat(discovery): gated, cached docker discovery service"
```

---

### Task 5: Dashboard integration — merge into `ServiceGrid` + badge

**Files:**
- Modify: `src/components/ServiceGrid.tsx`
- Modify: `src/components/ServiceTile.tsx`
- Modify: `src/__tests__/components/` (grid + tile tests)

**Step 1: Merge in `ServiceGrid`**

- Make `ServiceGrid` async; `const discovered = await getDiscoveredServices()`.
- Drop discovered services whose `serviceNameUniquenessKey` collides with a YAML service (YAML wins — user config overrides labels).
- Pass merged list through the existing `groupServices`; discovered tiles slot into their `dashboard.group` groups alongside YAML tiles.
- Tag discovered services (e.g. `discovered: true` passed as a prop — **not** added to the config schema; it's a render-time concern).

**Step 2: Badge in `ServiceTile`**

Small "auto" badge/dot with a `title="Discovered from Docker"` tooltip, styled via existing CSS variable system. Ping indicator and favicon fallback work unchanged since discovered tiles are ordinary `Service` shapes.

**Step 3: Tests** — discovered tiles render in correct groups; YAML service with same name suppresses the discovered one; badge only on discovered tiles; discovery returning `[]`/failing leaves existing rendering untouched (regression).

**Step 4: Verify + commit**

```
npm run type-check && npm test
git commit -m "feat(dashboard): render docker-discovered service tiles with badge"
```

---

### Task 6: Settings — UI toggle + API PATCH support

**Files:**
- Modify: `src/app/api/settings/route.ts`
- Modify: `src/components/SettingsPanel.tsx`
- Modify: `src/__tests__/api/settings.test.ts` (or equivalent existing test file)

**Step 1: API** — add optional `discovery` section to `PatchBodySchema` mirroring Task 1's schema; include in `updates`; call `invalidateDiscoveryCache()` after a successful write that touched `discovery`.

**Step 2: UI** — new "Discovery" section in `SettingsPanel`: enable toggle, socket path input, cache TTL input. Follow the existing section patterns (reads GET /api/settings, PATCHes section-wise, instant apply). Include a short inline warning: "Requires the Docker socket mounted into the container — see README."

**Step 3: Tests** — PATCH with `discovery` persists to YAML and round-trips through GET; invalid TTL rejected 400.

**Step 4: Verify + commit**

```
git commit -m "feat(settings): docker discovery toggle in settings panel and API"
```

---

### Task 7: Container plumbing — entrypoint socket permissions + compose example

**Files:**
- Modify: `docker-entrypoint.sh`
- Modify: `docker-compose.yml` (commented-out socket mount in both services)

**Step 1: Entrypoint**

After the `/data` chown block, before `su-exec`:

```sh
if [ -S /var/run/docker.sock ]; then
  SOCK_GID=$(stat -c '%g' /var/run/docker.sock)
  if [ "$SOCK_GID" != "0" ] && ! getent group "$SOCK_GID" >/dev/null 2>&1; then
    addgroup -g "$SOCK_GID" dockersock
  fi
  SOCK_GRP=$(getent group "$SOCK_GID" | cut -d: -f1)
  [ -n "$SOCK_GRP" ] && addgroup nextjs "$SOCK_GRP" 2>/dev/null || true
fi
```

(Root-owned-group socket (GID 0) case: log a warning pointing at docs instead of adding `nextjs` to root group.)

**Step 2: Compose** — add commented `# - /var/run/docker.sock:/var/run/docker.sock:ro` with a pointer to the README section.

**Step 3: Manual verify** — build the runner image, run with socket mounted, label a test container, confirm the tile appears; run *without* the socket and confirm clean startup with no errors on the dashboard.

**Step 4: Commit**

```
git commit -m "feat(docker): grant nextjs user docker socket access when mounted"
```

---

### Task 8: Documentation + roadmap

**Files:**
- Modify: `README.md` — new "Docker auto-discovery" section: enabling it, label schema table, compose snippet (`:ro` socket mount), security note recommending [docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy) with `CONTAINERS=1` for hardened setups, note that YAML services override discovered ones.
- Modify: `settings.example.yaml` (if not fully covered in Task 1).
- Modify: `docs/Roadmap.md` — mark `P1 Docker auto-discovery` as `[x]`.
- Modify: `Claude.md` — update "Current Focus".

**Verify + commit**

```
npm run lint && npm run type-check && npm test
git commit -m "docs: docker auto-discovery usage, labels, and security notes"
```

---

### Task 9: Final gate

- `npm run lint && npm run type-check && npm test` all green.
- E2E suite (`npm run test:e2e` / playwright config) passes — discovery disabled by default means zero E2E behavior change; add one E2E only if an existing pattern makes it cheap (settings panel toggle visibility).
- Push branch, open PR.
