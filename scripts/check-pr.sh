#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

require_clean_worktree() {
  phase=$1
  changes=$(git status --porcelain --untracked-files=all)
  if [ -n "$changes" ]; then
    echo "Error: npm run check:pr requires a clean worktree $phase validation." >&2
    echo "$changes" >&2
    return 1
  fi
}

finish() {
  status=$?
  trap - EXIT
  if ! require_clean_worktree "after"; then
    status=1
  fi
  exit "$status"
}

require_clean_worktree "before"
trap finish EXIT

# Match CI behavior and prevent Playwright from reusing a stale local server.
export CI=true

echo "==> Lint"
npm run lint

echo "==> Type-check"
npm run type-check

echo "==> Unit tests with coverage"
npm run test:coverage

echo "==> Non-visual E2E tests"
npm run test:e2e:nonvisual

echo "==> Auth E2E tests"
npm run test:e2e:auth

echo "==> Ubuntu visual baseline validation"
sh scripts/check-visual-ci.sh
