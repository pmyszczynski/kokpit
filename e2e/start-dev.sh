#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE_CONFIG="$ROOT_DIR/e2e/fixtures/settings.yaml"
RUNTIME_DIR="$ROOT_DIR/test-results/runtime"
RUNTIME_CONFIG="$RUNTIME_DIR/settings.yaml"

if [ ! -f "$SOURCE_CONFIG" ]; then
  echo "Error: E2E fixture not found: $SOURCE_CONFIG" >&2
  exit 1
fi

mkdir -p "$RUNTIME_DIR"
rm -f "$RUNTIME_CONFIG.pre-fixed-grid.bak" "$RUNTIME_CONFIG.pre-v2.bak" "$RUNTIME_CONFIG.v1.bak"
cp "$SOURCE_CONFIG" "$RUNTIME_CONFIG"

export KOKPIT_CONFIG_PATH="$RUNTIME_CONFIG"
cd "$ROOT_DIR"
exec npm run dev
