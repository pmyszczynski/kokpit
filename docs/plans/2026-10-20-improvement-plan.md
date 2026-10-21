# Selected project improvements — implementation index

Date: 2026-10-20. Status: 10 planned, 8 implemented; completed rows record
their release or upstream PR.

The owner selected original review items **1–8, 10, 11 and 13–20**.
The `IMP-NN` identifiers below retain those original numbers. The roadmap owns
completion checkboxes; this index connects the 18 selected items to their designs,
dependencies, and validation. Each linked document contains a separate subplan
for every listed item, including implementation steps and acceptance criteria.

Baseline reconciled to `main` at `71ef878` (v0.27.1). PR #132 / commit `1097384`
already implements IMP-02, IMP-03 and IMP-18. Those entries are completed in the
roadmap, with implementation evidence in their linked sections; their historical
findings are not claims about the current code. IMP-01 is now implemented for
v0.30.2; IMP-06's per-challenge replay state remains open. The other uncompleted
entries are future work.

## Selected work

| ID | Priority | Outcome | Implementation plan |
| --- | --- | --- | --- |
| IMP-01 | P0 | **Implemented for v0.30.2:** valid dummy bcrypt verification removes the unknown-user timing shortcut. | [Authentication](2026-10-20-auth-hardening-plan.md#imp-01) |
| IMP-02 | P0 | **Implemented, PR #132:** missing, empty and session-policy-only auth mappings default to protected access. | [Authentication](2026-10-20-auth-hardening-plan.md#imp-02) |
| IMP-03 | P0 | **Implemented, PR #132:** durable account/TOTP throttling and a rolling shared budget bound admitted attempts. | [Authentication](2026-10-20-auth-hardening-plan.md#imp-03) |
| IMP-04 | P0 | **Implemented for v0.30.3:** credential-bearing integration requests cannot follow redirects to another origin. | [Request boundaries](2026-10-20-request-boundaries-plan.md#imp-04) |
| IMP-05 | P0 | **Implemented for v0.30.4:** Compose uses generated persisted secrets and rejects the public placeholder. | [Request boundaries](2026-10-20-request-boundaries-plan.md#imp-05) |
| IMP-06 | P1 | Unique TOTP challenges have atomic, durable attempt and consumption state. | [Authentication](2026-10-20-auth-hardening-plan.md#imp-06) |
| IMP-07 | P1 | New and replacement passwords cannot be silently truncated by bcrypt. | [Authentication](2026-10-20-auth-hardening-plan.md#imp-07) |
| IMP-08 | P1 | **Implemented for v0.30.6:** Actual streamed request bytes are bounded before parsing, with JSON-object validation and fresh authorization. | [Request boundaries](2026-10-20-request-boundaries-plan.md#imp-08) |
| IMP-10 | P1 | UI writes preserve comments on retained YAML settings and records. | [Configuration sync](2026-10-20-config-sync-plan.md#imp-10) |
| IMP-11 | P1 | Open browsers observe stable configuration changes without silently losing drafts. | [Configuration sync](2026-10-20-config-sync-plan.md#imp-11) |
| IMP-13 | P1 | Visible, online consumers poll without overlap and use bounded failure backoff. | [Dashboard reliability](2026-10-20-dashboard-reliability-plan.md#imp-13) |
| IMP-14 | P1 | Equivalent widget requests share bounded upstream work and cached results. | [Dashboard reliability](2026-10-20-dashboard-reliability-plan.md#imp-14) |
| IMP-15 | P1 | Service indicators distinguish reachability, HTTP failures, and probe errors. | [Dashboard reliability](2026-10-20-dashboard-reliability-plan.md#imp-15) |
| IMP-16 | P2 | An empty dashboard offers an accessible first-service action. | [Dashboard reliability](2026-10-20-dashboard-reliability-plan.md#imp-16) |
| IMP-17 | P1 | Navigation cannot silently discard staged changes where the browser permits protection. | [Dashboard reliability](2026-10-20-dashboard-reliability-plan.md#imp-17) |
| IMP-18 | P1 | **Implemented, PR #132:** standalone tracing packages the emergency reset command and runtime dependencies. | [Operations and validation](2026-10-20-operations-validation-plan.md#imp-18) |
| IMP-19 | P1 | Operators can distinguish liveness from readiness and identify the deployed version. | [Operations and validation](2026-10-20-operations-validation-plan.md#imp-19) |
| IMP-20 | P1 | **Implemented for v0.30.5:** PR, release and exact-tag publication workflows type-check production and tests. | [Operations and validation](2026-10-20-operations-validation-plan.md#imp-20) |

IMP-15 and IMP-16 refine the existing Phase 3 status-indicator and onboarding
roadmap tasks; they are not additional copies of those tasks. The broader status
batching and onboarding coach-mark ideas remain separately scoped within those
existing entries.

## Suggested delivery order

1. **Close inexpensive security and validation gaps:** IMP-20, IMP-01, IMP-04
   and IMP-05. IMP-20 can ship independently; preserve the existing IMP-02 auth
   defaults and IMP-03 limiter while changing the login route. Do not wait for
   dashboard work to land these fixes.
2. **Harden authentication and request handling:** IMP-08, IMP-06 and IMP-07.
   Agree on the bounded JSON parser before migrating overlapping auth routes;
   give database migrations and existing-password compatibility their own review.
3. **Preserve and synchronize configuration:** IMP-10, followed by IMP-11. Build
   the shared dirty-draft contract with IMP-17 before enabling automatic browser
   refreshes. Keep authorization checks and stable-source publication intact.
4. **Improve dashboard feedback and efficiency:** IMP-13, IMP-14, IMP-15 and IMP-16.
   Widget caches must invalidate when the authoritative configuration revision
   changes, independently of whether an open browser has refreshed its layout.
   Integrate IMP-15 into the existing status upgrade work; batching service
   probes is a separate decision from sharing widget data requests. IMP-13
   controls browser work, while IMP-14 shares server work; both must preserve
   fresh-on-return behavior and the documented session-activity policy.
5. **Finish operational visibility and navigation protection:** IMP-19 and the
   remaining IMP-17 navigation cases. Readiness can ship independently of the UI
   work. Its configuration observations should reuse the same server state as
   IMP-11, without adding filesystem mutations to probes. Preserve IMP-18's
   existing traced packaging and production smoke test; coordinate future
   recovery tests with IMP-07's byte policy so the utility follows that contract.

These are suggested PR boundaries and dependencies, not authorization to start
implementation in this documentation task. No release/version bump, API contract
break, or unrelated widget migration is included.

## Compatibility decisions to retain

- Opaque login sessions remain SQLite-backed; the server secret is used by TOTP
  challenges and credential-reference primitives. Secret changes must not be
  described as replacing signed login-session tokens.
- Authentication defaults become protective when `auth.enabled` is omitted;
  explicit `false` and the operational environment override remain supported.
  Explain setup/login behavior for files that relied on implicit disablement.
- Preserve existing users' ability to log in with legacy bcrypt hashes. Enforce
  the UTF-8 byte bound when passwords are created or replaced, and document the
  residual legacy ambiguity until replacement; do not silently bind an arbitrary
  accepted suffix to a new hash.
- TOTP improvements preserve session-version invalidation and existing
  same-process concurrency protection while moving challenge state into SQLite.
- HTTP 401/403, redirects to login, and HEAD 405/501 can all come from a reachable
  service. A failed Kokpit authorization/configuration request is not evidence
  that the monitored service is offline.
- Keep `/api/health` as liveness. Add readiness separately and document which
  probe Docker and other consumers should use; do not change orchestration
  semantics merely by renaming a route.
- Automatic configuration updates must respect unsaved settings, layout, and
  form drafts. Security transitions take precedence over preserving a public
  dashboard view; drafts and configuration data must not survive logout in a
  public persistence mechanism.
- Browser polling remains session activity under the existing policy. Pausing
  hidden/offline consumers can allow idle expiry; resume through reauthorization
  rather than keeping sessions alive through a separate hidden heartbeat.

## Validation and evidence

For each implementation, first run the focused tests named in its subplan and
record the observed behavior, including negative and concurrency cases where
relevant. Avoid timing-threshold tests for bcrypt: validate the hash and the
full-cost comparison path deterministically.

After final implementation edits and immediately before committing, run the
repository's complete local gate from [AGENTS.md](../../AGENTS.md):

```sh
CI=true npm run lint
CI=true npm run type-check
CI=true npm run test:coverage
CI=true npm run test:e2e:nonvisual
CI=true npm run test:e2e:auth
```

Stop and fix failures before committing or pushing. After a PR is opened or
updated, inspect its actual check runs, including E2E, before marking the work
complete. Add targeted image checks when an implementation changes packaging or
runtime metadata; normal development-server tests do not establish standalone
or container behavior.

This planning change requires documentation checks: all 18 IDs appear in the
roadmap, each has exactly one implementation subplan, relative file/anchor links
resolve, existing completion state remains intact, and `git diff --check` passes.
The prior review's 164 passing focused tests describe that reviewed code; they
are not evidence that any planned fix has been implemented or tested.

## Findings outside this selection

Original items **9 and 12** remain outside the selected work. See the
[closer assessment](2026-10-20-deferred-findings-review.md) for their issue, fix,
tradeoffs, and corrected priority; it also records why items 2, 13 and 18 were
subsequently promoted into these plans. In particular, mandatory `If-Match` was
overstated as a missing safeguard: the supported UI already sends revisions and
the API's optional header is explicitly tested compatibility behavior.
