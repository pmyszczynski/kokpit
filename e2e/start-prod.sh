#!/bin/sh
set -e

npm run build

STANDALONE=$(find .next/standalone -name 'server.js' | grep -v node_modules | head -1)
STANDALONE_DIR=$(dirname "$STANDALONE")

# Mirror what the Dockerfile does: copy static assets into the standalone dir.
cp -r .next/static "$STANDALONE_DIR/.next/"
cp -r public "$STANDALONE_DIR/"

cd "$STANDALONE_DIR"
exec node server.js
