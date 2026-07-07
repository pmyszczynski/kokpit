#!/bin/sh
set -e

mkdir -p /data

if [ "$(stat -c '%U:%G' /data)" != "nextjs:nodejs" ]; then
  chown -R nextjs:nodejs /data
fi

# If the Docker socket is mounted (for the docker widget), let the non-root
# runtime user read it by joining the group that owns the socket. Honors the
# same KOKPIT_DOCKER_SOCKET override the widget uses.
SOCK_PATH="${KOKPIT_DOCKER_SOCKET:-/var/run/docker.sock}"
if [ -S "$SOCK_PATH" ]; then
  SOCK_GID=$(stat -c '%g' "$SOCK_PATH")
  if [ "$SOCK_GID" = "0" ]; then
    echo "WARN: $SOCK_PATH is owned by GID 0; the docker widget cannot read it as a non-root user." >&2
    echo "WARN: Use a socket with a dedicated docker group, or adjust its permissions — see README." >&2
  else
    if ! getent group "$SOCK_GID" >/dev/null 2>&1; then
      addgroup -g "$SOCK_GID" dockersock
    fi
    SOCK_GRP=$(getent group "$SOCK_GID" | cut -d: -f1)
    addgroup nextjs "$SOCK_GRP" 2>/dev/null || true
  fi
fi

exec su-exec nextjs "$@"
