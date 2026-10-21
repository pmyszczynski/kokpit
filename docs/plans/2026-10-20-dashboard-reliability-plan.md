# Dashboard reliability improvements

Date: 2026-10-20

Status: IMP-13 implemented for v0.30.11; IMP-14 implemented for v0.31.1; IMP-15 implemented for v0.31.2; IMP-17 implemented for v0.30.10; IMP-16 remains planned.

Scope: IMP-13, IMP-14, IMP-15, IMP-16 and IMP-17 from the project review

Follow the sequencing, cross-cutting constraints and full pre-PR validation gate in the [improvement programme](2026-10-20-improvement-plan.md). The focused tests below supplement that gate. Implement these as separately reviewable changes; do not bundle the remaining UX redesign into them.

<a id="imp-13"></a>

## IMP-13 — Make dashboard polling visibility-aware and adaptive

Status: **implemented for v0.30.11**.

Widget and saved-service status refreshes now share a completion-based polling lifecycle: one request per subscription, suspension and abort while hidden/offline or access-gated, and refresh of due or recovering data after a verified resume. Failures retain last successful data and apply exponential backoff with bounded jitter and Retry-After handling. Manual refresh joins active work and can bypass backoff with a one-second minimum retry gap.

Automatic intervals retain their meaning, including interval zero's initial/manual behavior; returning focus does not enable recurring requests. Changed saved fetch inputs can trigger a new payload, while cosmetic changes do not. No hidden keepalive extends idle-limited sessions, so normal expiry may require sign-in on return. Fake-clock/hook and prepared browser regressions cover slow requests, retry scheduling, visibility/connectivity, cancellation, stale completions and interval changes. Integrated validation is recorded separately.

Priority: P1. Reduce unused browser/server work and repeated failures while preserving fresh data when the dashboard is active.

### Evidence and qualification

The pre-v0.30.11 issue descriptions below are historical evidence. The following design, task list and acceptance criteria preserve the accepted implementation plan; the implementation record above describes the delivered behavior.

- [useWidget](../../src/widgets/useWidget.ts#L26) starts a request immediately, then uses a fixed `setInterval`. Each tick aborts the previous request before replacing it. A slow response can therefore be repeatedly cancelled instead of allowed to finish; failures keep the same polling frequency. Cleanup and superseded-response protection already exist and must be preserved.
- [StatusDot](../../src/components/ServiceTile.tsx#L210) also runs a fixed 30-second interval. It can start overlapping checks if a previous request has not completed, and its cleanup suppresses updates without aborting the browser request. Neither loop explicitly pauses on hidden/offline state.
- Browsers already [throttle background timers](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API#policies_in_place_to_aid_background_page_performance), so the original finding does not establish that every hidden tab makes requests at its full nominal interval. Browser throttling is variable; explicit lifecycle handling still provides deterministic pause, recovery and cleanup.
- [SessionRenewal](../../src/components/SessionRenewal.tsx#L14) already uses completion-based scheduling, an in-flight guard, visibility/online events and cleanup. Its authentication purpose differs from widget/status polling; do not replace its policy with the new data scheduler.

### Design

Add a small client polling utility shared by widget data and service-status checks, with one shared source of visibility/connectivity events per protected surface rather than listeners per tile. Eligibility requires an active authorized surface, a visible document and no explicit browser-offline signal. Treat `navigator.onLine === false` as a reason to pause; `true` does not prove the server is reachable. Preserve the initial server-render/hydration path and use sensible defaults when browser lifecycle APIs are unavailable in tests.

Use one completion-scheduled timeout and at most one browser request per subscription. The next normal request is due one configured interval after completion; a timer must never abort a healthy slow request merely because its nominal interval elapsed. Coalesce repeated refresh/focus/visibility/online signals into at most one pending intent. A widget's existing explicit refresh remains available while eligible and can bypass failure backoff once; it joins an existing attempt rather than multiplying work. Keep the current initial fetch and explicit-refresh behavior for interval `0`; focus/online must not accidentally enable recurring polling for that mode.

On hidden/offline/access-suspended transitions, clear timers and abort only that consumer's browser request, invalidate its result generation and retain the last successful widget payload. A deliberate pause/abort is not a failed attempt and must not create an error or increase failure backoff. Resume once on visible/online/focus when a refresh is due, stale or recovering from failure; coalesce event bursts and enforce a small minimum retry gap so focus storms cannot bypass backoff continuously. Successful recent data does not need another request on every focus event. For interval `0`, resume only an interrupted initial request or explicit queued refresh, not background updates.

After transient transport/API/upstream failures, preserve the existing error and stale-data presentation and retry with capped exponential backoff plus jitter. Start with a base equal to the configured polling interval, double per consecutive failure, and cap at `max(base, 300_000 ms)`; add bounded randomized spread without exceeding the cap or retrying below the base interval. Inject time/randomness for deterministic tests. Reset the failure count after success, not merely after a focus event. Honor bounded valid `Retry-After` guidance where returned without allowing unbounded timer retention. Terminal Kokpit authorization failures suspend data polling and notify the existing/IMP-11 access owner rather than retrying forever; changed tile/type/config responses request controller reconciliation instead of repeatedly fetching obsolete identities. The service's own HTTP errors remain data observations under IMP-15, not Kokpit authentication failures.

Identity changes (tile ID, widget type, persisted fetch identity or relevant revision) cancel the old local subscription and ignore all late completions; clear the previous payload only when identity really changes, as current behavior requires. Resuming or a same-identity failed refresh must not erase stale data, display a false “Offline” status because the browser paused, or mount widgets that the renderer currently suppresses. Preserve edit/preview polling suppression and unsupported-mobile-widget suppression in [WidgetRenderer](../../src/components/WidgetRenderer.tsx#L80).

Coordinate lifecycle ownership with [IMP-11](2026-10-20-config-sync-plan.md#imp-11): share eligibility, coalescing and cleanup primitives with its single revision controller, but retain independent intervals and outcomes. On return, the controller revalidates access/config before releasing child data polls; offline/dirty/unauthorized states must not restart widgets behind the access gate. IMP-14 remains the independent server cache/deduplication layer. Aborting a hidden tile/tab's browser request must never abort shared server work needed by another visible consumer; the cache owns its upstream timeout and cancellation.

**Session compatibility:** [ordinary API authentication](../../src/auth/apiAuth.ts#L16) calls `getAuthUser`, which resolves [sessions with normal activity touching](../../src/auth/sessionStore.ts#L87). Widget/status polling therefore currently counts as activity. In contrast, [cookie refresh](../../src/app/api/auth/session/refresh/route.ts#L11) uses `touch: false` and cannot revive an idle-expired session. Pausing hidden/offline data polls means an idle-limited session may expire while the tab is away; returning must follow the normal expired-session/login path. Preserve that server policy and the existing session-renewal schedule: do not add synthetic activity, change auth helpers to `touch: false`, extend deadlines or turn polling into human-input-only activity as part of this improvement. Document the user-visible idle-expiry consequence and verify it across the aggregate revision/widget/status controllers. Any different definition of session activity requires its own explicit auth decision.

### Ordered implementation tasks

1. Capture current widget/status interval and stale/error behavior, including interval `0`, preview/mobile suppression and auth/session activity. Define normal interval, bounded retry/jitter and lifecycle transition contracts.
2. Add the client lifecycle source and completion-scheduled polling utility with injected clock/randomness, one in-flight attempt, a coalesced pending intent, per-consumer aborts and generation-safe cleanup.
3. Migrate `useWidget` while retaining its public result shape, explicit refresh, identity reset rules and stale payload/error behavior. Then migrate status probes without adding IMP-15's deferred batching feature.
4. Connect IMP-11 eligibility/access gating and reconciliation signals; verify the IMP-14 shared server promise survives a different consumer's pause/abort.
5. Add focused tests and browser lifecycle coverage; document backoff/freshness, background pausing and ordinary idle-session expiry before the central implementation validation gate.

### Tests

- Extend [useWidget tests](../../src/__tests__/widgets/useWidget.test.ts): schedule after actual completion, no overlapping fetches, no periodic cancellation of a slow successful response, bounded jittered backoff, success reset, explicit refresh during failure and coalescing of repeated triggers.
- Fake visibility/connectivity/time/randomness: hidden/offline mount makes no data request; transitions pause and abort local work; stale results/errors remain available; intentional abort does not increment failures; visible/focus/online recovery makes one eligible request; repeated events do not create request storms. Cover interval `0` and initially interrupted requests explicitly.
- Retain superseded tile/type/footprint-response tests and add unmount/Strict Mode cleanup, pending timeout/listener removal, ignored late results and active-access-gate suspension.
- Extend [ServiceTile tests](../../src/__tests__/components/ServiceTile.test.tsx) for one status request in flight, cleanup abort and lifecycle pause without reporting a false outage; preserve preview suppression. Retain [WidgetRenderer tests](../../src/__tests__/widgets/WidgetRenderer.test.tsx) and representative stale-data widget tests.
- Integration/browser checks cover two visible consumers sharing IMP-14 work while a third aborts, offline recovery, returning to a changed YAML/config revision through IMP-11, expired/revoked sessions and no stale protected-data restart.
- Retain [session-renewal tests](../../src/__tests__/components/SessionRenewal.test.tsx), [idle-session tests](../../src/__tests__/auth/session.test.ts) and [cookie-refresh tests](../../src/__tests__/auth/session-refresh-route.test.ts). Verify ordinary visible API polling still counts as activity, stopping all hidden data controllers permits idle expiry, and cookie refresh does not revive that session.

### Acceptance and compatibility

Hidden/offline dashboards stop automatic widget/status requests, active dashboards recover promptly without event storms, and repeated failures back off within documented bounds. A slow response can finish, each subscription has one request in flight, and unmounted/obsolete subscriptions cannot update current data. Existing stale states, explicit refresh, configured normal intervals, interval `0` and edit/mobile suppression remain intact. No browser lifecycle event can cancel another consumer's shared server fetch. Session activity/expiry rules remain unchanged; hidden idle-limited tabs may legitimately require login on return. IMP-13 introduces no YAML schema change or new cloud dependency.

<a id="imp-14"></a>

## IMP-14 — Share identical widget fetches safely

Status: **implemented for v0.31.1**.

Equivalent saved-widget requests now share upstream work and recent successful results inside each server process. Identity includes credentials, effective options, widget type, footprint, live definition and the exact configuration generation. Each caller still passes current authorization and saved-input checks before lookup and after awaited work; source changes invalidate results, including old-generation completions. Freshness is at most five seconds and never exceeds the caller's effective interval; interval zero shares only simultaneous work.

The cache bounds retained data to 256 entries/16 MiB, with 1 MiB per retained result and 64 underlying operations across generations. Hard timeouts end consumer waits and sharing for that attempt; its upstream capacity remains reserved until the raw load actually settles, including when it ignores cancellation. Fresh cached successes remain available when capacity is full. Oversized valid results are returned without retention, failures are not cached, and new identities at capacity receive retryable 503 guidance. Caller aborts cannot cancel another consumer's work, returned payloads are copied, and HTTP responses remain private/no-store. Concurrency, authorization/configuration races, byte/capacity calibration, abort and mutation regressions cover these guarantees; integrated validation is recorded separately.

Priority: P1. Reduces repeated integration work when several tiles or browser tabs request the same data.

### Pre-implementation evidence and qualification

The evidence below is pinned to pre-PR revision `ab5469305429bcf97062fc72661fef1e96297ee2`, before v0.31.1; the accepted design and task list describe the completed change.

- Each validated `GET /api/widget` independently called `fetchWithHardTimeout(widget.fetchData)` in [the widget route](https://github.com/pmyszczynski/kokpit/blob/ab5469305429bcf97062fc72661fef1e96297ee2/src/app/api/widget/route.ts#L89-L97). A tile could share a reusable integration with other tiles while each browser polled separately through [useWidget](https://github.com/pmyszczynski/kokpit/blob/ab5469305429bcf97062fc72661fef1e96297ee2/src/widgets/useWidget.ts#L47).
- Fetch identity includes more than the service: [the route](https://github.com/pmyszczynski/kokpit/blob/ab5469305429bcf97062fc72661fef1e96297ee2/src/app/api/widget/route.ts#L61-L96) separated integration connection settings from per-tile options and passed the resolved footprint to legacy fetchers. Widget type, credentials, options and footprint can change the returned data.
- This is not a claim that every integration has no caching. [Netdata](https://github.com/pmyszczynski/kokpit/blob/ab5469305429bcf97062fc72661fef1e96297ee2/src/integrations/netdata/api.ts#L35-L36) already cached metrics, [qBittorrent](https://github.com/pmyszczynski/kokpit/blob/ab5469305429bcf97062fc72661fef1e96297ee2/src/integrations/qbittorrent/api.ts#L55-L56) shared authentication, and [Docker](https://github.com/pmyszczynski/kokpit/blob/ab5469305429bcf97062fc72661fef1e96297ee2/src/integrations/docker/api.ts#L110) cached its API version. Those did not provide a general saved-widget result cache. Keep those layers' semantics intact.
- [Config snapshots](https://github.com/pmyszczynski/kokpit/blob/ab5469305429bcf97062fc72661fef1e96297ee2/src/config/loader.ts#L46-L50) distinguished usable and dirty configuration and exposed the source used for a revision. Invalid or changing config must never authorize a cached response.

### Accepted design

Introduce a server-only, process-local result cache and in-flight promise map around the route's existing validated fetch. Authenticate, obtain a usable current configuration, resolve the saved tile, and validate type/integration/options **before every cache lookup**. Cache public widget data only; connection tests and authentication responses stay outside this cache. Send `Cache-Control: private, no-store` on HTTP responses so the internal cache does not create a browser or proxy cache of authenticated payloads.

Build a stable identity from the current config revision, widget definition/type, required integration type, canonical parsed connection settings including credentials, canonical parsed options (or merged parsed legacy config), and the resolved footprint/fetch context. Hash canonical identity material inside the server. Never expose or log credentials or raw cache keys. Two differently sized or configured widgets must not share a result merely because they use the same service. Identical tiles can share even if their tile IDs differ. This dashboard currently shares configuration among authorized users; if per-user integrations are introduced, the authorization scope must join the identity before enabling reuse.

Use in-flight sharing plus a short successful-result TTL, initially at most five seconds and never greater than the requesting tile's effective positive polling interval (tile override, then widget definition, then the existing default). Check freshness against each caller's effective interval rather than allowing the first consumer to choose a longer lifetime for later consumers. For widgets configured for no automatic refresh, use in-flight sharing only. TTL begins on successful completion. Do not cache failures or silently serve an expired success after a failed refresh; existing stale-data presentation remains owned by the client. Existing polling schedules stay unchanged in this improvement.

Bound settled entries, serialized retained payload bytes, individual cacheable payload size and pending fetches. Initial implementation targets are 256 settled entries, 16 MiB retained payloads, 1 MiB per retained payload and 64 pending fetches; verify these against representative RSS, media and budget payloads before settling constants. Oversized successful payloads can still be returned without retention. LRU-evict settled entries only; never evict pending work in a way that starts duplicate work. A full pending pool returns a sanitized retriable busy response for a new identity while existing identities can join their pending promise. The size limit concerns retained serialized data, not a guarantee about total process heap usage.

The cache owns the hard timeout and upstream `AbortController`. One browser aborting, unmounting or changing widget type must not cancel shared work for another consumer. Preserve current public error sanitization. A hard timeout releases the logical pending identity and its consumer waits, but the underlying-work permit is released only when the raw load settles. This includes old generations and loads that ignore cancellation; a load that never settles keeps its bounded slot. Fresh cached hits remain available, while new work at capacity receives the existing retriable busy response. Failures and late completions cannot replace a newer entry.

Use a configuration generation/revision boundary: clear settled entries when the revision changes or config becomes unavailable, and reject writes from older in-flight generations. Before returning an awaited result, check the current snapshot again; if it is dirty or its revision differs, return the existing retriable configuration-change response rather than returning a result for the previous configuration. This covers UI saves, YAML edits, credential rotation and tile deletion. Old work cannot repopulate the new generation and continues to count against underlying capacity until actual settlement, even after its consumer timeout. This mechanism must work independently of IMP-11's browser refresh transport.

### Completed implementation tasks

- [x] Inventoried widget polling intervals, footprint-sensitive fetchers and representative payload sizes, then calibrated cache limits and freshness constants against that evidence.
- [x] Added a small server-only cache module with injected time/fetch dependencies, canonical identity generation, settled/pending limits, byte accounting and generation invalidation.
- [x] Integrated it after the widget route's existing auth, saved-tile lookup and validation, retaining both legacy and options-schema calling conventions, existing timeouts and public error mapping.
- [x] Added post-await configuration-generation and authorization checks plus explicit private/no-store response headers, keeping secrets out of observability and test diagnostics.
- [x] Added a multi-tile/multi-tab browser regression for shared upstream requests and documented the freshness window and process-local scope.

### Tests

- Extend [widget API tests](../../src/__tests__/api/widget.test.ts): concurrent identical requests perform one upstream fetch; completed data is reused only within TTL; nonidentical credentials, options, integration type, widget type and footprint remain isolated. Canonical object key order does not split equivalent inputs.
- Assert unauthorized, unknown-tile, changed-type, invalid-config and dirty-config requests never receive a cached success. Rotate credentials, delete a tile and change YAML/UI revisions during a delayed request; old results cannot be served or reinserted.
- Use fake time for TTL, expiry and LRU tests. Exercise entry, byte, individual-payload and pending limits, including failures/timeouts and late completion after invalidation.
- Abort one of two consumers and verify the other still receives the result. Verify the hard timeout aborts its upstream signal and ends consumer waits promptly, while ignored-abort work retains its capacity across generations until actual resolution or rejection. Check fresh cached hits and pending joins at capacity, plus exact release on synchronous failure, cooperative cancellation and wrapper failure before load invocation.
- Preserve [useWidget tests](../../src/__tests__/widgets/useWidget.test.ts), Netdata cache behavior and qBittorrent login deduplication. Verify public errors and HTTP headers never expose identity material.

### Acceptance and compatibility

Identical authorized saved-widget requests share one upstream operation within a bounded freshness window. Config/credential/footprint changes immediately prevent reuse of the previous result. Memory and pending-work retention are bounded, and failures remain visible. Response data shapes and existing YAML remain compatible. No Redis, persistent cache, cross-process sharing or browser coordination is required; separate Node processes retain independent caches. A short TTL deliberately allows up to the documented extra data age.

<a id="imp-15"></a>

## IMP-15 — Explain service reachability and HTTP health accurately

Status: **implemented for v0.31.2**.

IMP-15 adds explicit reachability assessments to the existing saved-service `POST /api/ping` contract while retaining `ok` and HTTP `status`. A reachable 401/403, redirect, unsupported HEAD response, client error, or server error now carries a distinct assessment; transport failures are separated from checker capacity, safety, and internal failures using bounded public reasons. Observations include a completion timestamp and monotonic latency measured to response headers. Existing bounded request sharing now includes the confirmed configuration generation, preserves cached measurements, and checks configuration and authorization again before returning a result. Probes remain HEAD-only, use the existing SSRF guard, follow no redirects, inject no integration credentials, and have a five-second hard timeout.

The client presents checker failures as unavailable while retaining the last actual observation, resets and cancels work when the saved destination changes, and provides hover/keyboard tooltips with status, latency, and observation age. Tooltip descriptions attach to the existing launch-link focus stop or standalone dot, support Escape, and preserve other accessible descriptions. Theme variables and layered CSS permit ordinary custom overrides. Regression coverage includes HTTP classifications, sanitized failures, cache/timing reuse, in-flight configuration and authorization changes, destination replacement, cancellation, and tooltip accessibility/cleanup. Browser regressions cover themes, custom CSS, and shared observations across tabs handled by one server process. The validation requirements below describe delivery checks; PR and release records hold their results.

Priority: P1. Expand the existing Phase C **Status indicator upgrades** roadmap item, rather than creating a parallel feature.

### Pre-implementation evidence and qualification

The evidence below is pinned to pre-feature revision `ab5469305429bcf97062fc72661fef1e96297ee2`, except where the original audit is called out explicitly. The accepted design and task list describe the completed change for v0.31.2.

- [The saved-service probe](https://github.com/pmyszczynski/kokpit/blob/ab5469305429bcf97062fc72661fef1e96297ee2/src/app/api/ping/route.ts#L82-L125) sends a bounded `HEAD` to the saved launch URL, refuses redirects, permits configured LAN targets, and returns any received HTTP status as `{ ok: true, status }`. It already shares concurrent requests and retains results for three seconds with bounded pending/settled entries.
- [Ping tests](https://github.com/pmyszczynski/kokpit/blob/ab5469305429bcf97062fc72661fef1e96297ee2/src/__tests__/api/ping.test.ts#L113-L138) intentionally treat 404/503 and a rejected `HEAD` method as reachable. Receiving HTTP 500 proves the endpoint is reachable; the original finding overstated this as an incorrect network check.
- [StatusDot](https://github.com/pmyszczynski/kokpit/blob/ab5469305429bcf97062fc72661fef1e96297ee2/src/components/ServiceTile.tsx#L245-L264) dropped the returned HTTP status and labeled every successful probe “Online.” At the original audit, its [older implementation](https://github.com/pmyszczynski/kokpit/blob/995811da47cafc96907bae6f5979a6fc4c9fa7dd/src/components/ServiceTile.tsx#L210-L242) also mapped failed Kokpit API responses to “Offline.” IMP-11 had already added [authorization/configuration reconciliation](https://github.com/pmyszczynski/kokpit/blob/ab5469305429bcf97062fc72661fef1e96297ee2/src/components/ServiceTile.tsx#L233-L243) before IMP-15; the remaining work distinguished checker failures and HTTP health assessments.
- The [existing Phase 3 roadmap item](../Roadmap.md#phase-3--personalization) already asks for HTTP status/response-time tooltips and a shared status scheduler. The existing three-second cache is a useful starting point, not missing infrastructure to replace without cause. Batching/scheduler work remains a broader follow-up and is not necessary to complete IMP-15.

### Accepted design

Separate `reachable`, observed HTTP status and a user-facing assessment. Preserve the existing `ok` field initially for API compatibility while adding `checkedAt`, monotonic measured response time in milliseconds and a structured assessment/reason. Elapsed time measures the server-to-service probe until headers arrive, not a user's page load or browser latency. Cached results retain the original measurement and timestamp.

Use these default assessments, with accessible labels/tooltips that include actual HTTP status and probe age:

| Observation | Assessment / wording |
| --- | --- |
| Successful 2xx response | Reachable |
| 3xx response, including login redirects | Reachable; redirect returned; application health not established |
| 401 or 403 from the saved service | Reachable; authentication required/access restricted |
| 405 or 501 from `HEAD` | Reachable; status check method unsupported; application health unknown |
| Other 4xx response | Reachable; HTTP error returned; health unknown |
| Other 5xx response | Reachable; degraded (HTTP server error) |
| DNS, connection, TLS or probe timeout failure | Unreachable from Kokpit, with a sanitized bounded reason |
| Kokpit API 401/403, dirty config, unknown service, rate/capacity rejection or malformed API response | Status unavailable; never infer that the saved service is offline |

Do not follow login redirects or send integration credentials to a launch URL. Do not automatically turn 401/403 into outages. Do not automatically retry a rejected `HEAD` with `GET`: that expands network/body behavior and can cause side effects on poorly designed services. A future opt-in health endpoint/expected-status feature can provide stronger application health semantics; it is not necessary for this change. Preserve current SSRF restrictions and saved-ID-only targeting.

Reuse the existing bounded `/api/ping` probe layer and per-tile polling for this correction. Key work by config generation and saved destination; never return a previous destination's status after a config change. Distinguish capacity/checker failures from transport failures and retain original observation timestamps. Keep the existing roadmap's future batched endpoint, shared scheduler and client status owner outside IMP-15's completion criteria; they can reuse this result model later.

### Completed implementation tasks

- [x] Defined the backward-compatible result model and HTTP assessment table, documenting the difference between reachability and application health.
- [x] Reused the bounded probe cache and added monotonic timing, original observation timestamps, explicit local-checker failures and generation-aware result handling.
- [x] Added status/timing metadata and explicit unavailable reasons to `/api/ping`, preserving saved-ID validation, authorization, polling and preview/edit suppression.
- [x] Added status-dot styles and accessible tooltips using existing theme/custom-CSS conventions, keeping the optional badge display style outside this semantic correction.
- [x] Updated API and README documentation with health limitations and the meaning/age of latency measurements, leaving batching/scheduler work unchecked in the existing roadmap.

### Regression coverage

- [Ping API tests](../../src/__tests__/api/ping.test.ts) cover 2xx, redirect/login redirect, 401, 403, 404, 405, 500, 501, 503, transport failure and timeout, asserting no redirect following, credential injection or automatic GET fallback.
- ID/body validation, authorization before work, unknown IDs, private saved URLs, bounded concurrency and shared-result tests remain covered alongside timing/timestamp reuse and revision changes during a probe.
- [Status component tests](../../src/__tests__/components/ServiceStatus.test.tsx) and [tile tests](../../src/__tests__/components/ServiceTile.test.tsx) cover status vs API failures, accessible labels, pending/unavailable/degraded styling, no-color-only communication, cancellation and preview suppression.
- Browser regressions cover keyboard tooltips across all themes, mobile launch-link descriptions, custom-CSS overrides, and multiple tiles/tabs sharing a guarded HEAD observation within one server process.

### Validation requirements

After final edits, run the complete five-command local gate in `AGENTS.md` before committing or updating the PR. Record local validation, browser execution, visual inspection, and current-head CI/reviewer results in the PR and release records.

### Acceptance and compatibility

An HTTP 500 is shown as reachable but degraded; protected services, redirects and unsupported HEAD remain reachable with qualified health. Failure of the Kokpit checker is distinguishable from inability to reach the service. Tooltips expose actual HTTP status and server-observed latency/freshness. Existing saved-ID security, timeouts, private-network behavior, preview suppression and `/api/ping` clients keep working. This remains a homepage indicator, not a claim of full application or dependency monitoring.

<a id="imp-16"></a>

## IMP-16 — Give an empty dashboard a useful next action

Priority: P2. Implement the welcome-card portion of the existing Phase C **Empty states & onboarding** roadmap item.

### Evidence and qualification

- [ServiceGrid](../../src/components/ServiceGrid.tsx#L100) returns `null` when there are no renderable service tiles and no bookmark groups. An empty dashboard therefore has no contextual creation action, although navbar editing/settings still exist.
- The [existing Phase 3 roadmap item](../Roadmap.md#phase-3--personalization) already specifies an “Add your first service” card, plus broader empty-group/coach-mark work. Record this implementation under that entry. Ghost tiles and coach marks remain separately scoped unless explicitly selected later.
- [AddTilePicker](../../src/components/edit/AddTilePicker.tsx#L17), [EditableServiceGrid](../../src/components/edit/EditableServiceGrid.tsx#L928) and [EditModeProvider](../../src/components/edit/EditModeProvider.tsx#L237) already provide the picker, forms and staged save pipeline. No new onboarding wizard is needed. Some schema-v2 configurations intentionally have catalog services with no placed tiles; the card should describe an empty dashboard rather than falsely claiming there are no saved services. The current picker offers new services/presets/bookmarks, not a reusable-service placement selector.

### Design

Render a small welcome card when the dashboard has no renderable content, with an “Add your first service” action and secondary access to the existing add-tile/bookmark choices. Explain that services and layout can also be configured in `settings.yaml`; do not expose the server's absolute config path or credentials.

The primary action checks `canEdit`, enters edit mode through the existing provider, waits for the draft/grid to exist, and requests the existing picker/form flow once. Implement an explicit pending-add request like the provider's existing pending-service-edit request; consume and clear it after successful mounting or failure so rerenders cannot reopen dialogs. Reuse the normal service/preset/bookmark forms and the current Save & exit/Discard workflow. Where catalog services already exist, use “Add a tile” wording and offer the existing service-management route as secondary guidance; do not generate duplicate records. A general reusable-service placement selector is separate work. Do not auto-create example services, modify YAML just by showing the card, or require a wizard.

The empty predicate uses rendered tiles plus bookmarks, not just `services.length`. Declared empty groups alone do not suppress the card; a bookmark-only dashboard or any valid placed tile does suppress it. Do not present config failures as a healthy empty installation. Read-only rendering can show guidance without an unusable edit control. Preserve the current intentionally empty view for users once content exists and respect all themes, mobile layout and custom CSS overrides.

### Ordered implementation tasks

1. Add a small empty-dashboard component and derive emptiness from the same renderable content as ServiceGrid.
2. Add one-shot pending-add handling to the edit provider/grid, including loading/error states, double-click protection and cancellation.
3. Wire the welcome action to existing add/preset/bookmark forms; preserve normal staged save semantics and appropriate wording for existing unplaced catalog services.
4. Add compact responsive styles and configuration guidance; update the existing roadmap item to point at this plan without marking the broader onboarding feature complete.

### Tests

- Extend [ServiceGrid tests](../../src/__tests__/components/ServiceGrid.test.tsx) for an empty config, only declared groups, catalog services without tiles, bookmark-only content and populated tiles. Assert no YAML write occurs on render.
- Extend provider/grid tests for authenticated/edit-disabled states, entry failure, one-shot opening, rapid repeated activation, cancel and adding each existing picker type. Verify existing unplaced catalog entries are preserved.
- Browser-test an empty installation: activate the action, create a service, Save & exit, reload and confirm persistence; discard and confirm YAML stays unchanged. Check keyboard focus, dialog labels, small screens and existing visual themes.

### Acceptance and compatibility

A usable empty installation displays clear guidance and one direct route into the existing editor. Adding, cancelling and saving behave like other editor entry points, while existing unplaced catalog entries are preserved. A bookmark-only/populated dashboard stays uncluttered. Existing YAML and auth/setup flows remain compatible, and no cloud dependency or mandatory onboarding is introduced.

<a id="imp-17"></a>

## IMP-17 — Protect unsaved edits at the places they can be lost

Status: **implemented for v0.30.10**.

Dashboard drafts, settings sections and open service/bookmark forms now register their own unsaved work. Supported app exits offer Stay, Discard and continue, and Save & continue when a valid save exists; failed saves retain work and in-flight or later edits are not silently marked saved. Native reload/close protection is installed only while work is dirty or saving, subject to browser support, and confirmation dialogs preserve keyboard focus.

Same-document Back/Forward uses bounded non-secret recovery projections in protected-layout memory rather than universal history interception. Recovery rechecks the authorized server revision before saving, excludes credentials and unsafe URL/CSS material, and clears on explicit discard/save, sign-out, session loss or layout teardown. CSS recovery uses a limited profile and omits a field containing quoted strings, escapes, slashes, `?`, `#`, `@`, `url()` or custom-property declarations, including arbitrary unquoted URL/data payloads. Numeric/keyword declarations, variable references and color functions within that profile remain recoverable; hex colors within CSS, ID selectors, at-rules and other omitted syntax need re-entry. Separate color settings retain hex values, and production CSS rendering is unchanged. Up to 32 drafts of 256 KiB are retained; oversized drafts warn that recovery is unavailable. Component and browser regressions cover nested forms, save races, navigation, reload and revision conflicts. Integrated validation is recorded separately.

Priority: P1. Warn at destructive exits and preserve recoverable drafts through supported client navigation.

### Evidence and qualification

The pre-v0.30.10 issue descriptions below are historical evidence. The following design, task list and acceptance criteria preserve the accepted implementation plan; the implementation record above describes the delivered behavior.

- [EditModeProvider](../../src/components/edit/EditModeProvider.tsx#L167) already derives dirty configuration against a baseline and retains drafts after save/conflict errors. [EditBar](../../src/components/edit/EditBar.tsx#L36) exposes Discard and conflict Reload; the provider also toggles out of edit mode via Mod+E without a dirty-exit confirmation.
- The provider sits in [the protected layout](../../src/app/(protected)/layout.tsx#L55), so its staged dashboard draft can survive navigation between protected routes. It is incorrect to assume every Settings link necessarily discards that provider's draft.
- [SettingsPanel](../../src/components/SettingsPanel.tsx#L91) stores appearance, auth-policy, groups, services and bookmarks state independently. Settings-tab switches retain that component's state; they do not automatically lose every draft. Leaving the settings route, full-page navigation and closing an unsubmitted modal can lose local input. Services/bookmarks often write immediately after form submission, while appearance/groups have explicit saves; their dirty baselines must reflect these differences.
- [ServiceForm](../../src/components/ServiceForm.tsx) and [BookmarkGroupForm](../../src/components/BookmarkGroupForm.tsx#L106) hold unsubmitted fields locally and use native `<dialog>`. Explicit close and native Escape cancellation need protection before closing. An `onClose` handler alone is too late to cancel data loss.
- The installed Next 16 documentation supports [`Link.onNavigate`](https://nextjs.org/docs/app/api-reference/components/link#blocking-navigation) for SPA navigation cancellation (also inspected locally at `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md`, “Blocking navigation”). [`useRouter` from `next/navigation`](https://nextjs.org/docs/app/api-reference/functions/use-router) exposes navigation methods, but no documented universal route blocker, Pages Router `beforePopState`, or cancellable browser Back event. Do not patch history/router internals or use obsolete `router.events` patterns.

### Design

Add a small shared unsaved-changes registry in the protected client layout. Sources register whether they are dirty or saving, the operations that can discard them, and their existing save/discard behavior. Aggregate dashboard draft, each relevant settings section and any open form's unsubmitted fields. Derive dirty state from normalized values against the last confirmed successful snapshot, not just whether an input ever received a change event. Reverting an edit clears dirty state; failed or conflicted writes do not. Saving one settings section cannot clear another section's pending edits. A save acknowledgment advances only the submitted snapshot so edits typed while the write was in flight remain dirty.

Use a guarded Link wrapper with supported `onNavigate`, and explicit guards before app-owned `router.push`/`replace`, logout, conflict reload, edit-mode toggle and other destructive reset actions. Show a focused confirmation offering Stay and Discard/leave; where an existing valid save action applies, offer Save & continue. Confirming Discard itself is sufficient intent and must not trigger a second warning. Invalid/conflicted forms remain on screen if saving cannot complete. A failed save or cancelled confirmation leaves all current values and theme previews intact.

Register `beforeunload` only while there is actual unsaved work or a pending write. Call `preventDefault()` and set `returnValue` for browser compatibility. Browser text is generic, user activation is required, some mobile/app termination paths never fire it, and its use can affect back/forward caching. Do not promise a custom message or guaranteed tab-close protection. Remove listeners as soon as work is saved/discarded. Links opening a new tab, downloads and actions that preserve the current editor do not need a destructive-exit prompt.

Native dialog protection happens before dismissal: use `onCancel` to prevent dirty Escape closure, and route close/cancel buttons through the same confirmation before calling `.close()`. Keep focus in the original dialog if Stay is selected. On successful submit, transfer the fields to the parent draft/write pipeline first, then unregister the form and close without a duplicate warning. Do not add a guard to the picker, which contains no editable draft. Detect dirty fields even when the parent dashboard itself is still clean.

Because Next's Link guard does not intercept browser same-document Back/Forward, retain non-secret settings and open-form draft recovery state in the long-lived protected client provider, keyed by editor identity and baseline revision. Restore it on return with a visible unsaved/recovery notice; do not automatically write it. Keep existing dashboard state in its current provider. Clear retained state on confirmed discard, successful save, logout or expiry of the protected layout/session. No localStorage, sessionStorage or disk persistence is needed. Do not retain passwords, API keys, TOTP/recovery material or secret-bearing raw config in recovery snapshots; normal live form memory is separate. Track edited sections and fields before sanitization: untouched values come from the authorized server baseline, while explicit edits retain their sanitized projections, including intentional URL query removal or clearing. Bookmark row provenance survives reordering without caching original URL values. If a returned draft's baseline no longer matches the current revision, keep conflict safeguards and offer review/reload rather than silently merging or saving it.

Full-document Back/Forward can use native `beforeunload`; same-document traversal has the documented recovery behavior rather than a fabricated cancellable `popstate` guarantee. Secret fields on browser-driven traversal may require re-entry. Treat this as an explicit browser limitation. Investigate an additional supported navigation-cancellation API only if the project's browser matrix and Next version support it; do not make this work depend on monkeypatching browser internals.

### Ordered implementation tasks

1. Map destructive exits and actual state lifetimes in dashboard editing, Settings tabs, group edits, service/bookmark forms, logout and conflict reload. Record which actions already persist immediately.
2. Add the shared registry and per-source normalized baselines. Track pending writes and submitted snapshots so concurrent user edits are preserved.
3. Add app-owned navigation/destructive-action guards through supported Link/onNavigate and explicit handlers, plus conditional native `beforeunload` registration.
4. Add dirty modal dismissal handling for explicit close and `onCancel`, preserving focus and the existing native-dialog lifecycle.
5. Add bounded in-memory non-secret draft retention/restoration for route-local settings/forms and revision-aware conflict handling. Integrate with IMP-11 so a remote config update never resets a dirty draft.
6. Provide clear unsaved/recovery indications and document browser limitations. Keep credentials out of recovery storage and avoid warnings on harmless settings-tab switches.

### Tests

- Extend [edit-mode/provider/grid tests](../../src/__tests__/components/EditableServiceGrid.test.tsx), [SettingsPanel tests](../../src/__tests__/components/SettingsPanel.test.tsx), [ServiceForm tests](../../src/__tests__/components/ServiceForm.test.tsx) and [BookmarkGroupForm tests](../../src/__tests__/components/BookmarkGroupForm.test.tsx): dirty/reverted state, independent settings sections, failed/conflicted writes, edit-during-save, successful baselines and deliberate Discard.
- Test guarded links and app-owned navigation: Stay retains values, Save & continue waits for success, failed/invalid save stays, and Discard leaves once. New-tab/download actions and clean navigation do not warn.
- Test listener registration/removal and native dialog Escape/close cancellation. An open dirty form must guard even when the parent draft is otherwise clean; successful form submission must not double-prompt.
- Extend [settings UI/conflict E2E](../../e2e/tests/settings-ui.spec.ts) and [settings conflicts](../../e2e/tests/settings-conflicts.spec.ts): real browser reload confirmation after user interaction, internal navigation, native dialog cancellation, browser Back/Forward draft restoration and changed-revision recovery. Verify no history loops or patched global methods.
- Assert recovered drafts omit credentials/TOTP/recovery content and no browser storage writes occur. Exercise logout, session expiration and protected-layout teardown cleanup. Check screen-reader labels and focus return after Stay.

### Acceptance and compatibility

Dirty dashboard/settings/form data triggers a warning before app-controlled destructive exits and supported full-page unloads. Cancelling retains the draft, successful saves clear only confirmed work, and explicit discard remains straightforward. Settings-tab switches retain drafts without needless warnings. Browser same-document history traversal can recover non-secret drafts with revision checks; universal interception of all browser/mobile termination is not promised. Existing auth/session behavior, API write ordering, optimistic concurrency and YAML save semantics remain intact.
