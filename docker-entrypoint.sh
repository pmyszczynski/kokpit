#!/bin/sh
set -e

# Fix ownership of the data volume so the nextjs user can read/write it.
# Runs as root, then immediately drops privileges via su-exec.
chown -R nextjs:nodejs /data

exec su-exec nextjs node server.js
