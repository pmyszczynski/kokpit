# Widget Secret Preservation Security Design

**Date:** 2026-07-26  
**Status:** Approved

## Problem

Kokpit must let users edit a configured widget without returning its saved
password, token, or API key to the browser. The first server-side preservation
implementation replaced secrets with unsigned source coordinates. Those
coordinates could be replayed with a different widget URL, causing Kokpit to
resolve the real secret and send it to an attacker-controlled server.

The flaw is generic because secret fields are discovered from widget registry
metadata. The correction must protect every password-bearing widget, not only
Tautulli, and must remain safe when application authentication is disabled.

## User-Facing Rules

- Settings responses, server-rendered settings props, password inputs, and
  connection-test responses never contain a saved widget secret.
- A saved credential can be reused for saving or connection testing only while
  its credential scope is unchanged.
- Renaming or reordering a service does not require credential re-entry.
- Changing presentation-only configuration, such as Tautulli sections or
  Netdata history length, does not require credential re-entry.
- Changing a widget's endpoint URL requires the credential to be entered again.
- Changing qBittorrent's username also requires the password to be entered
  again.
- Returning a changed scope to its original normalized value makes the saved
  credential reusable again.
- Entering a literal replacement credential permits a new endpoint or username.

## Signed Browser Reference

The browser-safe module keeps only the reserved reference prefix and a predicate
that recognizes it. Signing and verification live in a server-only module so
Node crypto and server-secret access cannot enter the client bundle.

A reference has this conceptual payload:

```ts
{
  v: 1;
  serviceName: string;
  widgetType: string;
  fieldKey: string;
}
```

The encoded payload is authenticated with HMAC-SHA256. The HMAC key is derived
from Kokpit's existing server/session secret with the fixed purpose string
`kokpit/widget-secret-reference/v1`. The JWT key itself remains unchanged so
existing sessions survive the refactor. Tokens contain no secret, secret hash,
scope value, URL, expiry, or user identity.

Verification is fail-closed:

- The reserved prefix with malformed content is an invalid reference, not a
  literal password.
- The version and exact payload shape are validated.
- Oversized tokens are rejected.
- The MAC is checked with a timing-safe comparison before any locator is used.
- Widget type and field claims must match the submitted destination field.
- The referenced source service must still contain a real, non-reference saved
  value.

A signed locator alone is not sufficient. It is intentionally reusable, so
destination-scope comparison is mandatory before resolving the secret.

## Explicit Credential Scope Metadata

`WidgetDefinition` receives a required `credentialScopeFields` declaration when
the widget has any password field. Registration fails if the declaration is
missing, empty, references a missing field, or references another password
field.

All current password-bearing widgets declare `["url"]`. The two qBittorrent
widgets declare `["url", "username"]`.

This invariant ensures a future credentialed widget cannot silently opt out of
destination binding.

## Scope Normalization

Scope is calculated only from the current server-side registry definition and
the supplied widget config. Scope values from the reference are never trusted.

- URL fields must be strings containing HTTP or HTTPS URLs.
- URLs are trimmed and parsed through `URL`.
- Scheme/host casing, default ports, and root slashes use the platform's
  canonical serialization.
- Fragments are discarded because they are not sent in HTTP requests.
- Path and query remain part of the scope because they can change the API
  target.
- Text fields such as qBittorrent username compare exact string values because
  the upstream service may treat case or whitespace as significant.
- Missing or invalid scope values never match.

The same client-safe normalizer drives editor feedback, while the server remains
the authority.

## Server Resolution

For each saved-secret reference, the server:

1. Verifies the reference signature and payload.
2. Confirms widget type and password field.
3. Locates the source service in the current saved YAML configuration.
4. Confirms the source contains a real saved secret.
5. Calculates scope from the saved source config.
6. Calculates scope from the submitted destination config.
7. Resolves the secret only when both normalized scopes match exactly.

This occurs before schema validation and before any outbound request.

`PATCH /api/settings` keeps optimistic revision checking before secret
resolution. Successful rename/reorder operations receive newly issued
references using the new saved service name. A copied reference can only be
used at the same normalized destination; it cannot redirect a credential.

`POST /api/widget/test` applies the identical resolver. Invalid, forged,
tampered, cross-widget, cross-field, or scope-mismatched references return a
bounded 400 response and perform no network call.

Public errors use stable codes:

- `widget_secret_reference_invalid`
- `widget_secret_scope_changed`

Messages instruct the user to re-enter the credential without including the
reference, source service, saved config, URL, or secret.

## Editor Behavior

The editor retains the reference in React state while rendering an empty
password input with a saved-value placeholder. It compares the original and
current normalized credential scopes:

- Matching scope: the saved reference satisfies required-field validation and
  connection testing is available.
- Changed scope: the password input becomes required, shows a re-entry hint,
  the stale reference does not satisfy client widget validation, and connection
  testing is disabled until a literal replacement is typed.
- Reverted scope: the original reference becomes usable again.

Unrelated service and display fields do not affect this state.

## Tautulli Abort Semantics

Tautulli must preserve cancellation both while awaiting `fetch()` and while
reading `response.json()`. If the signal is aborted or the caught error is named
`AbortError`, the client throws a sanitized error named `AbortError` with the
message `Tautulli request aborted`. Other transport and JSON failures keep their
bounded service-specific messages. Upstream error text is never rethrown because
it may contain the credential-bearing request URL.

## Required Security Tests

- Valid signed-reference round trip and purpose-separated signing key.
- Malformed, oversized, forged, payload-tampered, and signature-tampered
  references fail closed.
- Every registered password widget has valid explicit credential scope.
- GET, PATCH, server-rendered settings, DOM, and test responses contain no raw
  saved credential.
- Rename, reorder, display-only changes, and canonical-equivalent URLs preserve
  credentials.
- Host, scheme, port, path, or query changes reject saved references.
- qBittorrent username changes reject saved passwords.
- Literal replacement credentials work with a changed scope.
- Cross-widget, cross-field, and different-scope copied references fail.
- Every resolution failure occurs before `fetch`.
- Authentication-disabled requests cannot redirect a saved credential.
- Revision mismatch remains ahead of reference resolution.
- Tautulli response-body cancellation preserves sanitized `AbortError`
  semantics.

