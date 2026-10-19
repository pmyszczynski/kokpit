# Request boundaries and deployment secret plan

Date: 2026-10-20. Status: planned; no runtime changes implemented.

This document covers the owner-selected findings IMP-04, IMP-05 and IMP-08 from the twenty-item project review. The [improvement plan](2026-10-20-improvement-plan.md) owns the delivery order, cross-cutting dependencies and full required validation gate. Each item below is independently reviewable; completing one does not mark the others complete.

Source links are relative to this document and point to the inspected repository state. Recheck them and the installed Next.js documentation before implementation.

<a id="imp-04"></a>

## IMP-04 — Keep integration credentials within the configured origin

### Evidence and scope

[`fetchWithApiKey`](../../src/integrations/shared/http.ts) sends `X-Api-Key` using the default fetch redirect policy. Its callers include Radarr, Sonarr, Seerr and Immich. The helper also accepts an arbitrary absolute HTTP(S) request URL, and its [current tests](../../src/__tests__/integrations/shared-http.test.ts) explicitly permit sending the configured key to another origin.

A read-only reproduction on 2026-10-20 used two temporary loopback HTTP servers on different ports and synthetic credentials. Node fetch followed a 302 and delivered both `X-Api-Key` and `X-Netdata-Auth` to the second origin. Fetch removed `Authorization` and `Cookie` in that reproduction. The issue is therefore confirmed for custom credential headers; it should not be described as every credential header leaking identically.

Changing only this helper leaves equivalent requests elsewhere:

| Request family | Current transport | Required treatment |
| --- | --- | --- |
| Radarr, Sonarr, Seerr, Immich | [`shared/http.ts`](../../src/integrations/shared/http.ts), `X-Api-Key` | Harden shared helper and preserve each caller's base-path normalization. |
| Prowlarr | [`prowlarr/api.ts`](../../src/integrations/prowlarr/api.ts), duplicate `X-Api-Key` helper | Reuse hardened helper. |
| Tdarr, Actual Budget | [`tdarr/api.ts`](../../src/integrations/tdarr/api.ts), [`actualbudget/api.ts`](../../src/integrations/actualbudget/api.ts), `x-api-key` | Apply the same boundary, including Tdarr's POST and optional GET. |
| Netdata | [`netdata/api.ts`](../../src/integrations/netdata/api.ts), `X-Netdata-Auth` | Protect transport without undertaking the deferred Netdata UI migration. |
| Unraid | [`unraid/api.ts`](../../src/integrations/unraid/api.ts), bearer header and GraphQL POST | Explicit policy; do not rely solely on fetch's header stripping. |
| qBittorrent | [`qbittorrent/api.ts`](../../src/integrations/qbittorrent/api.ts), login form body and session cookie | Include credential-bearing POST bodies and reauthentication paths in audit. |
| Plex, Tautulli, SABnzbd | [`plex/api.ts`](../../src/integrations/plex/api.ts), [`tautulli/api.ts`](../../src/integrations/tautulli/api.ts), [`sabnzbd/api.ts`](../../src/integrations/sabnzbd/api.ts), URL query credentials | Include in audit and use explicit policy. Do not claim all ordinary redirects retain the original query: an upstream redirect can explicitly copy it into `Location`. |

Weather already uses `redirect: "error"`; public RSS fetching and icon discovery have separate redirect/SSRF requirements. Keep those separate. Private homelab destinations remain valid: origin containment is not a new prohibition on LAN addresses.

### Design

Introduce a small shared transport for credential-bearing integration requests. It receives the configured base URL, fully resolved target URL, method, headers/body and caller signal. Check the initial target before sending anything: HTTP(S) only, no URL userinfo, and the same canonical `URL.origin` as the configured base. Same hostname with another port or scheme is a different origin. Reject cross-origin absolute paths rather than injecting the key into them.

For GET/HEAD, use `redirect: "manual"`, follow at most five supported redirect responses, and resolve relative `Location` against the current URL. Validate every destination against the original configured origin before connecting to it. Cancel unused redirect bodies, preserve the caller's abort signal and existing hard timeout across the whole chain, and fail on loops, invalid locations or unsupported schemes. This keeps same-origin reverse-proxy path and trailing-slash redirects working. It must not automatically append credentials to a redirected URL's query string.

For credential-bearing methods with a body, initially reject redirects explicitly, including same-origin redirects. This avoids silently replaying a login form or POST body and avoids inventing method rewriting rules for 301/302/303. Document that these integrations must be configured with their final endpoint/base URL. Any future need for same-origin 307/308 replay requires a service-specific, tested extension.

Keep URL construction in the existing callers: their base subpaths and trailing-slash behavior are already tested. In particular, do not combine this security fix with changing the current shared helper's no-trailing-slash URL resolution. HTTP-to-HTTPS redirects cross origins too; operators should configure the final HTTPS URL.

Expose a safe redirect failure through the existing widget error path. Error text and diagnostics must not contain API keys, cookies, POST bodies, URL query credentials or raw credential-bearing `Location` values. A rejected redirect should tell the operator to check the configured final URL without echoing secrets.

### Ordered implementation tasks

1. Inventory every credential-bearing fetch, including secondary requests, login retries and optional requests. Record the expected method, origin, base-path behavior and credential location for each family above.
2. Add focused regression coverage to the shared HTTP tests and a Node transport test using two local servers. Assert that a forbidden destination receives zero requests, not merely that a mock observed `redirect: "manual"`.
3. Implement the shared origin-bound transport; route `fetchWithApiKey` through it and migrate Prowlarr's duplicate helper. Retain successful response/error/abort behavior.
4. Apply the boundary to the remaining credential-bearing fetch paths, preserving service-specific parsing, caches and optional endpoint fallbacks. Keep failure classification useful when a redirect is the cause.
5. Update the affected integration documentation with the final-URL requirement and same-origin GET redirect behavior. Audit errors and logs for secret exposure.
6. Run affected integration tests and the transport regression, then the full gate in the [improvement plan](2026-10-20-improvement-plan.md).

### Focused verification and acceptance

- Same-origin relative/absolute redirects for GET/HEAD work, including reverse-proxy subpaths, chained relative locations and trailing-slash canonicalization.
- A different hostname, port or scheme, a protocol-relative cross-origin location, URL userinfo, non-HTTP(S) destination, loop or sixth redirect fails safely. No forbidden origin receives a request or credentials.
- Custom headers are tested case-insensitively, including `X-Api-Key`, `x-api-key` and `X-Netdata-Auth`. Query credentials, cookies, bearer credentials and a synthetic login form are covered by representative transport tests.
- A credential-bearing POST redirect is rejected without replaying its body. Cancellation/abort interrupts the chain and unused redirect bodies are closed.
- Existing base-path tests still pass, except the test explicitly allowing cross-origin absolute credential injection, which becomes a rejection test. All listed integration families have an explicit audited redirect policy.

Compatibility impact: configurations relying on redirects to another host, port or scheme need the final URL entered directly. Same-origin GET canonicalization remains supported. Body-bearing endpoints must already point at their final URL. This is a deliberate, documented boundary change.

<a id="imp-05"></a>

## IMP-05 — Use a generated persisted secret by default

### Evidence and correction

Both services in [`docker-compose.yml`](../../docker-compose.yml) force the public value `change-this-to-a-random-32-char-secret-before-use`. [`getServerSecret`](../../src/auth/serverSecret.ts) already supports an omitted override: it generates 32 random bytes, persists a hexadecimal secret beside the SQLite database with mode `0600`, handles a competing creator with an exclusive write, and reuses the persisted value. Explicit nonempty environment overrides currently take precedence.

The [README quick-start example](../../README.md) correctly makes the override optional, but its build-from-source Compose instructions still tell users to replace the placeholder. These should agree.

Do not describe this as a shared signing key for normal login sessions. [`sessionStore.ts`](../../src/auth/sessionStore.ts) uses opaque tokens backed by SQLite. The server secret currently signs [five-minute TOTP challenges](../../src/auth/jwt.ts), [widget secret/config references](../../src/widgets/secretReference.server.ts) and [configuration revision HMACs](../../src/config/revision.ts). A known value weakens these primitives; knowing it alone does not create a valid opaque session or supply a user's TOTP code.

### Design

Remove the active placeholder assignment from development and production Compose services. Let the existing generated-secret path be the default, backed by the mounted `./data:/data` directory. Retain an optional commented example for an explicitly managed random value, with a generation command and clear persistence guidance.

Reject the exact shipped placeholder in both explicit environment overrides and persisted files. Keep existing empty-secret rejection and preserve other nonempty explicit overrides byte-for-byte; do not add an unrelated minimum-length or entropy heuristic that silently breaks existing deployments. Never silently replace an explicitly configured secret or a nonempty persisted secret.

Validate the effective secret during runtime initialization in [`instrumentation.node.ts`](../../src/instrumentation.node.ts), using the existing build guard in [`instrumentation.ts`](../../src/instrumentation.ts). A known placeholder should produce an actionable startup error without logging its value; build-time tracing must not create or bake secret state into the image. Reuse the shared getter rather than duplicating precedence and file handling in the entrypoint.

Document replacement of an existing shipped placeholder: stop the container, remove that override or replace it with a generated random value, retain the data volume, and restart. If a persisted secret already exists it remains authoritative when no override is supplied; if it too is the known placeholder, require deliberate replacement. Do not rotate an already valid persisted key merely because Compose changed.

### Ordered implementation tasks

1. Extend [`serverSecret.test.ts`](../../src/__tests__/auth/serverSecret.test.ts) to reject the known placeholder in each supported source while retaining custom override precedence, exact accepted override bytes, empty rejection, exclusive creation and read-error behavior.
2. Update Compose and both README deployment paths to use the existing generated default and explain optional managed overrides plus data-volume persistence.
3. Add runtime validation through the guarded initialization path. Extend [`instrumentation.test.ts`](../../src/__tests__/instrumentation.test.ts) to prove no runtime initialization during production builds and no secret creation in build artifacts.
4. Document rotation effects: in-flight TOTP challenges expire/are invalidated, open editors must reload to obtain new secret references/revision values, and database-backed opaque sessions remain valid unless separately revoked. Do not promise signing-key rotation revokes login sessions.
5. Verify a fresh Compose container creates its own persisted secret; restart it with the same volume and verify reuse. Start a second fresh volume and verify independent generation. Exercise the optional custom override.
6. Run focused auth, config-revision and widget-secret-reference tests plus the full gate in the [improvement plan](2026-10-20-improvement-plan.md).

### Focused verification and acceptance

- Default Compose deployment has no shared public secret and survives restart without changing its generated key.
- Accepted explicit override values keep their current precedence and encoding. Both sources reject the known shipped placeholder with an actionable error and no secret in logs.
- The persisted secret is private, an existing secret is never silently overwritten, competing creation remains safe, and filesystem failures fail clearly.
- Runtime initialization validates the key while production builds neither require a deployment key nor create secret state in standalone output.
- Rotation tests cover TOTP challenge invalidation, stale references/revisions requiring reload and continued validity of an existing opaque session.

Compatibility impact: existing operators using the known placeholder must remove or replace it before upgrading; accepted custom secrets and existing valid persisted secrets continue to work. Removing the Compose override can intentionally change the effective key once for installations that previously used that placeholder. This is worthwhile as a small default-deployment fix, with narrower impact than the original label might suggest.

<a id="imp-08"></a>

## IMP-08 — Bound request parsing and validate JSON objects

### Evidence and scope

Rechecked against `71ef878` (v0.27.1): [`login`](../../src/app/api/auth/login/route.ts) now rejects `null`, arrays and other JSON primitives with a controlled 400 before credential work. Its SQLite account/global limiter is also already present and must be preserved when migrating its parser. The original login-null example is resolved, although login still lacks a streamed body-size cap.

[`setup`](../../src/app/api/setup/route.ts), [`TOTP verify`](../../src/app/api/auth/totp/verify/route.ts) and [`TOTP setup POST/DELETE`](../../src/app/api/auth/totp/setup/route.ts) still destructure the result of `req.json()` after only a TypeScript annotation. Valid JSON `null` therefore throws instead of returning a controlled 400 on those routes. Other auth routes already have runtime checks, so avoid claiming no validation exists anywhere.

[`settings PATCH`](../../src/app/api/settings/route.ts) already uses a Zod object schema, but reads and validates the full JSON body before authorization. None of these JSON parsers has an application-level byte cap. The settings route's queued exact-source snapshot authorization, secret resolution and compare-and-swap are valuable existing protections and must remain intact.

Include every JSON-body mutation route: login, setup, password reset, recovery-code regeneration, TOTP setup/disable/verify, session actions, settings PATCH, [`widget connection tests`](../../src/app/api/widget/test/route.ts) and [`icon detection`](../../src/app/api/icon/detect/route.ts). Keep endpoint-specific schemas, error envelopes and existing request guards.

Uploads are different: [icons](../../src/app/api/icons/upload/route.ts) and [backgrounds](../../src/app/api/backgrounds/upload/route.ts) already reject large declared bodies and enforce decoded-file limits of 2 MiB and 8 MiB respectively. However, they call `formData()` before checking the actual file, so an absent or understated `Content-Length` does not bound multipart parsing memory. Their streamed envelope cap must be handled explicitly rather than claiming their existing file checks solve this.

### Design

Add a shared bounded-body reader that consumes `Request.body` once, counts actual `Uint8Array.byteLength` across chunks and stops/cancels as soon as the route limit is exceeded. Check a valid `Content-Length` up front as an optimization; never trust it as the cap. Buffer at most the permitted body for parsing, handle read/abort errors safely, and decode bytes only after the bounded read. JSON parsing must return an object excluding `null` and arrays before endpoint schema validation. Never echo rejected body content or credentials.

Initial explicit limits are 16 KiB for auth/session JSON, 64 KiB for icon detection, 256 KiB for widget connection-test JSON and 2 MiB for settings PATCH. Store limits as named constants and document bytes, scope and 413 behavior. Before fixing these values in implementation, exercise a representative large valid dashboard and each integration's largest plausible connection config; raise a route's constant if needed to retain supported usage. This calibration does not justify leaving a route unbounded. Coordinate password field validation with IMP-07 rather than imposing accidental UTF-16-based truncation here.

Keep existing content-type guards, especially icon detection's `application/json` requirement that participates in its CSRF protection. A centralized helper must not weaken the `x-kokpit-request`/Fetch Metadata checks on auth mutations. Do not add an unrelated broad API compatibility break by requiring a new content type on routes that currently accept existing clients without one; any tightening must be separately documented and tested.

Perform cheap request guards and an initial authorization check before reading protected bodies. Public login/setup/reset/TOTP challenge verification remain public as appropriate. Use strict session validation for account/session mutations even when dashboard auth is disabled; use the existing config-aware helper for dashboard settings. After any awaited parse/password work, retain each route's final authorization/revocation checks before mutation.

For settings PATCH specifically:

1. Obtain a read-only preliminary config snapshot and perform the existing fail-closed, config-aware authorization check; reject unauthorized requests without consuming the body. An unavailable/dirty configuration must not be promoted to writable by this check.
2. Read a bounded body and validate the patch outside the write queue, so a slow sender cannot hold that queue.
3. Inside `serializeSettingsWrite`, obtain a fresh `getConfigSnapshotForWrite()` and retain the existing exact-snapshot checks. Authorization, auth-setting password proof, migration handling, secret resolution and revision/CAS must continue using that same stable source and current user/session state.
4. Keep final write-time revision checking against external edits. The preliminary check is an optimization only, never authority to save after an intervening enable-auth change, revocation or config edit. Do not silently introduce IMP-09's unselected mandatory `If-Match` behavior.

For multipart uploads, reuse the byte reader with separate envelope limits of the existing file limit plus a documented 64 KiB multipart allowance. Reject actual streamed envelopes over that limit before calling a multipart parser; then retain the existing selected-file handling, MIME/magic/sanitization and decoded-file checks. Parse the bounded bytes once; avoid cloning or teeing an unbounded stream. Many unrelated fields or excessive boundary overhead may now receive 413 even when the selected file is small, which is intentional. Do not apply JSON limits to image uploads or reduce the existing file sizes.

The installed Next.js App Router uses Web `Request` bodies; Pages Router `bodyParser.sizeLimit` and Server Action limits do not provide this route-level guarantee. Inspect proxy buffering too: Next.js `proxyClientMaxBodySize` concerns cloned proxy buffers and is not a substitute for a controlled 413 at the route. Browser and standalone-server checks should confirm no route-specific assumption is lost before the handler receives the request.

### Ordered implementation tasks

1. Inventory all direct `request.json()`/`req.json()`/`formData()` uses and their guards. Add the bounded reader plus a JSON-object/schema wrapper with typed, safe 400/413 errors and route-preserved error envelopes.
2. Add helper tests for streamed cap enforcement, then migrate public auth endpoints first. Prove invalid shapes cannot reach bcrypt, user creation, TOTP verification or other expensive work.
3. Migrate protected auth/session routes, preserving strict session checks, reauthentication and final no-await mutation guards.
4. Add the settings preliminary auth check and bounded parse without moving the existing write-snapshot authority out of its queue. Expand existing race/revision/secret-preservation tests.
5. Migrate widget tests and icon detection, preserving their content-type, authentication and outbound request restrictions.
6. Bound multipart envelopes separately while preserving existing upload validation/file limits; add missing-length and chunked-overflow upload tests.
7. Document per-route limits and error behavior, run focused API/auth/upload suites and representative standalone HTTP probes, then the full gate in the [improvement plan](2026-10-20-improvement-plan.md).

### Focused verification and acceptance

- `null`, arrays, strings/numbers/booleans, malformed/empty JSON and wrong field types return controlled 400s; valid existing request shapes remain accepted. No schema error includes submitted password/key values.
- Exact byte limit is accepted when the payload/schema is valid; limit plus one byte returns 413. Include UTF-8 multibyte bodies, one oversized chunk and many small chunks, no `Content-Length`, falsely small length in a constructed request, a stream read error and cancellation. Verify the reader stops after detecting overflow rather than buffering the rest. For real HTTP probes, use chunked transfer rather than assuming a server can accept contradictory HTTP framing.
- Unauthorized protected requests return before consuming body bytes or invoking expensive parsing, hashing or upstream integration work. Existing 401/403 distinctions and endpoint envelopes remain useful.
- A revoked session or config auth toggle during body streaming cannot authorize a later settings write. Dirty/migration states, queue serialization, external file edits, optional current `If-Match`, final CAS and opaque widget-secret references retain their current protections.
- Oversized multipart envelopes are stopped before `formData()` for absent/chunked lengths; legitimate 2 MiB icons and 8 MiB backgrounds within the envelope allowance still work and retain sanitizer/type checks.
- Installed-framework and standalone checks demonstrate the same controlled errors delivered to the browser. Limits are documented and a representative large valid dashboard can still be saved.

Compatibility impact: requests above explicit route/envelope limits receive 413; invalid JSON primitives that previously slipped through casts now receive 400. Valid normal clients keep their schemas, auth guards and documented file limits. Early authorization may change an unauthenticated malformed request from 400 to 401, which is deliberate.
