#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: GitHub CLI (gh) is required to verify pull-request CI." >&2
  exit 1
fi

BRANCH=$(git branch --show-current)
if [ -z "$BRANCH" ] || [ "$BRANCH" = "main" ]; then
  echo "Error: PR CI validation requires a pushed feature branch." >&2
  exit 1
fi

HEAD_SHA=$(git rev-parse HEAD)
REPOSITORY=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')

remote_head_sha() {
  remote_ref=$(git ls-remote origin "refs/heads/$BRANCH")
  if [ -z "$remote_ref" ]; then
    return 1
  fi
  set -- $remote_ref
  printf '%s\n' "$1"
}

find_pr_number() {
  MATCHING_PR_NUMBERS=$(gh pr list \
    --repo "$REPOSITORY" \
    --head "$BRANCH" \
    --state open \
    --json number,headRefOid \
    --jq '.[] | select(.headRefOid == "'"$HEAD_SHA"'") | .number') || exit 1
  set -- $MATCHING_PR_NUMBERS
  case $# in
    0) return 0 ;;
    1) printf '%s\n' "$1" ;;
    *)
      echo "Error: multiple open PRs match origin/$BRANCH at commit $HEAD_SHA:" >&2
      printf '  #%s\n' "$@" >&2
      return 1
      ;;
  esac
}

PR_NUMBER=$(find_pr_number) || exit 1
if [ -z "$PR_NUMBER" ]; then
  echo "Error: no open PR for origin/$BRANCH at commit $HEAD_SHA." >&2
  echo "Open or update the PR, then rerun npm run check:pr so its CI can be verified." >&2
  exit 1
fi

require_current_pr_head() {
  REMOTE_SHA=$(remote_head_sha) || return 1
  if [ "$REMOTE_SHA" != "$HEAD_SHA" ]; then
    echo "Error: origin/$BRANCH no longer points to $HEAD_SHA." >&2
    return 1
  fi

  CURRENT_PR_HEAD=$(gh pr view "$PR_NUMBER" --repo "$REPOSITORY" --json headRefOid,state --jq 'if .state == "OPEN" then .headRefOid else empty end') || exit 1
  if [ "$CURRENT_PR_HEAD" != "$HEAD_SHA" ]; then
    echo "Error: PR #$PR_NUMBER no longer has $HEAD_SHA as its open head." >&2
    return 1
  fi
}

if ! require_current_pr_head; then
  echo "Push the intended commit and update/open its PR before verifying CI." >&2
  exit 1
fi

TIMEOUT_SECONDS=${CHECK_PR_CI_TIMEOUT_SECONDS:-1800}
POLL_SECONDS=${CHECK_PR_CI_POLL_SECONDS:-10}
case $TIMEOUT_SECONDS in ''|*[!0-9]*) echo "Error: CHECK_PR_CI_TIMEOUT_SECONDS must be a positive integer." >&2; exit 1;; esac
case $POLL_SECONDS in ''|*[!0-9]*) echo "Error: CHECK_PR_CI_POLL_SECONDS must be a positive integer." >&2; exit 1;; esac
if [ "$TIMEOUT_SECONDS" -eq 0 ] || [ "$POLL_SECONDS" -eq 0 ]; then
  echo "Error: CI timeout and poll interval must be greater than zero." >&2
  exit 1
fi

run_belongs_to_pr() {
  candidate_id=$1
  RUN_EVENT=$(gh api "repos/$REPOSITORY/actions/runs/$candidate_id" --jq '.event') || exit 1
  RUN_BRANCH=$(gh api "repos/$REPOSITORY/actions/runs/$candidate_id" --jq '.head_branch') || exit 1
  RUN_HEAD=$(gh api "repos/$REPOSITORY/actions/runs/$candidate_id" --jq '.head_sha') || exit 1
  RUN_PR_PAIR=$(gh api "repos/$REPOSITORY/actions/runs/$candidate_id" --jq '.pull_requests[]? | "\(.number) \(.head.sha)"') || exit 1
  RUN_WORKFLOW_ID=$(gh api "repos/$REPOSITORY/actions/runs/$candidate_id" --jq '.workflow_id') || exit 1
  RUN_WORKFLOW_PATH=$(gh api "repos/$REPOSITORY/actions/workflows/$RUN_WORKFLOW_ID" --jq '.path') || exit 1

  [ "$RUN_EVENT" = "pull_request" ] && \
    [ "$RUN_BRANCH" = "$BRANCH" ] && \
    [ "$RUN_HEAD" = "$HEAD_SHA" ] && \
    [ "$RUN_PR_PAIR" = "$PR_NUMBER $HEAD_SHA" ] && \
    [ "$RUN_WORKFLOW_PATH" = ".github/workflows/ci.yml" ]
}

find_latest_ci_run() {
  CANDIDATES=$(gh run list \
    --repo "$REPOSITORY" \
    --workflow ci.yml \
    --branch "$BRANCH" \
    --commit "$HEAD_SHA" \
    --event pull_request \
    --limit 100 \
    --json databaseId,headSha,updatedAt,attempt \
    --jq '.[] | select(.headSha == "'"$HEAD_SHA"'") | [.databaseId, .attempt, .updatedAt] | @tsv') || exit 1

  LATEST_ID=
  LATEST_ATTEMPT=
  LATEST_UPDATED_AT=
  while IFS='	' read -r candidate_id candidate_attempt candidate_updated_at; do
    [ -n "$candidate_id" ] || continue
    if run_belongs_to_pr "$candidate_id"; then
      if [ -z "$LATEST_ID" ] || [ "$candidate_updated_at" \> "$LATEST_UPDATED_AT" ]; then
        LATEST_ID=$candidate_id
        LATEST_ATTEMPT=$candidate_attempt
        LATEST_UPDATED_AT=$candidate_updated_at
      fi
    fi
  done <<EOF_CANDIDATES
$CANDIDATES
EOF_CANDIDATES

  if [ -n "$LATEST_ID" ]; then
    printf '%s %s %s\n' "$LATEST_ID" "$LATEST_ATTEMPT" "$LATEST_UPDATED_AT"
  fi
}

print_jobs() {
  gh run view "$1" --repo "$REPOSITORY" --json jobs \
    --jq '.jobs[] | "  \(.name): \(.status) / \(.conclusion // \"pending\")"'
}

run_started_at=$(date +%s)
RUN_ID=
RUN_TOKEN=
while :; do
  now=$(date +%s)
  elapsed=$((now - run_started_at))
  if [ "$elapsed" -ge "$TIMEOUT_SECONDS" ]; then
    echo "Error: timed out after ${TIMEOUT_SECONDS}s waiting for CI workflow on PR #$PR_NUMBER at $HEAD_SHA." >&2
    exit 1
  fi

  LATEST_RUN_TOKEN=$(find_latest_ci_run)
  if [ -z "$LATEST_RUN_TOKEN" ]; then
    echo "==> Waiting for CI workflow on PR #$PR_NUMBER at $HEAD_SHA"
    sleep "$POLL_SECONDS"
    continue
  fi
  if [ "$RUN_TOKEN" != "$LATEST_RUN_TOKEN" ]; then
    set -- $LATEST_RUN_TOKEN
    RUN_ID=$1
    RUN_TOKEN=$LATEST_RUN_TOKEN
    echo "==> Verifying latest CI run $RUN_ID for PR #$PR_NUMBER at $HEAD_SHA"
  fi


  RUN_STATUS=$(gh run view "$RUN_ID" --repo "$REPOSITORY" --json status --jq '.status')
  if [ "$RUN_STATUS" != "completed" ]; then
    echo "==> CI run $RUN_ID is $RUN_STATUS"
    sleep "$POLL_SECONDS"
    continue
  fi

  RUN_CONCLUSION=$(gh run view "$RUN_ID" --repo "$REPOSITORY" --json conclusion --jq '.conclusion // "pending"')
  if [ "$RUN_CONCLUSION" != "success" ]; then
    echo "Error: CI run $RUN_ID concluded '$RUN_CONCLUSION'." >&2
    print_jobs "$RUN_ID" >&2
    exit 1
  fi

  failed=0
  while IFS= read -r job_name; do
    [ -n "$job_name" ] || continue
    job_count=$(gh run view "$RUN_ID" --repo "$REPOSITORY" --json jobs \
      --jq '[.jobs[] | select(.name == "'"$job_name"'")] | length')
    if [ "$job_count" -ne 1 ]; then
      echo "Error: required CI job '$job_name' is missing or ambiguous for run $RUN_ID." >&2
      failed=1
    else
      job_conclusion=$(gh run view "$RUN_ID" --repo "$REPOSITORY" --json jobs \
        --jq '.jobs[] | select(.name == "'"$job_name"'") | .conclusion // "pending"')
      if [ "$job_conclusion" != "success" ]; then
        echo "Error: required CI job '$job_name' concluded '$job_conclusion' for run $RUN_ID." >&2
        failed=1
      fi
    fi
  done <<'EOF_JOBS'
Lint
Type-check
Unit tests
E2E
EOF_JOBS

  if [ "$failed" -ne 0 ]; then
    echo "CI job summary:" >&2
    print_jobs "$RUN_ID" >&2
    exit 1
  fi

  if ! require_current_pr_head; then
    echo "Error: branch or PR head changed while CI was being verified." >&2
    exit 1
  fi
  if [ "$(find_latest_ci_run)" != "$RUN_TOKEN" ]; then
    echo "==> A newer matching CI run or attempt appeared; verifying it instead"
    RUN_ID=
    RUN_TOKEN=
    continue
  fi

  echo "Required CI jobs passed for PR #$PR_NUMBER at $HEAD_SHA."
  exit 0
done
