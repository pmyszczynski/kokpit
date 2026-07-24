# Docker Registry Releases

This document explains how Kokpit's Docker images are published to GitHub Container Registry (GHCR) and how to manage releases.

## Overview

Kokpit publishes pre-built Docker images to [GitHub Container Registry](https://github.com/pmyszczynski/kokpit/pkgs/container/kokpit) (GHCR). Users can pull these images instead of building from source, making deployment faster and simpler.

**Registry:** `ghcr.io/pmyszczynski/kokpit`

## Publishing Workflow

The release process is driven by two workflows and a `workflow_dispatch` trigger — not by manually creating a release through the GitHub UI:

1. **Bump `package.json`/`package-lock.json` on `main` via a merged PR.** `main` requires a PR for every change (GitHub Actions can't open/merge its own PRs in this repo, so this step can't happen inside CI).
2. **Run `release.yml`** (`workflow_dispatch`, input: `version`, e.g. `0.2.6`). It:
   - Runs the full test gate (lint, type-check, unit tests, E2E, auth E2E)
   - Verifies `package.json` on `main` matches the input version (fails otherwise — go back to step 1)
   - Tags `vX.Y.Z` and creates the GitHub Release (`gh release create --generate-notes`)
   - Explicitly dispatches `publish.yml` for that tag
3. **`publish.yml` builds and pushes the Docker image:**
   - Builds the Docker image (using the `runner` stage)
   - Pushes to GHCR with appropriate tags
   - Creates metadata labels (version, source, docs)

Releases created by `release.yml` are authored by `GITHUB_TOKEN`, and GitHub suppresses the `release: published` event for token-authored releases (loop prevention) — so `release.yml`'s last step dispatches `publish.yml` directly (`gh workflow run publish.yml -f tag=vX.Y.Z`) instead of relying on that event. A release made by an actual human through the GitHub UI still triggers `publish.yml` normally via the `release: published` event, since `workflow_dispatch` is only the fallback path for token-authored releases.

## Versioning Strategy

Kokpit uses **semantic versioning**: `MAJOR.MINOR.PATCH`

- `v0.1.0` — Release 0.1.0
- `v0.2.0` — Release 0.2.0
- `v0.2.1` — Patch release
- `v1.0.0-beta.1` — Pre-release

### Pre-releases vs Stable Releases

**Pre-releases** (e.g., `v0.2.0-beta.1`, `v0.2.0-rc.1`):
- Use when features are still being tested
- Mark as "Pre-release" on GitHub
- Only produce version-specific tags: `0.2.0-beta.1`
- **Do NOT** get the `latest` tag (users avoid pre-releases by default)

**Stable releases** (e.g., `v0.2.0`):
- Thoroughly tested and ready for production
- Mark as regular release (not pre-release)
- Produce multiple tags:
  - `0.2.0` (exact version)
  - `0.2` (minor version, tracks latest patch)
  - `latest` (current stable release)

## Image Tags and User Selection

### Pinned to an exact version

```bash
docker run ghcr.io/pmyszczynski/kokpit:0.2.0
```

Recommended for production. You control when to upgrade.

### Track minor version (auto-updates patches)

```bash
docker run ghcr.io/pmyszczynski/kokpit:0.2
```

Automatically gets patches (0.2.1, 0.2.2, etc.) without major/minor version changes.

### Always latest stable

```bash
docker run ghcr.io/pmyszczynski/kokpit:latest
```

Only updated for stable releases. Never gets pre-releases. Good for quick testing.

## How to Create a Release

### Step 1: Bump the version on `main` via a PR

`release.yml` will fail if `package.json` on `main` doesn't already match the version you're about to release, so this has to land first, as a normal reviewed PR (Actions can't merge its own PRs here):

```bash
npm version 0.2.6 --no-git-tag-version
```

Commit `package.json` + `package-lock.json`, push, open a PR into `main`, and merge it.

### Step 2: Run the release workflow

Go to **Actions → Create Release → Run workflow**, select `main`, and enter the version (no `v` prefix, e.g. `0.2.6`). This runs the full test gate first, then — only if it passes — verifies the version, tags `v0.2.6`, creates the GitHub Release, and dispatches `publish.yml`.

If the "Verify package.json version matches input" step fails, Step 1 was skipped or used the wrong version — fix the PR and re-run.

### Step 3: Verify in GHCR

Once `release.yml` completes and the `publish.yml` run it triggers finishes (check **Actions**):
1. Go to [Container Registry](https://github.com/pmyszczynski/kokpit/pkgs/container/kokpit)
2. Confirm new tags appear (e.g., `0.2.6`, `0.2`, `latest`)
3. Check the tag details for image size and build info

### Alternative: publishing a pre-existing manual release

A release created directly through the GitHub UI (rather than via `release.yml`) still triggers `publish.yml` automatically through the normal `release: published` event — the `workflow_dispatch` trigger on `publish.yml` exists only as a fallback for `release.yml`'s token-authored releases, not as the primary path.

## Workflow Details

**File:** `.github/workflows/publish.yml`

**Trigger:** `release` event (published), or `workflow_dispatch` with a `tag` input — the latter is what `release.yml` uses, since token-authored releases don't fire the `release` event.

**Steps:**
1. Checkout code
2. Setup Docker Buildx (for efficient building)
3. Log in to GHCR (using GitHub's token, no credentials needed)
4. Extract metadata and tags:
   - `type=semver` → `0.2.0`, `0.2`, etc.
   - `type=raw,value=latest` → only if not a pre-release
5. Build and push only the `runner` stage (minimal production image)
6. Cache build layers in GitHub Actions cache (faster next build)

**Output tags for `v0.2.0` (stable):**
```
ghcr.io/pmyszczynski/kokpit:0.2.0
ghcr.io/pmyszczynski/kokpit:0.2
ghcr.io/pmyszczynski/kokpit:latest
```

**Output tags for `v0.2.0-beta.1` (pre-release):**
```
ghcr.io/pmyszczynski/kokpit:0.2.0-beta.1
```

## Best Practices

### Before releasing

- ✅ Ensure all tests pass (`npm test`, `npm run test:e2e`)
- ✅ Update `package.json` version
- ✅ Update `CHANGELOG.md` (if you have one)
- ✅ Test the Docker image locally: `docker compose up kokpit --build`
- ✅ Write a clear release description

### Version numbers

- Follow [semver](https://semver.org/): MAJOR.MINOR.PATCH
- Increment MINOR for features
- Increment PATCH for bug fixes
- Use pre-release tags for unreleased versions

### Release notes

Include:
- What's new (features, improvements)
- What's fixed (bug fixes)
- Breaking changes (if any)
- Upgrade instructions (if applicable)

Example:
```
## v0.3.0

### Features
- Add Radarr widget integration
- Support custom CSS injection

### Fixes
- Fix tile grid responsive layout on mobile
- Fix database connection timeout on startup

### Breaking Changes
None

### Upgrade
```bash
docker pull ghcr.io/pmyszczynski/kokpit:0.3.0
docker compose up kokpit  # Update docker-compose.yml to pull instead of build
```
```

## Troubleshooting

### Workflow failed to push image

**Check:**
1. Go to [Actions tab](https://github.com/pmyszczynski/kokpit/actions)
2. Find the failed run under "Publish Docker Image"
3. Click to see error logs

**Common causes:**
- Release was marked as pre-release (check via Edit Release)
- Tag doesn't follow semver (use `v0.2.0` not `0.2.0` or `release-0.2.0`)
- GitHub token issue (shouldn't happen with standard setup)

### Image not appearing in GHCR

1. Workflow may still be running (check Actions)
2. Check if release was published (not in draft)
3. Try re-running the workflow:
   - Go to Actions → Publish Docker Image
   - Find the run
   - Click "Re-run all jobs"

### Want to test the workflow without a public release

Use a pre-release:
1. Create release `v0.2.0-test.1`
2. Check "Pre-release" checkbox
3. Publish
4. Verify tags appear (won't have `latest`)
5. Delete the release when done

## Local Development

Building the image locally still works unchanged:

```bash
# Development (hot reload)
docker compose up kokpit-dev

# Production (from source)
docker compose up kokpit --build

# Just build the runner image
docker build -t kokpit-local --target runner .
docker run -p 3000:3000 -v ./data:/data kokpit-local
```

This doesn't affect GHCR publishing and is useful for testing changes before release.

## References

- [GitHub Releases Documentation](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
- [OCI Image Spec](https://github.com/opencontainers/image-spec)
- [Semantic Versioning](https://semver.org/)
- [Docker Build Action](https://github.com/docker/build-push-action)
