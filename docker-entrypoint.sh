#!/bin/sh
set -e

mkdir -p /data

if [ "$(stat -c '%U:%G' /data)" != "nextjs:nodejs" ]; then
  chown -R nextjs:nodejs /data
fi

# If the Docker socket is mounted (for the docker widget), let the non-root
# runtime user read it by joining the group that owns the socket.
if [ -S /var/run/docker.sock ]; then
  SOCK_GID=$(stat -c '%g' /var/run/docker.sock)
  if [ "$SOCK_GID" = "0" ]; then
    echo "WARN: /var/run/docker.sock is owned by GID 0; the docker widget cannot read it as a non-root user." >&2
    echo "WARN: Use a socket proxy (e.g. docker-socket-proxy) or a socket with a dedicated docker group — see README." >&2
  else
    if ! getent group "$SOCK_GID" >/dev/null 2>&1; then
      addgroup -g "$SOCK_GID" dockersock
    fi
    SOCK_GRP=$(getent group "$SOCK_GID" | cut -d: -f1)
    addgroup nextjs "$SOCK_GRP" 2>/dev/null || true
  fi
fi

exec su-exec nextjs "$@"
