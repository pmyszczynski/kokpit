# Configuration preservation and browser synchronization

Date: 2026-10-20. Status: **IMP-10 implemented for v0.30.9; IMP-11 remains planned**.

Selected improvements: **IMP-10** and **IMP-11** from the [improvement delivery plan](2026-10-20-improvement-plan.md). That plan owns sequencing and the required validation gate; this document supplies implementation details. The existing [architecture](../ARCHITECTURE.md#configuration-and-persistence) and [AGENTS.md](../../AGENTS.md) remain applicable.

<a id="imp-10"></a>

## IMP-10 — Preserve nested YAML comments during UI saves

Status: **implemented for v0.30.9**.

UI saves now reconcile YAML document nodes recursively instead of replacing submitted top-level sections. Surviving nested fields retain their comments and supported styles; services and tiles retain ownership by UUID, named groups by unambiguous normalized name, and bookmark links by exact or unambiguous one-field identity. Removed values lose their annotations, while unrelated sections remain intact; ambiguous changed arrays do not inherit another item's comments.

Referenced aliases or graph edits that cannot preserve safe ownership fail with a controlled 400 `unsupported_yaml_update` before persistence, with guidance to edit YAML directly or expand aliases. The exact serialized result is reparsed and schema-validated within the existing locked atomic-write path. Repeated-save, reorder, rename, nested edit, deletion, scalar-style, alias and real loader/API regressions cover preservation and unchanged bytes on rejection. Integrated validation is recorded separately.

### Evidence and qualification

The pre-v0.30.9 issue descriptions below are historical evidence. The following design, task list and acceptance criteria preserve the accepted implementation plan; the implementation record above describes the delivered behavior.

Before IMP-10, [writeConfigSnapshot](../../src/config/loader.ts) parsed a YAML document, then applied each submitted top-level section with `doc.setIn([key], value)`. Replacing the section creates new descendant nodes. A local reproduction using the installed `yaml` package retained a document-level comment but lost both a leading comment on `appearance.theme` and its inline comment when replacing `appearance`.

The issue is confirmed, but it is narrower than “all comments are lost”: untouched section nodes remain in the document, and [migration helpers](../../src/config/loader.ts) already preserve selected comments when restructuring legacy services. The original [loader tests](../../src/__tests__/config/loader.test.ts) covered migration comment preservation, not normal UI updates of nested fields. The fix should reuse that knowledge without treating a migration-specific copy routine as a complete sequence reconciler.

The goal is preservation of comments attached to surviving logical fields and items. It is **not byte-perfect formatting preservation**: YAML serialization can normalize indentation, quoting, and whitespace. Comments attached solely to deleted data should be deleted with that data, rather than silently moved onto an unrelated service or field.

### Scoped design

- Add a small document reconciliation helper used by `writeConfigSnapshot` after validation and secret-reference resolution. Keep the existing lock, source comparison, atomic install, permissions, and cache publication path.
- Reconcile mappings by key. Keep existing key/value nodes when values are unchanged, change scalar values in place when possible, and recursively update changed maps. Keep leading/inline comments attached to surviving keys and values. New keys get new nodes; explicitly removed owned keys and their attached comments are removed.
- Preserve existing ordering of surviving mapping keys; append new keys deterministically. Submitted sequence order remains authoritative because it controls dashboard ordering.
- Reconcile `services[]` and `service_tiles[]` by their schema-validated UUID `id`, **never by array index, name, or `service_id`**. Move existing item nodes into submitted order, recursively update their contents, create new IDs, and remove missing IDs. Two tiles referencing one service remain independent comment owners. Service renames retain comments because the ID remains stable.
- Treat `groups[]` and bookmark groups as name-keyed sequences; their case-insensitive uniqueness is already schema-validated. Preserve nodes across reorder and changes to fields while the name remains the same. These records currently have no stable ID. A changed name that cannot be matched unambiguously is a removal plus addition; do not attach another group's comments based on its old position. Document that limitation rather than introducing an unrelated persisted-ID migration.
- For bookmark links, match unchanged uniquely identifiable links using their name and URL within the same bookmark group. Preserve comment ownership when an unambiguous field edit can be identified; ambiguous duplicate links or simultaneous name/URL replacement use remove/add semantics. Do not guess between duplicate links. Cover this policy in tests and user documentation.
- Reconcile nested integration/widget configuration maps by key. For arrays of primitive options, retain nodes only where value-based matching is unambiguous; for arbitrary arrays without identity, treat changed content as replacement while preserving comments attached to the owning field. Do not claim service-ID guarantees for arbitrary plugin data.
- Preserve untouched top-level extension keys and untouched sections. Within replaced schema-owned sections, preserve the API's existing replacement semantics: omitted optional values are deleted, not silently restored from old YAML. Preserve intentional fixed-grid normalization (`layout` geometry removal and tile footprint migration).
- Keep document/sequence-level comments on their containing node, including when a sequence becomes empty. Do not transfer deleted field/item comments elsewhere; this also avoids retaining credential annotations after an integration is removed.
- Handle YAML aliases/anchors deliberately. Detect updates that would mutate shared anchored data or leave dangling aliases; reject an unsupported case before writing with an actionable error and leave the source intact. Ordinary unshared nodes must work. Add support for more complex graph edits only with explicit semantic tests; never silently change another section through a shared alias.
- After reconciliation, parse and validate the **exact resulting document**. Compare its semantic result with the intended validated update, including explicit removals; reject accidental changes to untouched data before persistence. Preserve the existing secret-reference boundary: neither AST metadata nor comments are included in client settings responses.

### Ordered implementation tasks

1. Add regression fixtures for a normal UI-style section replacement containing nested comments. Include service/tile reorder with distinct per-ID comments and a rename with a stable ID.
2. Extract a tested AST reconciliation helper; define map ownership, sequence matching, deletion, scalar/type replacement, and alias failure behavior in its interface.
3. Apply it to appearance/auth/layout mappings, then service/catalog and tile sequences, then groups/bookmarks and nested integration/widget configuration. Do not replace the migration path wholesale.
4. Preserve existing validated replacement semantics and normalization. Confirm intentionally omitted fields disappear and untouched extension data remains unchanged.
5. Integrate with `writeConfigSnapshot`; keep source-based conflict detection and atomic writes unchanged. Propagate a safe unsupported-YAML error through the settings API without exposing document contents.
6. Add a short documented preservation contract and limitations, then complete focused verification and the central delivery gate before any implementation commit/PR.

### Tests and acceptance criteria

- Update one nested field: leading/inline comments on it and surviving sibling fields remain; top-level comments remain.
- Reorder services/tiles, rename a service, change footprints, and update widget options: each surviving ID retains its own comments; tiles sharing a service do not exchange comments.
- Add/remove a service, tile, optional field, integration, bookmark link, and entire group: intended values are added/deleted and deleted-node comments follow the stated policy.
- Reorder named groups/bookmark groups and unique bookmark links: their comments move with their logical owner. Ambiguous links and name-only identity changes follow the documented limitation.
- Test empty sections, nested arrays, multiline scalars, scalar-to-map replacements, quoted keys, untouched top-level extension keys, and anchors/aliases. Unsupported shared-reference updates fail before disk mutation.
- Settings route tests verify client-safe secret references resolve as before, server-owned secrets persist, and neither comments nor raw secrets leak into responses.
- Existing stale-revision/source-race, file-mode, atomic-install, migration, schema, and loader tests remain green. A concurrent external comment-only edit must still conflict rather than be overwritten.
- Acceptance: submitted values and sequence ordering are correct, comments on supported surviving owners remain, removed data does not reappear, and the exact serialized result validates. No promise of identical whitespace or quote style.

### Dependencies, value, and risks

This directly supports the project's YAML/UI synchronization promise and makes the visual editor safe to use with a hand-maintained, annotated config. No new package is needed. Implement before IMP-11's integrated external-edit demonstrations where practical; the browser synchronization feature does not depend on changing YAML serialization.

Main risks are attaching comments to the wrong reordered item, accidentally restoring omitted secrets/options, changing data through YAML aliases, and promising identity for groups/bookmarks that do not have IDs. The bounded preservation contract and semantic comparison address those risks without a schema migration.

<a id="imp-11"></a>

## IMP-11 — Apply external YAML changes to already-open dashboards

### Evidence and qualification

The [watcher](../../src/config/watcher.ts) marks the process cache dirty, debounces filesystem events, and retries until [the loader](../../src/config/loader.ts) can publish a stable snapshot. The server side already updates without restarting. However, [the home page](<../../src/app/(protected)/page.tsx>) renders server components and has no browser config-change subscription. Current `router.refresh()` calls follow the same browser's saves in [EditModeProvider](../../src/components/edit/EditModeProvider.tsx) and [SettingsPanel](../../src/components/SettingsPanel.tsx); they do not notify other tabs or browsers.

The [settings API](../../src/app/api/settings/route.ts) already exposes an authorized, client-safe config plus an [HMAC of the exact source](../../src/config/revision.ts). Reuse that revision contract, not a hash of redacted settings: comment-only edits also invalidate an editor's baseline. The existing [auth helper](../../src/auth/apiAuth.ts) fails closed while the snapshot is dirty, and the [protected layout](<../../src/app/(protected)/layout.tsx>) refuses to render a formerly public dashboard during that transition.

Appearance needs explicit treatment: [the root layout](../../src/app/layout.tsx) owns `html[data-theme]`, body background variables, and the custom-CSS style element. The installed Next.js documentation says navigation preserves layouts, and [`router.refresh()`](https://nextjs.org/docs/app/api-reference/functions/use-router) merges server payloads while preserving unaffected client state. Checked the installed `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md` and `01-app/01-getting-started/03-layouts-and-pages.md` guides. [SettingsPanel](../../src/components/SettingsPanel.tsx) initializes many fields with `useState(config...)`, so refreshing server props alone does not reset those fields. “Call refresh when a revision changes” is insufficient without browser tests for appearance and an explicit draft policy.

### Scoped design

**Transport:** start with a lightweight same-origin revision polling endpoint (proposed `GET /api/config/revision`), rather than SSE. Polling avoids long-lived proxy connections, per-process broadcast state, and assumptions that all requests reach the watcher process. Each request reads the stable snapshot and rechecks the current authorization policy. Do not poll the full settings document solely to detect changes.

Use one controller per protected browser surface, one request at a time, and a proposed five-second visible-tab interval. Pause hidden/offline polling, abort on unmount, use bounded retry backoff, and check immediately on focus/online. The watcher still performs server-side stability detection; the endpoint must not rewrite/migrate the YAML to satisfy a browser poll. Make the interval and its resulting authorization-change detection delay explicit in docs.

**Endpoint response and authorization:**

| Snapshot/request state | Response contract | Client behavior |
| --- | --- | --- |
| Stable `ready`, viewer currently allowed | Minimal revision plus `editable: true`, private `no-store` response | Compare with last observed revision; refresh only on a change |
| Stable `migration-required`, viewer currently allowed | Minimal revision plus `editable: false`/migration-required reason | Reads may update; show migration guidance and block writes |
| Stable snapshot, viewer no longer allowed | 401 with generic message, no revision/config/appearance payload | Immediately hide protected content, stop widget requests, discard sensitive in-memory drafts, and navigate through the existing login/setup authorization path |
| `dirty`, cold failure, or no confirmed source | Generic temporary-unavailable response with no revision/config/last-known auth assertion | Hide protected content behind a neutral recovery state, suspend writes/widgets, retain existing drafts only in inaccessible memory while retrying |

Authorize against the same confirmed snapshot used to produce a revision; never expose a revision based on the retained last-good config during `dirty`. The operational `KOKPIT_AUTH_DISABLED=true` override must remain consistent with the existing auth policy, but it does not make an invalid configuration safe to publish. Auth-disabled public viewers are allowed subscribers because they are already allowed to view/edit the dashboard. Stable auth-enabled requests require a current valid session. Do not emit settings, secrets, parser errors, filesystem paths, or auth policy internals in denied/unavailable responses. Use same-origin requests without permissive CORS and apply `Cache-Control: private, no-store` to every outcome; do not let a 304 or cached response bypass authorization.

**Refresh and draft coordination:**

- Maintain separate last-observed server revision and editor baseline revision. Observing an external revision must **never** replace the revision bound to an existing draft.
- On a changed revision in ordinary view mode, refresh the server-rendered dashboard and apply its appearance. Coalesce rapid changes and acknowledge the rendered revision to avoid refresh loops. Do not key the whole edit provider on the revision.
- When edit mode, a service/bookmark dialog, or the settings panel has unsaved input, preserve its values and show a “configuration changed” conflict notice. Keep the old baseline revision, disable stale writes as the existing conflict path does, and offer explicit reload/discard. Do not automatically merge potentially secret-bearing configuration.
- Even an active editor with no changes may have an open form with local input. Register draft ownership centrally rather than assuming `EditModeProvider.dirty` covers all forms. A clean idle settings panel may adopt new props through an explicit reset; a dirty panel may not.
- Coordinate own saves with the controller so their returned revision is acknowledged and does not generate a spurious external-conflict banner. If another write wins immediately afterwards, its different revision must still be detected.
- A dirty/migration-required config is a server availability/writability state, separate from a locally dirty draft. For temporary unavailability, keep the draft hidden without saving/rebasing it; after stable recovery, reauthorize and either restore the unchanged baseline or show conflict. On a confirmed 401, clear it and navigate. Security transitions take precedence over unsaved-change prompts; do not leave formerly public data visible behind a modal.
- Hide protected surfaces when a tab becomes hidden/page is suspended; on return, authorize before revealing it or resuming widget requests. Mask on failed authorization checks rather than indefinitely retaining a previously public view. This bounds stale visible public content to the active polling interval under normal connectivity. Content already delivered publicly cannot be recalled from a user's browser; this is a UI/session revalidation guarantee, not retroactive secrecy.

**Appearance:** introduce one explicit appearance synchronization owner with initial server-resolved props, preserving the existing first-paint rendering and `user-custom` cascade layer. Apply authorized refreshed theme/CSS/background/blur values to `document.documentElement`, body variables, and a stable managed style element; remove properties/style content that disappeared. Reuse [resolveAppearance/resolveBackgroundVars](../../src/config/theme.ts) and existing CSS sanitization. Avoid stacking style tags or retaining removed CSS. Settings previews take precedence while their draft is active; external changes produce a conflict instead of overwriting the preview. Reload/discard restores the current authorized server appearance. Prove behavior on the installed Next.js version rather than relying on root-layout refresh assumptions.

### Ordered implementation tasks

1. Add a focused browser reproduction: edit YAML outside the application and show that an already-open dashboard remains unchanged. Include services/order, theme, custom CSS, background removal, and a second browser.
2. Implement and test the minimal revision endpoint using the loader's stable snapshot and current auth policy. Define ready/migration-required/unavailable/unauthorized response types and no-store headers.
3. Add the single polling controller with lifecycle cleanup, visibility/online handling, coalescing, observed-versus-rendered revision tracking, and the neutral access/recovery gate.
4. Integrate draft registration/conflict behavior across edit mode, settings, and nested forms. Preserve existing `If-Match` baselines and explicit reload/discard paths. Coordinate with **IMP-17** before adding overlapping navigation interception.
5. Add explicit appearance synchronization, including removal/reset semantics and settings-preview ownership. Keep custom CSS precedence and server first paint intact.
6. Integrate authorization transitions: clear/hide content and stop child widget work before login/setup navigation; verify temporary dirty snapshots recover without writing the file or accidentally restoring access.
7. Test multi-tab/multi-browser external updates and own-save races; document polling latency, migration handling, unavailable recovery, and draft conflict behavior. Complete the central delivery gate before an implementation commit/PR.

### Tests and acceptance criteria

- Route matrix: auth disabled with and without cookies; auth enabled valid/expired/revoked/no session; zero users; env override; dirty/invalid/missing file; stable migration-required. Unauthorized/unavailable responses contain no revision, last-good settings, secrets, or parser details. Every response is non-cacheable.
- Recheck auth on every poll, including unchanged revision. A policy change from public to private must not keep serving the previous public revision. Include a request/disk-change race and dirty-to-private transition.
- Controller tests use fake timers: one request at a time, abort/unmount cleanup, hidden/offline pause, focus recovery, bounded failure retry, and coalescing rather than infinite refresh loops.
- Two independent browser contexts see service names, tile/group ordering, bookmarks, and added/removed tiles update within the configured interval plus render time; no manual reload is needed. A comment-only YAML change invalidates drafts even when the rendered layout stays the same.
- Browser assertions inspect actual `html[data-theme]`, computed body variables, custom-CSS effects, blur, and removal of old CSS/background values. Test both ordinary dashboard view and settings previews.
- Draft values, editor baseline revisions, and nested form input survive external updates and temporary unavailable states. Reload/discard is explicit. Stale drafts cannot obtain a new revision merely by observing a change. Own saves do not generate a false conflict; genuinely newer writes do.
- A public browser is masked and widget work suspended when config becomes dirty; when stable authentication becomes enabled, a browser without a session loses the protected surface and reaches login/setup within the documented detection window. Invalid configuration never falls back to rendering the previously public config. Hidden/resumed tabs reauthorize before revealing content. Session revocation behaves similarly.
- Migration-required snapshots can be rendered only to allowed viewers, display an edit blocker, and never trigger automatic file migration from the polling path.
- Acceptance: stable external changes reach allowed viewers automatically, unsaved work is preserved while authorization remains valid, and auth/invalid-config transitions fail closed. Documented polling latency and network-failure behavior match tests.

### Dependencies, value, and risks

Implement against the current loader and secret-safe settings boundary; IMP-10 is complementary. Coordinate draft ownership and access-driven navigation with **IMP-17**, and ensure any **IMP-14** widget cache cannot bypass current authorization or keep widgets active after the access gate closes. No persisted schema change or required new dependency is planned.

This closes a concrete gap in the dual-config promise. Main risks are draft loss during refresh, stale appearance because root DOM state survives, disclosure through a public revision endpoint, and retaining public dashboard content after auth is enabled. A minimal authorized endpoint, explicit appearance owner, draft baseline separation, and a tested access gate are required parts of the feature rather than optional follow-ups.
