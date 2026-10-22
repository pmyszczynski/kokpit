# Operations and validation improvement plan

**Date:** 2026-10-20

**Status:** IMP-18 completed upstream in PR #132 (included in v0.27.1); IMP-20 implemented for v0.30.5; IMP-19 implemented for v0.31.4.

**Selected audit items:** IMP-18, IMP-19 and IMP-20.

**Parent plan:** [Selected project improvements](2026-10-20-improvement-plan.md).

All selected items in this document are implemented in the versions recorded below. Historical evidence describes the reviewed baseline; design and ordered task sections retain the accepted implementation scope. Separately scoped follow-ups are identified explicitly.

<a id="imp-18"></a>

## IMP-18 — Emergency password recovery packaging: completed upstream

**Disposition:** Completed by [PR #132](https://github.com/pmyszczynski/kokpit/pull/132), commit `1097384`, and included in v0.27.1 (`71ef878`). The earlier missing-script finding applied before that merge; it is resolved on the current base. No duplicate Dockerfile `COPY` is required.

### Implementation and validation evidence

- [`next.config.ts`](../../next.config.ts#L28) explicitly includes `./scripts/reset-password.js` and `./node_modules/bcryptjs/**/*` in the login route's standalone output tracing. That retains the operational utility even though it is not imported by an application route. The [runner's existing standalone copy](../../Dockerfile#L70) then carries it into the Docker image.
- [`e2e/start-prod.sh`](../../e2e/start-prod.sh#L32) copies the production artifact outside the repository, unsets `NODE_PATH`, then [loads the shipped utility and opens/closes a disposable database](../../e2e/start-prod.sh#L41) before starting the standalone server. This verifies the script, bcrypt dependency and native SQLite module can resolve without falling back to the source checkout. The [auth E2E configuration](../../playwright.auth.config.ts#L16) uses that launcher, and `npm run test:e2e:auth` builds before running it.
- The [existing script schema test](../../src/__tests__/auth/reset-password-script.test.ts#L24) additionally checks compatibility with the application's session schema. The [reset transaction](../../scripts/reset-password.js#L135) already increments `session_version`, deletes the selected user's sessions, and optionally clears TOTP/recovery state. Its normal host and [documented Docker invocation](../../README.md#L369) remain supported.

### Remaining caveats, not additional IMP-18 completion requirements

- The isolated standalone smoke proves packaging and database/dependency loading; it does not exercise an interactive account reset, each TOTP/recovery choice, Alpine final-image execution, or UID/GID ownership. A future disposable-container PTY test could strengthen that coverage, using only a disposable volume and fixture account, without passwords, hashes, seeds, codes or tokens in command arguments/logs. It should verify old-password rejection, new-password login, session/challenge revocation, optional factor preservation/clearing, and that unrelated accounts remain unchanged.
- The Dockerfile has no final `USER` instruction. The [entrypoint](../../docker-entrypoint.sh#L28) drops privileges for the server, but a new `docker compose exec` process bypasses it and defaults to root. Operators can explicitly use `docker compose exec --user nextjs:nodejs kokpit node /app/scripts/reset-password.js` to preserve runtime-user ownership. The current standalone smoke does not assert this Docker execution identity.
- [`openDb()`](../../scripts/reset-password.js#L19) still creates a missing directory/database. Failing on a nonexistent configured database rather than creating one could prevent confusion after a mistyped `KOKPIT_DB_PATH`, but is a separate behavior change requiring updates to the intentional schema-initialization test. Do not treat it as missing packaging or silently expand the completed task to require it.
- The CLI's new-password validation was implemented in the selected [IMP-07 password-byte-limit work](2026-10-20-auth-hardening-plan.md#imp-07). The IMP-06 challenge-storage integration preserves atomic reset and credential-generation protections; neither change reopens the completed packaging task.

<a id="imp-19"></a>

## IMP-19 — Separate readiness from liveness and report the built version

Status: **implemented for v0.31.4**.

Public `/api/health` remains 200 liveness and reports the version compiled into the artifact, including direct standalone startup. New `/api/ready` returns fixed non-cacheable 200/503 dependency states without settings, paths, account or upstream details. Readiness requires the published source to match disk exactly: cold, dirty, missing or unreadable configuration fails, and stable migration-required configuration reports restart_required until deliberate migration/restart.

Normal startup/configuration lifecycle owns initialization; probes do not create or migrate YAML, acquire its write lock, open SQLite or repair schema. Authentication-disabled instances do not require a database. An initialized auth database must be open and writable in connection policy and complete a schema-aware read with a 50 ms lock wait, restoring its prior timeout. Regression coverage includes real files, cold/no-write behavior, database failures/locks, lifecycle changes, public envelopes and compiled-version identity. Docker defaults retain liveness; documented readiness overrides do not promise automatic restarts or recovery orchestration. Integrated artifact validation is recorded separately.

### Pre-implementation problem and qualification

The evidence below is pinned to pre-feature revision `ab5469305429bcf97062fc72661fef1e96297ee2`, before v0.31.4; the accepted design and implementation notes describe the completed code change. Final-source validation remains separate below.

- [`/api/health`](https://github.com/pmyszczynski/kokpit/blob/ab5469305429bcf97062fc72661fef1e96297ee2/src/app/api/health/route.ts#L4-L9) returned `200`, `status: "ok"`, a timestamp, and `process.env.npm_package_version ?? "unknown"`. A successful response proves the HTTP process can answer. That is valid **liveness** behavior; unconditional `200` is not itself a defect in a liveness endpoint.
- Both the [image healthcheck](https://github.com/pmyszczynski/kokpit/blob/ab5469305429bcf97062fc72661fef1e96297ee2/Dockerfile#L85-L86) and [Compose override](https://github.com/pmyszczynski/kokpit/blob/ab5469305429bcf97062fc72661fef1e96297ee2/docker-compose.yml#L49-L54) use that endpoint. They therefore cannot distinguish a responsive process from an application unable to serve its dashboard or authenticate users.
- [Startup instrumentation](https://github.com/pmyszczynski/kokpit/blob/ab5469305429bcf97062fc72661fef1e96297ee2/src/instrumentation.node.ts#L9-L10) already loads and validates configuration. Malformed startup configuration can stop startup; the missing feature is an explicit readiness contract for initialization and later failures, not an absence of all startup validation.
- The [configuration loader](https://github.com/pmyszczynski/kokpit/blob/ab5469305429bcf97062fc72661fef1e96297ee2/src/config/loader.ts#L766-L772) fails closed on dirty state, while its [watcher refresh](https://github.com/pmyszczynski/kokpit/blob/ab5469305429bcf97062fc72661fef1e96297ee2/src/config/loader.ts#L867) retains last-known-good data internally. Existing [`getConfigSnapshot()`](https://github.com/pmyszczynski/kokpit/blob/ab5469305429bcf97062fc72661fef1e96297ee2/src/config/loader.ts#L775-L780) may call `loadConfig()` when cold, so a readiness handler must not reuse that method blindly: [cold loading](https://github.com/pmyszczynski/kokpit/blob/ab5469305429bcf97062fc72661fef1e96297ee2/src/config/loader.ts#L730-L764) can create, migrate, or repair YAML files.
- [`getDb()`](https://github.com/pmyszczynski/kokpit/blob/ab5469305429bcf97062fc72661fef1e96297ee2/src/auth/db.ts#L8-L19) lazily creates directories, opens SQLite, and applies schema changes. Calling it for the first time from an unauthenticated probe would turn a read probe into application initialization. The [protected layout](https://github.com/pmyszczynski/kokpit/blob/ab5469305429bcf97062fc72661fef1e96297ee2/src/app/(protected)/layout.tsx#L45-L46) normally requires the database when authentication is enabled; readiness must reflect that dependency without requiring a database for an explicitly public dashboard.
- The production image starts [`node server.js`](https://github.com/pmyszczynski/kokpit/blob/ab5469305429bcf97062fc72661fef1e96297ee2/Dockerfile#L89), rather than an npm lifecycle command. The version fallback can therefore be `"unknown"`; the [existing test](https://github.com/pmyszczynski/kokpit/blob/ab5469305429bcf97062fc72661fef1e96297ee2/src/__tests__/api/health.test.ts#L6-L12) only checks that version is a string and does not catch this.

This remains worthwhile as operational visibility and trustworthy version identification. It should not be represented as fixing an incorrect liveness status code.

### Accepted design

1. Preserve unauthenticated `GET /api/health` as lightweight liveness, including its existing successful response fields. Do not make liveness depend on configuration, SQLite, upstream integrations, or login state. Send `Cache-Control: no-store` so monitors receive a current result.
2. Add unauthenticated `GET /api/ready` using the Node runtime. Return `200` when required local application dependencies are usable and `503` otherwise, with a small response such as `{ status: "ready" | "not_ready", version, timestamp, checks: { config, database } }`. Use a fixed vocabulary for check states; never include YAML, configured URLs, account counts, credentials, file paths, SQL text, exception messages, or stack traces. Mark responses `no-store` and ensure the route executes per request under the installed Next.js version.
3. Add a narrowly scoped, read-only configuration readiness accessor. It must report cold/initializing, ready, dirty/unavailable, and restart-required states without invoking `loadConfig()`, acquiring the write lock, or rewriting/migrating a document. Verify that disk still matches the published source without publishing stale data. Existing dirty-state refresh may remain in the normal watcher path; the readiness request must not become another migration path.
4. Set the readiness policy explicitly: `ready` configuration passes; cold/dirty/unavailable fails. `migration-required` returns `503` with a fixed `restart_required` state, because configuration writes are blocked until deliberate restart/migration, even if some read-only pages still render. Document this strict policy so an operator does not interpret it as total process failure.
5. Record database initialization state in the application lifecycle. Initialize required SQLite services outside probe requests; expose a helper that reads that state and makes a cheap bounded query against the already initialized handle. For authentication-disabled deployments, report `not_required` and do not create SQLite merely because a monitor called readiness. When authentication becomes enabled through YAML, normal lifecycle handling must initialize the dependency before readiness succeeds. Test `KOKPIT_AUTH_DISABLED` consistently with existing auth policy.
6. For a required database, fail readiness on failed initialization, a closed/unusable handle, readonly mode where session writes are required, or failure of a minimal schema-aware read. Do not write disposable rows, run migrations, create directories, or perform full integrity scans per probe. Bound the SQLite probe's busy timeout so repeated checks cannot stall request processing. A read check is not a guarantee against later disk-full or write-permission failures; retain normal application error handling and document that limit.
7. Read only the package version at configuration/build time and inline that scalar into a server-only build metadata helper. Do not import the complete application `package.json` into a route/runtime bundle, depend on npm environment variables, or expose general environment/configuration objects. The version identifies the built artifact and must not be replaced by a caller-supplied runtime value. The same path should work for development and a direct standalone Node launch.
8. Keep the existing Dockerfile and Compose probes on liveness by default for compatibility. Document an explicit override to `/api/ready` for operators who want the container's health status to describe application readiness; retain `127.0.0.1`, overridden `PORT`, and the existing startup grace/retry behavior in both forms.

**Deployment semantics:** Liveness is suitable for a restart decision when the process stops responding. Readiness is suitable for removing an instance from a load balancer or postponing a dependent service until initialization succeeds. Docker/Compose marks a failed healthcheck `unhealthy`; `restart: unless-stopped` does not restart a still-running unhealthy container by itself, and Compose does not supply dynamic load-balancer routing. A readiness healthcheck can help `depends_on: condition: service_healthy` startup ordering, but does not promise recovery orchestration after startup. Do not wire bad YAML or a transient SQLite problem into an automatic restart loop. External integration outages do not make the dashboard itself unready.

### Completed implementation tasks

- [x] Read the installed Next.js route-handler, environment/configuration and instrumentation documentation, confirming runtime and caching declarations for this project version.
- [x] Defined the sanitized readiness response and state policy, adding configuration observation and database lifecycle helpers without YAML or schema mutations at probe time and coordinating shared cache-state changes with IMP-11.
- [x] Added the build-version helper and updated liveness to use it while preserving the successful response contract.
- [x] Implemented `/api/ready`, required-dependency selection, a short query timeout and fixed error mapping, keeping probe errors out of public responses and repeated logs.
- [x] Added API and lifecycle regressions for the state transitions below, retaining endpoint/loopback/port coverage.
- [x] Prepared production standalone/container verification and documented both probe configurations and their deployment meaning.

### Final-source validation requirements

- After final edits and before the implementation commit/PR, run appropriate focused checks and all five commands in the [parent-plan validation gate](2026-10-20-improvement-plan.md) sequentially: `CI=true npm run lint`, `CI=true npm run type-check`, `CI=true npm run test:coverage`, `CI=true npm run test:e2e:nonvisual` and `CI=true npm run test:e2e:auth`.
- After that gate, rebuild the final runner image and pass fresh 25-case Docker verification on the same exact source before marking the change ready to commit, including nondefault-port liveness/readiness healthchecks. Historical container results do not replace this final proof.

Record actual validation and delivery evidence in the PR and release records.

### Verification and acceptance criteria

- Liveness retains `200`, `status: "ok"`, version, and a valid timestamp while configuration or required database readiness fails. Both endpoints work without credentials and return non-cacheable responses.
- Readiness returns `200` only for usable required dependencies; cold, dirty, missing/unreadable configuration, restart-required migration, failed database initialization, closed handle, and query errors return `503`. Invalid YAML followed by a valid stable rewrite recovers through the existing loader/watcher lifecycle without a probe mutating either file.
- Repeated cold/legacy/invalid-config probes do not create a YAML file, backup, temporary file, lock, database, table, or migration. An initialization operation performed by application startup remains separately observable and is not attributed to the probe.
- Authentication-enabled first-run setup is ready once the database schema is usable; zero users is not an error. Explicitly disabled auth reports the database `not_required`; changing auth policy updates readiness safely.
- Readiness output contains only fixed status codes, timestamp, and build version. Test failures containing a fake secret and absolute path to prove those strings do not reach responses.
- A production build launched directly with `node server.js`, with `npm_package_version` unset, reports the package version from the build; changing that environment variable does not change artifact identity. Verify the final Docker image, not only `npm start` or development mode, and inspect that the route bundle does not include the complete app manifest for version lookup.
- Existing Docker/Compose liveness probes still honor IPv4 loopback and nondefault ports. The documented readiness override becomes unhealthy on a simulated dependency failure while liveness stays responsive; no test assumes Docker automatically restarts that container.

<a id="imp-20"></a>

## IMP-20 — Run the complete type-check command in validation workflows

Status: **implemented for v0.30.5**.

PR/main CI and release validation now run the shared `npm run type-check` command, covering production code and `tsconfig.test.json` while preserving existing check names, triggers and release dependencies. Docker publication checks out the requested release tag, installs its locked dependencies and runs that same command before publishing, including UI-release and manual recovery entry points.

The publication preflight is a complete type check, not a substitute for the release test gate. An older tag with invalid test types needs a corrected reviewed release. The edited workflow YAML has been parsed successfully; integrated validation and CI results are recorded separately.

### Original problem and workflow scope

[`npm run type-check`](../../package.json#L22) runs both `tsc --noEmit` and `tsc --project tsconfig.test.json`. The [base TypeScript config](../../tsconfig.json#L41) excludes `src/__tests__`, while the [test config](../../tsconfig.test.json#L3) includes it. Vitest executes transformed tests but does not substitute for TypeScript checking them.

| Entry point | Historical baseline before v0.30.5 | Accepted change |
| --- | --- | --- |
| [PR/main CI](../../.github/workflows/ci.yml#L62) | Runs only `npx tsc --noEmit`. | Replace with `npm run type-check`; retain the existing `Type-check` job/check name. |
| [Release validation](../../.github/workflows/release.yml#L47) | Also runs only `npx tsc --noEmit`, despite claiming a full test gate. | Use the same package script before release/tag publication. |
| [Docker publication](../../.github/workflows/publish.yml#L73) | Builds the runner and verifies pushed image tags. UI releases/manual recovery can bypass the `release.yml` test job; Next's build check still excludes unit-test files. | Add exact-tag Node/npm dependency setup and `npm run type-check` before image publication, so every supported publish trigger gets the complete type check. This is a type-check preflight, not a claim that direct publication ran the full release gate. |
| [Snapshot generation](../../.github/workflows/update-playwright-snapshots.yml#L29) | Installs dependencies and generates/upload visual baselines. It is an artifact-generation workflow, not a full validation gate. | Retain that purpose; do not claim it has CI/release parity or add the whole gate merely to generate snapshots. Existing CI remains required when baselines are committed. |

The original finding was a missing automated check that local project policy already required. The deliberate test-only type-error exercise confirmed that the complete command detects errors excluded by the base command. The clean tree passes both compiler configurations.

### Ordered implementation tasks

1. Replace the two direct `npx tsc --noEmit` invocations in `ci.yml` and `release.yml` with `npm run type-check`, preserving job names, event triggers, release dependencies, runner versions, and other validation commands.
2. In `publish.yml`, after checkout of the requested release tag and before any image push, set up Node 22 with npm caching, run `npm ci`, then `npm run type-check`. Use the checked-out tag's lockfile and script, rather than validating the default branch while publishing a different tag. Do not change release tag verification or container publication semantics.
3. Run the complete script on a clean checkout. Fix any real test type errors it uncovers without weakening compiler options, excluding failing tests, or suppressing diagnostics merely to pass CI.
4. Validate workflow YAML and inspect the effective commands for all four workflows. A new dedicated unit test that merely asserts the replacement string is unnecessary for this small reversible workflow edit; use a deliberate type-failure exercise to validate behavior.
5. In an isolated temporary checkout, add a known TypeScript error under `src/__tests__` and demonstrate that the base command can pass while `npm run type-check` fails. Remove that temporary fixture; do not commit a deliberately broken test. Run the script again without the fixture.
6. Update validation documentation only if needed to make the four workflow roles accurate, then run the complete [parent-plan validation gate](2026-10-20-improvement-plan.md). Inspect actual CI checks for the implementation PR; no tag, release, registry push, or workflow dispatch that publishes an artifact is necessary to verify this planning task.

### Verification and acceptance criteria

- PR/main CI and release use the package script, so changes to that script automatically reach both entry points. No validation workflow retains a base-only command as its advertised complete type check.
- The publish preflight runs on the exact checked-out release tag for reusable, UI-release, and manual invocations, and must succeed before pushing an image. Existing publication/tag-verification tests still pass. Recovery of an older tag may fail if that tag itself has invalid test types; handle that as a real validation failure rather than silently bypassing the gate.
- The intentional test-only type-error exercise fails the complete command and the clean tree passes it. Production and test compiler coverage remain enabled.
- All existing workflow check names, PR trigger activity types, Playwright runner alignment, release-before-publish dependencies, and snapshot artifact behavior remain intact.
- Snapshot generation is documented as a supporting artifact operation; a successful snapshot workflow is never reported as the full project validation gate.
