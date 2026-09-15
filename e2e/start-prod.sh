#!/bin/sh
set -e

STANDALONE=$(find .next/standalone -name 'server.js' | grep -v node_modules | head -1)
if [ -z "$STANDALONE" ]; then
  echo "Error: server.js not found in .next/standalone" >&2
  exit 1
fi
STANDALONE_DIR=$(dirname "$STANDALONE")
RUNTIME_DIR=$(mktemp -d /tmp/kokpit-standalone.XXXXXX)

cleanup() {
  status=$?
  rm -rf "$RUNTIME_DIR"
  exit "$status"
}

terminate() {
  signal_status=$1
  trap - INT TERM
  if [ -n "${SERVER_PID:-}" ]; then
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  exit "$signal_status"
}

trap cleanup EXIT
trap 'terminate 130' INT
trap 'terminate 143' TERM

# Run a copy outside the repository so Node cannot resolve missing standalone
# dependencies through the source checkout's node_modules directory.
cp -R "$STANDALONE_DIR/." "$RUNTIME_DIR/"
mkdir -p "$RUNTIME_DIR/.next"
cp -R .next/static "$RUNTIME_DIR/.next/"
cp -R public "$RUNTIME_DIR/"

cd "$RUNTIME_DIR"
unset NODE_PATH
node server.js &
SERVER_PID=$!
wait "$SERVER_PID"
