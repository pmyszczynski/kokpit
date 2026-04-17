#!/bin/sh
set -e

npm run build

STANDALONE=$(find .next/standalone -name 'server.js' | grep -v node_modules | head -1)
if [ -z "$STANDALONE" ]; then
  echo "Error: server.js not found in .next/standalone" >&2
  exit 1
fi
STANDALONE_DIR=$(dirname "$STANDALONE")

# Mirror what the Dockerfile does: copy static assets into the standalone dir.
cp -r .next/static "$STANDALONE_DIR/.next/"
cp -r public "$STANDALONE_DIR/"

cd "$STANDALONE_DIR"
exec node server.js
