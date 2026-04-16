# ─────────────────────────────────────────────────────────────
# Kokpit — Multi-stage Dockerfile
#
# Stages:
#   base    → shared Node.js Alpine setup
#   deps    → install all dependencies (cached layer)
#   dev     → development with hot reload (used by docker-compose.yml)
#   builder → production build
#   runner  → minimal production image (~90 MB)
# ─────────────────────────────────────────────────────────────

# ── Stage: base ───────────────────────────────────────────────
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat


# ── Stage: deps ───────────────────────────────────────────────
# Install dependencies once; cache this layer aggressively.
# better-sqlite3 (and similar) compile on Alpine — need node-gyp toolchain.
FROM base AS deps
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci


# ── Stage: dev ────────────────────────────────────────────────
# Used exclusively by docker-compose.yml (dev service).
# Source is volume-mounted; node_modules come from the image.
FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
EXPOSE 3000
CMD ["npm", "run", "dev"]


# ── Stage: builder ────────────────────────────────────────────
FROM base AS builder
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next.config.ts sets output: 'standalone'
# This produces .next/standalone/ (minimal runtime) + .next/static/
RUN npm run build


# ── Stage: runner ─────────────────────────────────────────────
# Final image — only what the Next.js standalone runtime needs.
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV KOKPIT_CONFIG_PATH=/data/settings.yaml
ENV KOKPIT_DB_PATH=/data/users.db

# OCI image metadata
LABEL org.opencontainers.image.title="Kokpit"
LABEL org.opencontainers.image.description="A self-hosted homelab dashboard with live status indicators and YAML-driven configuration"
LABEL org.opencontainers.image.source="https://github.com/pmyszczynski/kokpit"
LABEL org.opencontainers.image.documentation="https://github.com/pmyszczynski/kokpit"
LABEL org.opencontainers.image.vendor="pmyszczynski"
LABEL org.opencontainers.image.licenses="MIT"

# Non-root user for security
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs \
 && apk add --no-cache su-exec

COPY --from=builder /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --chmod=755 docker-entrypoint.sh ./

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
