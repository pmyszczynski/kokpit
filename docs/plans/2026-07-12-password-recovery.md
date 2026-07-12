# Password Recovery (No Email) Implementation Plan

**Goal:** Let a locked-out user reset their password without Kokpit ever storing an email address or phone number, consistent with its single-admin, self-hosted design.

**Architecture:** A one-time, high-entropy recovery code is generated during first-run setup (and re-generatable from Settings) and shown to the user exactly once. Only its SHA-256 hash is stored, in a new `recovery_code_hash` column on `users`. Redeeming the code via `/api/auth/reset-password` resets the password only — it never touches `totp_secret`, so a leaked recovery code cannot bypass 2FA. For total lockout (password + recovery code + TOTP device all lost), `scripts/reset-password.js` gives the operator a host/container-level fallback, mirroring the trust boundary already required to read `data/users.db` or `.session_secret`.

**Tech stack:** Same as the rest of `src/auth/` — `better-sqlite3`, `bcryptjs`, Node's `crypto` (SHA-256 + `timingSafeEqual` for the recovery code, since it's already high-entropy and doesn't need bcrypt's slow hash).

---

## Design notes

- **Recovery code format:** 128 bits of randomness (`crypto.randomBytes(16)`), rendered as `xxxxxxxx-xxxxxxxx-xxxxxxxx-xxxxxxxx` (hex, grouped for readability). Case-insensitive, whitespace-tolerant comparison.
- **Single-use:** `recovery_code_hash` is cleared the moment a reset succeeds. The user must generate a new one afterward.
- **Scope-limited:** resetting via recovery code updates `password_hash` only. `totp_secret` is left untouched — if 2FA is enabled, the next login still requires it. This is a deliberate security boundary, not an oversight.
- **Enumeration/timing resistance:** `/api/auth/reset-password` always runs `verifyRecoveryCode` against a dummy SHA-256 hash when the username is unknown, mirroring the `DUMMY_HASH` pattern in `/api/auth/login`. All failure paths return the same generic `401 { error: "Invalid username or recovery code" }`.
- **Rate limiting:** an in-memory attempt counter per username (10 attempts / hour), following the same pattern as `MAX_TOTP_ATTEMPTS` in `/api/auth/totp/verify`. Defense-in-depth only — the code's entropy already makes brute force infeasible.
- **Regeneration requires re-auth:** `/api/auth/recovery-code` (authenticated) requires the current password before issuing a new code, the same way disabling TOTP requires a live code. Prevents a hijacked/idle session from silently minting a new recovery code.
- **Migration:** existing installs get `recovery_code_hash` added via `ALTER TABLE` guarded by a `PRAGMA table_info` check in `getDb()`, so upgrading doesn't require manual intervention.

## Task 1: Schema + recovery helpers

**Files:**
- Modify: `src/auth/db.ts` — add `recovery_code_hash TEXT` column + migration.
- Add: `src/auth/recovery.ts` — `generateRecoveryCode()`, `hashRecoveryCode()`, `verifyRecoveryCode()`.
- Modify: `src/auth/users.ts` — add `recoveryCodeHash` to `User`/`UserRow`, add `setRecoveryCodeHash`, `clearRecoveryCodeHash`, `updatePasswordHash`.
- Modify: `src/auth/index.ts` — export the above.

**Tests:** `src/__tests__/auth/recovery.test.ts`, additions to `src/__tests__/auth/db.test.ts` and `src/__tests__/auth/users.test.ts`.

## Task 2: Issue the code at setup

**Files:**
- Modify: `src/app/api/setup/route.ts` — generate + store + return the code once on `POST`.
- Modify: `src/app/setup/SetupForm.tsx` — add a "save your recovery code" screen (reveal + confirm checkbox) before continuing to `/login`.

**Tests:** additions to `src/__tests__/auth/setup-route.test.ts`, `src/__tests__/components/SetupForm.test.tsx`.

## Task 3: Reset flow

**Files:**
- Add: `src/app/api/auth/reset-password/route.ts`.
- Add: `src/app/reset-password/page.tsx`, `src/app/reset-password/ResetPasswordForm.tsx`.
- Modify: `src/app/login/LoginForm.tsx` — add a "Forgot password?" link.

**Tests:** `src/__tests__/auth/reset-password-route.test.ts`, `src/__tests__/components/ResetPasswordForm.test.tsx`, additions to `src/__tests__/components/LoginForm.test.tsx`.

## Task 4: Regenerate from Settings

**Files:**
- Add: `src/app/api/auth/recovery-code/route.ts` (authenticated, requires current password).
- Modify: `src/components/SettingsPanel.tsx` — "Password Recovery" subsection under Authentication, mirroring the TOTP reveal pattern.

**Tests:** `src/__tests__/auth/recovery-code-route.test.ts`, additions to `src/__tests__/components/SettingsPanel.test.tsx`.

## Task 5: CLI fallback for total lockout

**Files:**
- Add: `scripts/reset-password.js` — interactive prompt (masked password input), optional TOTP/recovery-code clearing, direct SQLite access via `KOKPIT_DB_PATH`.
- Modify: `package.json` — add `"reset-password": "node scripts/reset-password.js"`.

Manual verification: `npm run reset-password` against a dev DB.

## Task 6: Docs

**Files:**
- Modify: `README.md` — new `## Account Recovery` section.
- Add: this file (`docs/plans/2026-07-12-password-recovery.md`).
