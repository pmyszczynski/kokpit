#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: GitHub CLI (gh) is required for CI-rendered visual validation." >&2
  exit 1
fi

BRANCH=$(git branch --show-current)
if [ -z "$BRANCH" ] || [ "$BRANCH" = "main" ]; then
  echo "Error: visual CI validation requires a pushed feature branch." >&2
  exit 1
fi

HEAD_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git ls-remote origin "refs/heads/$BRANCH" | awk 'NR == 1 { print $1 }')
if [ "$REMOTE_SHA" != "$HEAD_SHA" ]; then
  echo "Error: push commit $HEAD_SHA to origin/$BRANCH before npm run check:pr." >&2
  exit 1
fi

REPOSITORY=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
WORKFLOW=update-playwright-snapshots.yml

find_run() {
  gh run list \
    --repo "$REPOSITORY" \
    --workflow "$WORKFLOW" \
    --branch "$BRANCH" \
    --commit "$HEAD_SHA" \
    --event workflow_dispatch \
    --limit 1 \
    --json databaseId \
    --jq '.[0].databaseId // empty'
}

RUN_ID=$(find_run)
if [ -z "$RUN_ID" ]; then
  echo "==> Triggering Ubuntu Playwright snapshot validation"
  gh workflow run "$WORKFLOW" --repo "$REPOSITORY" --ref "$BRANCH"

  attempts=0
  while [ -z "$RUN_ID" ] && [ "$attempts" -lt 30 ]; do
    sleep 2
    RUN_ID=$(find_run)
    attempts=$((attempts + 1))
  done
fi

if [ -z "$RUN_ID" ]; then
  echo "Error: could not locate the snapshot workflow run for $HEAD_SHA." >&2
  exit 1
fi

echo "==> Waiting for Ubuntu snapshot run $RUN_ID"
gh run watch "$RUN_ID" --repo "$REPOSITORY" --exit-status

ARTIFACT_DIR="$ROOT_DIR/test-results/visual-ci"
rm -rf "$ARTIFACT_DIR"
mkdir -p "$ARTIFACT_DIR"
gh run download "$RUN_ID" \
  --repo "$REPOSITORY" \
  --name playwright-visual-snapshots \
  --dir "$ARTIFACT_DIR"

DIFF_OUTPUT=$(
  {
    diff -qr "$ARTIFACT_DIR/visual.spec.ts-snapshots" \
      "$ROOT_DIR/e2e/tests/visual.spec.ts-snapshots" || true
    diff -qr "$ARTIFACT_DIR/edit-mode.spec.ts-snapshots" \
      "$ROOT_DIR/e2e/tests/edit-mode.spec.ts-snapshots" || true
  }
)

if [ -n "$DIFF_OUTPUT" ]; then
  echo "Error: tracked Playwright baselines differ from Ubuntu CI:" >&2
  echo "$DIFF_OUTPUT" >&2
  echo "Download run $RUN_ID's playwright-visual-snapshots artifact, review it, and commit only the intended baseline changes." >&2
  exit 1
fi

echo "Ubuntu Playwright baselines match the tracked snapshots."
