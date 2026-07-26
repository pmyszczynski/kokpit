# Widget Secret Preservation Security Implementation Plan

**Goal:** Replace reusable unsigned widget-secret coordinates with signed,
destination-bound preservation that protects all credentialed widgets, and
preserve Tautulli cancellation throughout response-body parsing.

**Architecture:** A server-only HMAC reference authenticates the saved secret's
source locator. Explicit widget registry metadata defines the non-secret fields
that scope a credential. Both settings persistence and connection testing
resolve a saved value only after comparing normalized scope from the current
saved config with the submitted destination config. The editor uses the same
client-safe normalization for immediate re-entry feedback, but the server is
authoritative.

**Tech stack:** Next.js 15 App Router, React 19, TypeScript, Node crypto, Zod 4,
Vitest, Testing Library.

## Global Constraints

- Follow TDD: add and run failing focused tests before production changes.
- Never return, render, log, encode, hash into a browser token, or include a
  widget secret in an error.
- Signing must use a purpose-derived key while preserving the existing JWT key.
- A signature never substitutes for saved-versus-submitted scope comparison.
- Resolution failures must happen before schema validation triggers a fetch.
- The design applies to every registry-declared password field.
- YAML remains the source of truth and stores literal secrets, never references.
- Optimistic revision conflict checking remains ahead of secret resolution.
- No destructive history rewrite; replace the flawed implementation with
  follow-up commits on `codex/tautulli-activity-widget`.

## Task 1: Server secret extraction and signed reference primitive

**Files:**

- Create `src/auth/serverSecret.ts`
- Modify `src/auth/jwt.ts`
- Modify `src/widgets/secretReference.ts`
- Create `src/widgets/secretReference.server.ts`
- Create `src/__tests__/widgets/secretReference.test.ts`
- Modify `src/__tests__/auth/jwt.test.ts`

- [ ] Add failing tests for valid signing/verification, no secret material,
      purpose separation, malformed tokens, size/version/shape errors, payload
      tampering, signature tampering, and persisted-key behavior.
- [ ] Move the existing server-secret loading code without changing its
      environment variable, file path, persistence, permissions, or bytes.
- [ ] Keep the browser module crypto-free and implement strict server-only
      HMAC signing/verification with a derived key and timing-safe comparison.
- [ ] Run focused reference and JWT tests.

## Task 2: Explicit scope metadata and normalization

**Files:**

- Modify `src/widgets/index.ts`
- Create `src/widgets/credentialScope.ts`
- Modify every integration registration containing a password config field
- Add or extend `src/__tests__/widgets/configSecrets.test.ts`

- [ ] Add failing tests proving every password widget declares a valid,
      nonempty credential scope and invalid definitions fail registration.
- [ ] Add client-safe canonical scope calculation for HTTP(S) URL fields and
      exact text fields.
- [ ] Declare `["url"]` for all credentialed widgets and
      `["url", "username"]` for both qBittorrent widgets.
- [ ] Run registry and scope tests.

## Task 3: Destination-bound server resolution

**Files:**

- Modify `src/widgets/configSecrets.ts`
- Modify `src/app/api/settings/route.ts`
- Modify `src/app/api/widget/test/route.ts`
- Modify `src/__tests__/api/settings.test.ts`
- Modify `src/__tests__/api/widget-test.test.ts`
- Add or extend a protected settings page test

- [ ] Add failing tests for GET/PATCH/RSC redaction, unchanged preservation,
      rename/reorder, display-only edits, canonical-equivalent URLs, endpoint
      changes, qBittorrent username changes, literal replacement, forged and
      tampered tokens, wrong source/type/field, different-scope copy, stable
      error codes, no writes, and no outbound fetches.
- [ ] Sign all browser references using current saved config.
- [ ] Verify the locator and compare server-derived source/destination scope
      before returning a saved value.
- [ ] Preserve revision-check ordering and return bounded coded 400 errors.
- [ ] Run focused config-secret and API route tests.

## Task 4: Editor re-entry behavior

**Files:**

- Modify `src/components/ServiceForm.tsx`
- Modify `src/__tests__/components/ServiceForm.test.tsx`
- Modify `src/components/SettingsPanel.tsx` only if needed to surface the safe
  server error without optimistic success

- [ ] Add failing tests for blank saved-secret inputs, scope-change re-entry,
      disabled testing, required replacement, canonical revert, qBittorrent
      username binding, and unrelated-edit preservation.
- [ ] Compare original/current normalized scope without parsing signed tokens.
- [ ] Make a stale saved reference fail client validation and require a literal
      credential while retaining it for canonical revert.
- [ ] Ensure raw secrets and signed references are not rendered as input values.
- [ ] Run focused component tests.

## Task 5: Tautulli response-body abort preservation

**Files:**

- Modify `src/integrations/tautulli/api.ts`
- Modify `src/__tests__/integrations/tautulli.test.ts`
- Modify `src/__tests__/api/widget-test.test.ts` if needed for timeout lifecycle

- [ ] Add a failing regression where `fetch` resolves but `response.json()`
      rejects after cancellation.
- [ ] Preserve a sanitized `AbortError` through both transport and body-read
      catch paths without rethrowing upstream text.
- [ ] Confirm the hard timeout still returns 504 and leaks no URL or API key.
- [ ] Run focused Tautulli and widget-test suites.

## Task 6: Review and verification

- [ ] Run an independent security review focused on reference forgery/replay,
      scope confusion, client/server boundary, and abort lifecycle.
- [ ] Apply at most one bounded fix wave for review findings, then re-review.
- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run type-check`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check` and confirm the worktree contains only intended
      changes.
- [ ] Commit the verified security correction.

## Task 7: Visual verification

- [ ] Start Kokpit with temporary mock Tautulli data.
- [ ] Verify the approved one-column-by-two-row default tile at desktop and the
      mobile full-width behavior.
- [ ] Capture a fresh screenshot of the final implementation.
- [ ] Stop temporary services and remove temporary config.

