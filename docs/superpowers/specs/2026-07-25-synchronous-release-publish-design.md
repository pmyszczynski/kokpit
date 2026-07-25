# Synchronous Docker Release Publishing Design

## Goal

A successful `Create Release` workflow must mean that the release's Docker
image is available from GHCR under every tag promised by the project. The
workflow must fail if publishing or subsequent registry verification fails.

## Context

`release.yml` currently creates the git tag and GitHub Release, then starts
`publish.yml` with `gh workflow run`. Dispatching is asynchronous, so the
release workflow can report success before Docker publishing has failed. The
previous tag regression occurred in that blind spot: workflow configuration was
valid enough to run, but GHCR did not receive the expected versioned tags.

The existing `publish.yml` must remain directly runnable for releases created
by a human in the GitHub UI, because a `release: published` event still
triggers it. It must also remain manually dispatchable to repair a published
release.

## Design

### Reuse `publish.yml` from `release.yml`

Add a `workflow_call` trigger to `publish.yml` with a required string `tag`
input. It keeps its existing `release: published` and `workflow_dispatch`
triggers.

Replace the `Trigger Docker publish` step in `release.yml` with a `publish`
job that:

1. Depends on the successful `release` job.
2. Calls `./.github/workflows/publish.yml` from the same commit.
3. Passes `v${{ inputs.version }}` as the `tag` input.
4. Grants only the permissions needed for the called workflow to push to GHCR
   (`contents: read`, `packages: write`) and inherits the repository token.

Using a reusable workflow makes Docker publishing a synchronous dependency of
the release workflow. The release run finishes only after the called workflow
finishes.

### Resolve release information consistently

`publish.yml` derives the release tag from `inputs.tag` for `workflow_call`
and `workflow_dispatch`, and from `github.event.release.tag_name` for GitHub
Release events. The checkout reference and Docker metadata rules use that
resolved tag.

For the two non-release-event triggers, it queries the existing GitHub Release
to determine whether it is a pre-release. This preserves the current
stable-versus-pre-release policy for all entry points.

### Verify published manifests

Immediately after `docker/build-push-action` completes, add a `Verify published
image tags` step. It authenticates using the preceding registry login and uses
`docker buildx imagetools inspect` to confirm that each expected image manifest
is retrievable from GHCR.

The expected tags are derived from the same release tag used for Docker
metadata:

| Release type | Required GHCR tags |
| --- | --- |
| Stable `vX.Y.Z` | `vX.Y.Z`, `X.Y.Z`, `X.Y`, `latest` |
| Pre-release `vX.Y.Z-suffix` | `vX.Y.Z-suffix`, `X.Y.Z-suffix` |

Each tag is retried a small, bounded number of times with a short delay to
allow for registry propagation. Failure after the final retry fails the
publish workflow and, when called from `release.yml`, fails the entire release
run.

## Failure Semantics

The git tag and GitHub Release are created before image publishing starts. If
publishing or manifest verification fails, they remain in place; the release
workflow is marked failed and documents an incomplete release. An operator can
correct the cause and re-run `publish.yml` for the same tag without creating a
second release. The design deliberately does not delete a release or tag on a
failure, avoiding destructive automatic rollback.

## Tests

Extend the workflow-parser tests to verify:

1. `publish.yml` supports `workflow_call` with a required tag input.
2. Docker metadata and checkout resolve the invoked tag correctly.
3. The post-push verification step uses `docker buildx imagetools inspect`,
   checks both exact tags, conditionally checks stable aliases, and has bounded
   retries.
4. `release.yml` has a dependent reusable-workflow `publish` job, passes the
   `v`-prefixed version, and no longer dispatches Docker publishing with
   `gh workflow run`.

The existing unit test suite remains the validation command for these parser
tests. CI then validates the workflow syntax and the next release exercises the
end-to-end GHCR verification path.

## Documentation

Update `AGENTS.md` and `docs/DOCKER_RELEASES.md` to say that a completed
release run includes completed, verified Docker publication. Document the
incomplete-release recovery path: correct the issue, re-run `publish.yml` for
the existing tag, and confirm the expected GHCR tags.

## Non-goals

- Releasing a version without a prior version-bump PR.
- Automatically deleting tags or GitHub Releases after a publish failure.
- Changing which image tags stable and pre-release versions receive.
- Adding a new external registry, secret, or cloud dependency.
