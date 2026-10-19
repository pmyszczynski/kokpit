# Reassessment and selection decisions for review findings

Date: 2026-10-20. This document records closer inspection of original items
2, 9, 12, 13 and 18. The owner subsequently selected **2, 13 and 18**, now tracked
in the [implementation index](2026-10-20-improvement-plan.md). Only **9 and 12**
remain unselected. Reconciliation with `main` at `71ef878` shows that PR #132 /
v0.27.1 already fixed 2 and 18, alongside selected item 3. The historical findings
below distinguish that original evidence from the current implementation.

## Item 2 — authentication defaults

**Verdict: real and worth fixing; high value for a small change.**

**Current status:** completed in PR #132 / v0.27.1; see the
[IMP-02 implementation record](2026-10-20-auth-hardening-plan.md#imp-02).

In the originally reviewed [auth schema](../../src/config/schema.ts), the outer default was
`{ enabled: true }` while `enabled` inside an existing mapping defaults to
`false`. Local schema checks confirm that omitting `auth` enables protection,
but `auth: {}` or an auth mapping containing only `session_idle_timeout_hours`
disabled it. This was a configuration footgun, not a remote bypass of a correctly
configured instance with explicit `enabled: true`. The current inner default is
now true, with schema and protected-API regression coverage.

**Fix:** default the inner field to true while preserving explicit
`enabled: false` and the deliberate `KOKPIT_AUTH_DISABLED` override. Add schema,
loader, and protected route tests for absent, empty, idle-only, enabled, and
disabled mappings. Explain the change for installations that unintentionally
relied on the old implicit disablement, including the setup/login path.

**Why it is worthwhile:** an operator changing an unrelated session setting
should not accidentally publish a private dashboard. The behavior change is
small, but it needs an upgrade note because some existing files can change from
public to protected after upgrading.

## Item 9 — mandatory If-Match

**Verdict: earlier severity was overstated; this is an API policy choice, not a
missing UI safeguard. Defer mandatory enforcement.**

[The settings API](../../src/app/api/settings/route.ts) checks `If-Match` whenever
it is supplied, and the settings and dashboard editors supply their captured
revision. An explicit [compatibility test](../../src/__tests__/api/settings.test.ts)
allows requests without the header. The server also serializes writes and checks
the exact authorized disk source before installation. Those controls still
apply when the request lacks a client revision.

The remaining limitation is that an old external API client can submit an
outdated whole section without a base revision; the server cannot know which
version that client originally edited. It can accept that intentional update
and overwrite a more recent value.

**Fix if stronger API guarantees become a goal:** document the revision contract,
update known clients, deprecate headerless writes, and then return HTTP 428
`Precondition Required` for them. Continue rejecting stale supplied revisions.

**Why defer:** normal in-app editing is already protected. Immediate mandatory
enforcement would break supported clients for a modest additional benefit.
The observation about headerless clients is real; presenting it as a general
failure of stale-editor protection was a false flag.

## Item 12 — synchronous configuration lock waits

**Verdict: real, but lower priority for the normal single-process deployment.**

[Lock acquisition](../../src/config/loader.ts) retries with `Atomics.wait()` up to
the five-second deadline. If another process owns the lock, or a crash leaves a
lock requiring operator recovery, the Node event loop cannot handle unrelated
requests during that wait. Normal dashboard reads do not acquire this lock, and
the API already queues writes within a single process, so ordinary polling does
not routinely incur this delay.

**Fix:** make runtime API lock contention fail quickly with a retryable response,
or use asynchronous acquisition with a bounded deadline. Keep startup migration
behavior separate if synchronous bootstrap remains simpler. Preserve exact-source
checks, atomic installation, and the deliberate rule against reclaiming a lock
just because it looks stale; an async refactor is not permission to weaken them.

**Why it may be worthwhile:** it prevents a configuration conflict from freezing
the rest of the dashboard. It becomes more valuable with multiple writers or
observed lock incidents. For a single instance with infrequent saves, deferring
this is reasonable; a broad persistence rewrite would be disproportionate.

## Item 13 — adaptive browser polling

**Verdict: real efficiency opportunity, not a demonstrated correctness failure.**

**Selection:** now planned as
[IMP-13](2026-10-20-dashboard-reliability-plan.md#imp-13).

[Widget polling](../../src/widgets/useWidget.ts) and
[service status polling](../../src/components/ServiceTile.tsx) use fixed intervals
without application-level visibility/offline gating or failure backoff. Browsers
already throttle some hidden-tab timers, and failed fetches are aborted or bounded
elsewhere, so the original finding should not imply unlimited overlapping work
or constant background frequency in every browser.

**Fix:** pause application polling while hidden/offline, refresh when visible or
online again, and use capped backoff with jitter after failures. Keep last good
data visible and reset backoff after success. Schedule a consumer's next poll
after completion rather than repeatedly canceling slow work.

**Why it may be worthwhile:** it saves laptop power and upstream requests when
many dashboards are left open. Selected IMP-14 already reduces duplicate server
work; this adds browser-side savings. It is independently useful rather
than a prerequisite for IMP-14. Polling currently counts as session activity, so
pausing it can allow hidden dashboards' idle sessions to expire; document and
test that interaction instead of silently redefining the session policy.

## Item 18 — password reset utility in the production image

**Verdict: real, worthwhile, and especially relevant when all recovery options
have been lost.**

**Current status:** completed in PR #132 / v0.27.1; see the
[IMP-18 implementation record](2026-10-20-operations-validation-plan.md#imp-18).

[The Dockerfile](../../Dockerfile) copies standalone output, public assets, static
assets, and the entrypoint into the runner; it does not explicitly copy
`scripts/reset-password.js`. The utility is not imported by application runtime
code, so ordinary Next tracing did not require it. The originally inspected local
standalone output contained the `reset-password` npm command but lacked its target script.
[README recovery instructions](../../README.md#account-recovery) tell operators
to run that command inside the container. The current
[Next configuration](../../next.config.ts) explicitly traces the utility and
bcrypt runtime into standalone output; production E2E checks utility and database
dependency loading. It does not exercise the interactive reset itself. An extra
Dockerfile COPY is no longer required to fix the packaging gap.

**Fix:** explicitly package the utility and its runtime dependencies, retain the
configured `/data/users.db` path, and run an isolated container smoke test. Prove
the documented command starts and can reset a disposable account, revokes its
old sessions, and handles its optional TOTP/recovery-code changes. Do not use
real user state in the test.

**Why it is worthwhile:** the alternative requires manually mounting the database
into another environment or editing it during an incident. Explicit packaging
is a small change that makes the documented last-resort recovery path usable.
