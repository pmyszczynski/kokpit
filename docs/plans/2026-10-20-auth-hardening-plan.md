# Authentication hardening implementation plan

Date: 2026-10-20. Status: **implemented — IMP-01 for v0.30.2, IMP-06 for v0.30.7 and IMP-07 for v0.30.8; IMP-02 and IMP-03 completed upstream in PR #132**.

This plan records selected review items IMP-01, IMP-02, IMP-03, IMP-06, and IMP-07, rechecked against main `71ef878` (v0.27.1). The IDs retain the numbering of the original 20-item review. See the [implementation index](2026-10-20-improvement-plan.md) for sequencing across plans and the full required pre-PR validation gate. Focused tests below supplement that gate.

<a id="imp-01"></a>

## IMP-01 — Make unknown-user password checks perform real bcrypt work

Status: **implemented for v0.30.2**.

The password module now owns a complete, precomputed cost-10 dummy hash beside
the password work-factor policy. Login uses it for unknown usernames and still
rejects every unknown user even if the dummy password matches. Deterministic
regressions verify a real successful bcrypt comparison, matching work factors,
the actual route's real verifier calls, identical credential failures, and no
session, cookie, or challenge response for the matching dummy password. Existing
rate limits and credential-generation race checks are preserved. The design and
acceptance criteria below record the original problem and implementation scope.

### Evidence and scope

Before this fix, [the login route](../../src/app/api/auth/login/route.ts) used a malformed 58-character dummy hash; a complete bcrypt hash has 60. [The password helper](../../src/auth/passwords.ts) passed it straight to `bcrypt.compare`.

A local reproduction against installed bcryptjs 3.0.3 returned `false` in approximately 0 ms for that string, versus approximately 52 ms for an ordinary valid cost-10 hash. These are illustrative local measurements, not performance guarantees. This confirms a username-enumeration timing signal; it does not itself reveal a password or grant a session. It matters most for internet-exposed deployments and is cheap to fix.

### Proposed design and compatibility

Keep one precomputed, valid dummy bcrypt hash at the same cost as real passwords. Put the work-factor constant and dummy hash together in the password module so login cannot accidentally diverge from the hashing policy. The dummy secret is not a credential and need not be private. Preserve the existing `!user` failure condition even if a submitted password happens to match the dummy hash.

Use the same credential error and status for unknown users and wrong passwords. This closes the obvious skipped-work difference; do not promise perfectly constant HTTP response times, since database access, scheduling, and other request paths still vary. Coordinate with IMP-03 so rate-limit decisions do not disclose whether a username exists.

### Ordered implementation tasks

1. Generate and independently check a valid cost-10 hash for a dummy password; move it and the configured bcrypt rounds into the password module.
2. Update login to use that shared dummy hash while preserving its post-bcrypt user/session-generation recheck.
3. Add a stable regression asserting a complete parseable hash, the expected cost, and the expensive verification path for both unknown users and wrong passwords.
4. Run an optional local repeated timing comparison as supporting evidence; keep wall-clock thresholds out of CI.

### Focused tests and acceptance criteria

- The actual dummy hash has a valid bcrypt representation and the same work factor as newly generated password hashes.
- Unknown-user requests call the real password verifier with that valid hash and return the same credential response as wrong-password requests.
- Supplying the dummy password for an unknown username still produces no challenge, cookie, or database session.
- Existing password-reset-during-login and TOTP branch race tests remain green.
- Acceptance: the unknown-user path no longer exits through bcrypt's malformed-hash shortcut, with unchanged valid-user login behavior.

<a id="imp-02"></a>

## IMP-02 — Enable authentication consistently when its flag is omitted

Status: **completed upstream** in [PR #132](https://github.com/pmyszczynski/kokpit/pull/132), commit `1097384`; included in the inspected v0.27.1 main branch. No further implementation is scheduled for this item.

### Original issue and implemented behavior

Before PR #132, the outer `auth` default enabled authentication while the nested `enabled` default was false. Consequently, omitting `auth` enabled protection, whereas `auth: {}` or `auth: { session_idle_timeout_hours: 24 }` disabled it. Adding a timeout could therefore unintentionally expose a previously protected instance. This was a real issue in the earlier revision, but it is already fixed in current main.

[The current schema](../../src/config/schema.ts#L179) now sets both defaults to true. It preserves explicit `enabled: false` and the exact existing `KOKPIT_AUTH_DISABLED=true` override in [the access policy](../../src/auth/apiAuth.ts#L6). Timeout semantics and existing account/session storage are unchanged. [The README](../../README.md) explicitly says that incomplete auth sections require authentication and public access requires an explicit disable choice.

### Compatibility and setup record

Upgrading an instance with an empty or timeout-only auth section now enables protection. An intentionally public instance needs explicit `auth.enabled: false` or its intentional environment override. There is no migration that writes an omitted flag as false to preserve accidental exposure. The existing protected layout directs a no-account installation to setup and an installation with an existing account but no valid session to login; existing valid sessions continue to work. No account is created automatically.

### Validation record and acceptance

- Reviewed the current schema, access policy, protected layout, README, and PR #132 regression tests after refreshing main.
- [Schema regression coverage](../../src/__tests__/config/schema.test.ts#L10) includes missing auth, an empty section, idle-timeout-only and legacy-TTL-only sections, plus explicit false.
- [API policy tests](../../src/__tests__/auth/apiAuth.test.ts) cover enabled/disabled config, unauthenticated/authenticated access, and the environment override. Existing loader tests retain explicit opt-out and defaulted authentication coverage.
- Acceptance is implemented: an omitted authentication flag consistently enables protection while explicit public-access choices remain supported. Preserve these regressions when implementing the remaining plans.
- This is a source and coverage verification record; current full-gate results belong in the central implementation index/handoff.

<a id="imp-03"></a>

## IMP-03 — Bound password-guessing attempts and bcrypt load

Status: **completed upstream** in [PR #132](https://github.com/pmyszczynski/kokpit/pull/132), commit `1097384`; included in the inspected v0.27.1 main branch. Do not duplicate or rewrite the existing limiter to complete this review item.

### Original issue and implemented behavior

The earlier login route performed bcrypt work without throttling. [The current login route](../../src/app/api/auth/login/route.ts) now reserves an attempt before bcrypt through [the SQLite limiter](../../src/auth/loginRateLimit.ts). Reservations use an immediate transaction, so concurrent processes sharing the same database reserve against the same state. The additive tables and expiry/time indexes live in [database initialization](../../src/auth/db.ts).

The implemented policy is:

- Up to **10 failed or pending password attempts per attempted account in a fixed 15-minute window**. Password keys are `account:` plus SHA-256 of `username.toLowerCase()`. Thus case variants intentionally share a limiter budget even though actual username lookup remains case-sensitive; no lookup normalization was introduced.
- A separate **10 failed or pending TOTP attempts per user in a fixed 15-minute window**, keyed by a digest of the user ID. Fresh challenges share that same user's TOTP budget.
- One shared **rolling 100-check budget in any 60 seconds** across password and eligible TOTP checks, including successes and unknown password usernames. This is a rolling window, not a fixed minute bucket, so a boundary does not allow a second full burst.
- A successful credential step releases only its own account reservation, conditional on its original expiry/window; it does not erase earlier failures, concurrent requests, or global request history. Issuing a TOTP challenge releases the successful password-step reservation; successful TOTP verification releases its own TOTP reservation.
- Blocked requests receive HTTP 429 and `Retry-After`. Denials do not extend the fixed account window. Expired state is pruned on admission, and global denial inserts no new account counter or request row, bounding live storage by admitted traffic and expiry.

The implementation does not use caller-controlled `X-Forwarded-For`, `X-Real-IP`, or other headers as trusted client identities. It persists budgets across restarts and shares them across processes using the same SQLite file. The [README login-session section](../../README.md#login-sessions) documents the policy. There is no new dependency on an ingress proxy or cloud service.

### Compatibility and tradeoffs

This temporarily slows guessing and bounds admitted password work; it is not a defense against upstream bandwidth exhaustion. The account limit can temporarily deny login to a known account under deliberate guessing, and the global budget can affect all users. Neither permanently disables an account. Successful checks preserve normal repeat-login usability without resetting prior failures. Existing host recovery remains available.

No additional limiter implementation is scheduled. Any later performance tuning needs measurements and separate scope rather than being presented as unfinished rate-limiting work.

### Validation record and acceptance

- Reviewed the current limiter, database tables, login/TOTP callers, README policy, and PR #132 regression coverage after refreshing main.
- [Limiter tests](../../src/__tests__/auth/loginRateLimit.test.ts) cover case-sharing, independent accounts, fixed-window expiry without extension, global username-rotation blocking and bounded insertion, rolling-minute boundaries, success release preserving failures/global history, stale-success safety, pruning, digested keys, and persistence across database reopen.
- [Login route tests](../../src/__tests__/auth/login-route.test.ts) cover reserving concurrent attempts before bcrypt, rotating usernames/forwarding headers without bypass, retry metadata, and repeat successful logins.
- [TOTP route tests](../../src/__tests__/auth/totp-verify-route.test.ts) cover shared failure allowance across fresh challenges and successful checks releasing their own reservations. This durable account budget must remain when IMP-06 adds durable per-challenge state.
- Acceptance is implemented: documented database-backed account/global budgets apply before expensive checks, survive reopen, and ignore spoofable IP identity. Retain these regressions; no new implementation is planned for IMP-03.
- This section records inspected implementation and existing coverage; current full-gate results belong in the central implementation index/handoff.

<a id="imp-06"></a>

## IMP-06 — Persist distinct, single-use TOTP challenges and their attempt budget

Status: **implemented for v0.30.7**.

TOTP password logins now issue distinct random challenge identifiers and register their fixed five-minute expiry only after asynchronous signing and a current credential-generation check. SQLite retains attempts and terminal state across restart and cooperating processes, with five attempts per challenge, bounded active/global capacity and expiry cleanup. Existing account/global admission behavior remains in place.

Verification performs the challenge claim, current-secret code check, limiter updates and opaque-session insertion in one synchronous IMMEDIATE transaction. Insertion failure rolls back; cookie failure revokes the committed session and leaves the challenge consumed. Legacy in-progress challenge tokens require a fresh login after upgrade; existing opaque sessions remain valid. Reopen, independent-connection and real two-process regressions cover replay, competing success/fifth-failure outcomes, generation races, capacity and rollback/cookie failures. Integrated validation is recorded separately.


### Original evidence and scope

The pre-v0.30.7 issue descriptions below are historical evidence. The following design, task list and acceptance criteria preserve the accepted implementation plan; the implementation record above describes the delivered behavior.

Before v0.30.7, [JWT issuance](../../src/auth/jwt.ts) included user ID, session version, type, issued-at and five-minute expiry without a random challenge ID. Two challenges issued for the same user/version in the same second were identical; a local `jose` reproduction confirmed that deterministic result.

The previous [verification route](../../src/app/api/auth/totp/verify/route.ts) retained its five-attempt and single-use state in module-level maps. Restart or another process could therefore reset per-challenge state while the persisted signing secret left the token cryptographically valid. PR #132 already provided durable account/global admission budgets, so this was not unlimited TOTP guessing. Existing generation checks and same-process replay protection were retained by the durable transaction implementation.

The [database](../../src/auth/db.ts) now also stores the challenge identifier, credential generation, fixed timestamps, attempts and terminal state. The following design and acceptance criteria record the implemented contract; full integrated validation is recorded separately.

### Design and compatibility

Keep the short-lived JWT shape for client compatibility, adding a cryptographically random `jti`. Store a corresponding SQLite challenge row keyed by that identifier, with user ID, expected session version, fixed creation/expiry times, attempts used, and terminal state. Do not persist the bearer JWT or TOTP code. Cryptographic verification must require the expected algorithm, type, integer expiry/generation and a valid identifier, then require its matching live row. Never create state merely because a submitted token has a valid signature.

Persist issuance only after confirming the current user/version. Signature generation is asynchronous: recheck generation when inserting the challenge row after signing, and return no token if that conditional insert fails. Use the same fixed expiry for JWT and row, rather than extending it after failures. Generate distinct identifiers for every password login, including calls within the same second. Bound outstanding challenges per user and total live rows, prune expiry-indexed rows, and retain the existing IMP-03 account/global admission and success-release behavior. At the bound, return a temporary refusal without silently evicting active challenges.

For verification, await the cookie store and JWT signature checks before entering a short synchronous SQLite transaction. Within that transaction, re-read the live challenge/account generation, reserve the existing account/global TOTP budget, verify the code against the current secret, atomically record the failed attempt or consume the challenge, and on success insert exactly one opaque session using the expected generation. Adapt the current limiter store API to participate safely in that transaction rather than replacing or double-charging its counters; a successful check releases only its own account reservation and retains global request history. No await belongs inside this transaction. Both a failed attempt and a successful claim must be guarded by the remaining-attempt/active-state predicate; a success racing the fifth failure must have one serializable outcome, never a session after terminal lockout. Refactor existing session creation helpers to support this transaction cleanly while preserving generation checks.

Only write the browser cookie after committing. If cookie writing fails, revoke the new session; leave the challenge consumed so it cannot be replayed, and let the user restart login. If session insertion fails inside the transaction, roll back the transaction and return a controlled retry/failure rather than recording a success with no session. Define and test this behavior explicitly.

An upgrade rejects legacy tokens without `jti` and a persisted row. Users in the middle of the five-minute TOTP step must start login again; existing opaque sessions remain valid. Multiple processes are supported only when they share the same SQLite file on a supported local filesystem and the same signing secret, consistent with existing session storage. This is not a plan to support independently replicated databases.

Do not confuse challenge replay with reuse of a time-step code across *distinct* password-authenticated challenges. Rejecting a previously accepted TOTP time step globally would be a separate behavior change requiring otplib counter/window information and usability review. This plan guarantees single use per challenge and durable per-challenge attempts.

### Ordered implementation tasks

1. Add a challenge-table migration, expiry index, caps, startup cleanup, and transaction-oriented store APIs. Account/session generation remains authoritative even when old rows have not been pruned.
2. Add random `jti`, fixed expiry and row registration to issuance, including the post-signing generation recheck; reject legacy unregistered challenges deliberately.
3. Refactor verification/session creation around one SQLite claim-and-create transaction; eliminate process-local challenge maps while preserving existing durable account/global TOTP budgets and conditional success release.
4. Add bounded cleanup and invalidation/cleanup hooks for account credential changes where useful; correctness must come from generation comparison, not eventual cleanup.
5. Return clear restart-login behavior for expired/used/exhausted challenges, without exposing codes or tokens in logs.
6. Document the one-time upgrade interruption and shared-database deployment scope.

### Focused tests and acceptance criteria

- Frozen-clock issuance produces distinct tokens/identifiers for the same user and version within one second.
- A token without a registered row, without `jti`, with wrong type/algorithm, with mismatched expiry/user/generation, or at/after expiry is rejected.
- Four wrong codes followed by database reopen still leave only one attempt; the fifth failure terminally exhausts the challenge across another process. Fresh challenges and restart must also continue to respect the already implemented ten-failure per-user TOTP budget and shared rolling global budget.
- A consumed challenge stays consumed after restart and from another connection; two processes submitting it concurrently produce exactly one database session.
- Concurrent valid submission versus fifth failure has a serializable result with no session issued after committed exhaustion; attempts never exceed the cap.
- Password/TOTP changes during signature verification or before insertion cannot issue a current session using stale proof.
- Cookie-write failure revokes the inserted session and leaves the challenge consumed; transaction/session-insert failure follows the documented rollback policy.
- Caps/cleanup remain bounded under repeated successful password logins and leave unrelated live challenges intact.
- Acceptance: each issued challenge has unique identity, fixed expiry, durable attempts, and at most one successful atomic session claim across supported processes/restarts.

<a id="imp-07"></a>

## IMP-07 — Stop silently truncating newly chosen bcrypt passwords

Status: **implemented for v0.30.8**.

New or replacement passwords now reject values exceeding exactly 72 UTF-8 bytes before bcrypt work, without normalization or truncation. The shared hash helper, setup/recovery APIs, browser feedback and emergency CLI use that boundary while retaining the existing minimum. Legacy login and current-password confirmation continue to accept their previous bcrypt semantics within the separate auth transport limit; rejected replacements do not consume recovery proof or revoke credentials.

A successful overlong legacy candidate produces authenticated replacement guidance. Its boolean hint stays in durable server-side challenge/session metadata, transfers atomically after TOTP and never appears in readable pre-authentication JWT claims. Additive database initialization now runs under one IMMEDIATE transaction, publishes only a fully initialized handle and closes failed provisional handles. Regression coverage includes Unicode boundaries, CLI reprompting, MFA disclosure, preserved opaque sessions, two-process schema startup and failed-initialization retry. Integrated validation is recorded separately.

### Original evidence and scope

The pre-v0.30.8 issue descriptions below are historical evidence. The following design, task list and acceptance criteria preserve the accepted implementation plan; the implementation record above describes the delivered behavior.

Before v0.30.8, [password hashing](../../src/auth/passwords.ts) used bcrypt without length validation. [Setup](../../src/app/api/setup/route.ts), [recovery reset](../../src/app/api/auth/reset-password/route.ts), and [the emergency script](../../scripts/reset-password.js) enforced a minimum using JavaScript string length but no bcrypt byte ceiling. Each password-setting path now enforces the UTF-8 byte ceiling before hashing or credential mutation.

Installed bcryptjs accepted two different passwords with the same first 72 UTF-8 bytes. The same occurred with an 18-emoji prefix: 36 JavaScript code units already occupied 72 UTF-8 bytes. This confirmed a defect in the previous password-setting contract: the relevant boundary is bytes, not characters. Legacy verification retains that ambiguity until explicit password replacement; ordinary shorter passwords remain compatible.

### Accepted design and compatibility

Enforce a maximum of 72 UTF-8 bytes whenever a password is **created or replaced**. Measure the exact bytes hashed with `Buffer.byteLength(password, "utf8")` on the server; apply equivalent `TextEncoder` feedback in browser forms. Do not normalize or truncate passwords. Keep the existing minimum policy unchanged. Apply the maximum in the shared hashing policy as well as route validation, and match it in the standalone CommonJS emergency script. The following design and acceptance criteria record the implemented contract; full integrated validation is recorded separately.

Preserve legacy password verification for login and session password confirmation. A bcrypt hash does not reveal the original password length, so imposing the same maximum on all login requests would lock out existing users who supplied longer passwords during setup. On successful legacy login with a candidate exceeding 72 UTF-8 bytes, show a recommendation to replace the password via the existing recovery reset or emergency host reset flow. Complete TOTP before showing authenticated account guidance; do not add account-existence signals to a failed login. Do not auto-change the stored hash or silently bind the full submitted candidate: an arbitrary suffix may have been accepted under the old truncation semantics.

The unavoidable qualification is that existing long-password hash ambiguity survives until those users replace their passwords. Document that explicitly in upgrade notes. A future versioned full-input scheme such as scrypt/Argon2 could support long passphrases, but requires separate cost/format/runtime and migration work. It cannot recover the unknown suffix of a legacy bcrypt password. Do not introduce an ad-hoc prehash into unversioned bcrypt records or rehash ambiguous legacy credentials silently.

Coordinate generic request/password field safety caps with IMP-08: a generous transport cap for legacy verification must be distinct from the 72-byte **new password** rule. Document any exceptional preexisting passwords over that transport cap and provide host reset recovery rather than pretending to preserve arbitrarily large inputs.

### Ordered implementation tasks

1. Define one explicit byte-based policy for new passwords and an identifiable validation error. Enforce it in the shared hash helper before bcrypt work.
2. Update setup and recovery-reset server validation and browser feedback, avoiding HTML `maxLength=72` because it counts code units rather than UTF-8 bytes.
3. Mirror the rule in the emergency reset script's prompt/validation and ensure rejected input does not write credentials or revoke sessions.
4. Keep login/reauthentication legacy comparison behavior; add authenticated long-password upgrade guidance and README upgrade notes explaining residual ambiguity and existing reset options.
5. Check all password-setting callers and tests so no alternate path can persist a newly overlong bcrypt credential.

### Focused tests and acceptance criteria

- New ASCII passwords at 71/72 bytes are accepted and at 73 bytes are rejected; multi-byte strings cover exactly 72 bytes and a multi-byte character crossing the boundary.
- Emoji/supplementary characters and combining characters use actual UTF-8 byte length, with no normalization or silent truncation.
- Overlong setup/reset inputs never hash, mutate users, consume a recovery code, or revoke sessions. The emergency script reprompts safely and still supports cancellation/error cleanup.
- Existing overlong bcrypt credentials continue to work for login and required password confirmation; a differing legacy suffix reproduces the documented legacy limitation until explicit replacement.
- Explicit replacement with an allowed password revokes old sessions/challenges through the existing generation mechanisms and no longer accepts the previous long credential.
- Browser feedback matches server byte rules, and generic wrong-login responses do not gain account-identifying length behavior.
- Acceptance: every new/replaced bcrypt password has an enforced 72-byte ceiling with clear feedback, while existing long-password users retain a documented recovery-compatible upgrade path. Historical hash ambiguity is acknowledged rather than misreported as fixed automatically.
