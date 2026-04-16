#!/bin/sh
set -e

mkdir -p /data

if [ "$(stat -c '%U:%G' /data)" != "nextjs:nodejs" ]; then
  chown -R nextjs:nodejs /data
fi

exec su-exec nextjs "$@"
