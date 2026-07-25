# Synchronous Docker Release Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a successful Create Release workflow prove that all promised Docker image tags are available from GHCR.

**Architecture:** Convert `publish.yml` into a reusable workflow while retaining its GitHub Release and manual-dispatch triggers. `release.yml` will call that workflow as a dependent job; the publishing workflow will inspect the expected GHCR manifests after it pushes them and fail on a bounded retry timeout.

**Tech Stack:** GitHub Actions reusable workflows, Docker Buildx `imagetools inspect`, Vitest, YAML workflow parser.

## Global Constraints

- `main` changes must go through a PR; do not change the prior version-bump PR requirement.
- A stable `vX.Y.Z` must publish `vX.Y.Z`, `X.Y.Z`, `X.Y`, and `latest`.
- A pre-release `vX.Y.Z-suffix` must publish only `vX.Y.Z-suffix` and `X.Y.Z-suffix`.
- Preserve the GitHub Release and git tag after a publishing failure; the workflow must show the incomplete release by failing.
- Keep GitHub UI Release publishing and `publish.yml` manual dispatch working.
- Do not add registry credentials, third-party services, or dependencies.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `.github/workflows/publish.yml` | Build, push, and confirm Docker tags for release, manual, and reusable-workflow invocations. |
| `.github/workflows/release.yml` | Test, tag, create the GitHub Release, and synchronously call Docker publishing. |
| `src/__tests__/workflows/publish.test.ts` | Parse both workflows and guard their release/publish contract. |
| `AGENTS.md` | Concise release process for maintainers and agents. |
| `docs/DOCKER_RELEASES.md` | Detailed release behavior and incomplete-release recovery instructions. |

### Task 1: Test and implement the synchronous release contract

**Files:**
- Modify: `.github/workflows/publish.yml:3-76`
- Modify: `.github/workflows/release.yml:11-109`
- Modify: `src/__tests__/workflows/publish.test.ts:1-28`

**Interfaces:**
- Consumes: the release input `inputs.version` (`X.Y.Z` or `X.Y.Z-suffix`) and an existing GitHub Release named `v${version}`.
- Produces: a reusable `.github/workflows/publish.yml` workflow accepting `inputs.tag: string`; the release job calls it as a dependent `publish` job.
- Produces: a `Verify published image tags` step that resolves `$TAG` to the exact release tag and invokes `docker buildx imagetools inspect "$IMAGE:$tag"` for every expected image tag.

- [ ] **Step 1: Write failing workflow-parser tests**

Replace the narrow metadata helper with helpers that parse both workflow files and locate named steps. Add these assertions:

```ts
const publishWorkflow = parseWorkflow(".github/workflows/publish.yml");
const releaseWorkflow = parseWorkflow(".github/workflows/release.yml");
const releaseTag = "${{ github.event.release.tag_name || inputs.tag }}";

expect(publishWorkflow.on.workflow_call.inputs.tag).toMatchObject({
  required: true,
  type: "string",
});

expect(checkoutStep.with.ref).toBe(releaseTag);
expect(verificationStep.run).toContain("docker buildx imagetools inspect");
expect(verificationStep.run).toContain('tags=("$TAG" "$VERSION")');
expect(verificationStep.run).toContain('tags+=("${VERSION%.*}" latest)');
expect(verificationStep.run).toContain("for attempt in 1 2 3 4 5 6");

expect(releaseWorkflow.jobs.publish.needs).toBe("release");
expect(releaseWorkflow.jobs.publish.uses).toBe("./.github/workflows/publish.yml");
expect(releaseWorkflow.jobs.publish.with.tag).toBe("v${{ inputs.version }}");
expect(JSON.stringify(releaseWorkflow)).not.toContain("gh workflow run publish.yml");
```

Keep the existing assertions that Docker metadata derives exact and minor tags from `releaseTag`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- src/__tests__/workflows/publish.test.ts`

Expected: FAIL because `publish.yml` does not yet declare `workflow_call` or a verification step, and `release.yml` still dispatches rather than calls publishing.

- [ ] **Step 3: Make `publish.yml` reusable and verify manifests**

Add this trigger before the existing `release` trigger:

```yaml
  workflow_call:
    inputs:
      tag:
        description: Existing GitHub Release tag to publish.
        required: true
        type: string
```

Use the same expression for every non-shell release-tag consumer:

```yaml
ref: ${{ github.event.release.tag_name || inputs.tag }}
```

Set `TAG` in `Resolve release info` to that expression. Treat only a `release`
event as carrying `github.event.release.prerelease`; query `gh release view
"$TAG" --json isPrerelease -q .isPrerelease` for both `workflow_call` and
`workflow_dispatch`.

After `Build and push Docker image`, add:

```yaml
      - name: Verify published image tags
        env:
          IMAGE: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          TAG: ${{ github.event.release.tag_name || inputs.tag }}
          IS_PRERELEASE: ${{ steps.release_info.outputs.prerelease }}
        run: |
          VERSION="${TAG#v}"
          tags=("$TAG" "$VERSION")
          if [ "$IS_PRERELEASE" != "true" ]; then
            tags+=("${VERSION%.*}" latest)
          fi

          for tag in "${tags[@]}"; do
            for attempt in 1 2 3 4 5 6; do
              if docker buildx imagetools inspect "$IMAGE:$tag" > /dev/null; then
                echo "Verified $IMAGE:$tag"
                break
              fi

              if [ "$attempt" = "6" ]; then
                echo "::error::Timed out waiting for $IMAGE:$tag"
                exit 1
              fi

              echo "Waiting for $IMAGE:$tag (attempt $attempt of 6)"
              sleep 10
            done
          done
```

- [ ] **Step 4: Make `release.yml` wait for publishing**

Remove the `actions: write` permission from the `release` job and delete its
`Trigger Docker publish` step. Add this peer job after `release`:

```yaml
  publish:
    name: Publish and verify Docker image
    needs: release
    permissions:
      contents: read
      packages: write
    uses: ./.github/workflows/publish.yml
    with:
      tag: v${{ inputs.version }}
    secrets: inherit
```

The `release` job creates the existing tag and GitHub Release first. A failure
in the `publish` job therefore preserves those artifacts and marks the parent
workflow failed, allowing a manual rerun of `publish.yml` for the same tag.

- [ ] **Step 5: Run the focused test to verify it passes**

Run: `npm test -- src/__tests__/workflows/publish.test.ts`

Expected: PASS with all parser assertions proving the synchronous reusable
workflow call and post-push verification contract.

- [ ] **Step 6: Commit the functional change**

```bash
git add .github/workflows/publish.yml .github/workflows/release.yml src/__tests__/workflows/publish.test.ts
git commit -m "fix: verify Docker publication before release succeeds"
```

### Task 2: Document verified publishing and recovery

**Files:**
- Modify: `AGENTS.md:85-89`
- Modify: `docs/DOCKER_RELEASES.md:13-26,92-113,185-216`

**Interfaces:**
- Consumes: the release contract from Task 1.
- Produces: maintainer instructions that define a completed release as a
  completed GHCR publish plus manifest verification.

- [ ] **Step 1: Update the concise release process**

Replace the asynchronous-dispatch explanation in `AGENTS.md` with these facts:

```markdown
4. **Docker publish and verification**: after the tag and GitHub Release are
   created, `release.yml` calls `publish.yml` as a dependent reusable workflow.
   It pushes the image and verifies its GHCR manifests before the release run
   can succeed. Human-created GitHub Releases still trigger `publish.yml` via
   `release: published`; it remains manually runnable for recovery.
5. **Verify**: a successful Create Release run already includes Docker
   publication verification. Confirm the tag/release and inspect GHCR when
   needed; expected stable tags are `vX.Y.Z`, `X.Y.Z`, `X.Y`, and `latest`.
```

- [ ] **Step 2: Update the detailed Docker release guide**

Change the workflow overview, Step 2/3 instructions, trigger description, and
troubleshooting text so they state:

1. `release.yml` waits on `publish.yml` through `workflow_call`.
2. The post-push check retries GHCR manifest inspection for all expected tags.
3. A failed release run can leave an intentional, visible incomplete release;
   correct the cause and manually run `publish.yml` with its existing `vX.Y.Z`
   tag, then confirm the required tags.
4. A GitHub UI release keeps its normal `release: published` route and performs
   the same verification within `publish.yml`.

- [ ] **Step 3: Verify documentation formatting and links**

Run: `git diff --check && rg -n "dispatches `publish.yml`|gh workflow run publish.yml|workflow_call|incomplete release" AGENTS.md docs/DOCKER_RELEASES.md`

Expected: no whitespace errors; the obsolete dispatch wording is gone and the
new synchronous/recovery wording appears in both documents.

- [ ] **Step 4: Commit the documentation**

```bash
git add AGENTS.md docs/DOCKER_RELEASES.md
git commit -m "docs: describe verified Docker releases"
```

### Task 3: Perform final validation and open the change for review

**Files:**
- Verify: `.github/workflows/publish.yml`
- Verify: `.github/workflows/release.yml`
- Verify: `src/__tests__/workflows/publish.test.ts`
- Verify: `AGENTS.md`
- Verify: `docs/DOCKER_RELEASES.md`

**Interfaces:**
- Consumes: the functional and documentation changes from Tasks 1 and 2.
- Produces: a clean, validated branch suitable for a PR into `main`.

- [ ] **Step 1: Run focused workflow tests**

Run: `npm test -- src/__tests__/workflows/publish.test.ts`

Expected: PASS.

- [ ] **Step 2: Run the complete unit suite and lint**

Run: `npm test && npm run lint`

Expected: all unit tests pass; lint exits successfully. Report pre-existing
warnings separately if any remain.

- [ ] **Step 3: Validate the final diff and branch state**

Run: `git diff origin/main...HEAD --check && git status --short --branch && git log --oneline origin/main..HEAD`

Expected: no whitespace errors, no unrelated files, and only the design, plan,
workflow/test, and documentation commits on the branch.

- [ ] **Step 4: Push and open a PR**

```bash
git push -u origin codex/synchronous-release-publish
gh pr create --base main --head codex/synchronous-release-publish \
  --title "fix: verify Docker publication before release succeeds" \
  --body "Makes Docker publishing a synchronous release dependency and verifies expected GHCR tags after each push."
```
