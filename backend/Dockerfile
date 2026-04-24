# =============================================================================
# backend/Dockerfile  (v2.5)
#
# Key fix: Prisma query engine is BUNDLED at build time via binaryTargets in
# schema.prisma. The runner stage copies the .so from node_modules and sets
# PRISMA_QUERY_ENGINE_LIBRARY so Prisma never downloads anything at runtime.
# The backend container has no internet access (internal Docker networks).
#
# Privilege model:
#   Container starts as root → reads Docker secrets (0400 root:root) →
#   runs migrations → exec su-exec appuser node dist/app.js
# =============================================================================

# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# openssl needed by Prisma during `prisma generate` in the build stage
RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Generate Prisma client + download both native AND linux-musl engine binaries
# (binaryTargets = ["native", "linux-musl-openssl-3.0.x"] in schema.prisma)
RUN npx prisma generate

RUN npm run build
RUN npm prune --omit=dev


# ── Stage 2: runner ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

# openssl:           Prisma engine .so runtime dependency
# tini:              correct PID-1 / signal forwarding
# postgresql-client: pg_isready + psql used in docker-entrypoint.sh
# su-exec:           privilege drop (gosu equivalent for Alpine)
RUN apk add --no-cache openssl tini postgresql-client su-exec

WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# App files from builder
COPY --from=builder /app/dist          ./dist
COPY --from=builder /app/node_modules  ./node_modules
COPY --from=builder /app/prisma        ./prisma
COPY --from=builder /app/package.json  ./

# Entrypoint script
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Give appuser ownership of the working directory
RUN chown -R appuser:appgroup /app

# Point Prisma at the pre-bundled linux-musl engine so it never goes to the internet
ENV PRISMA_QUERY_ENGINE_LIBRARY=/app/node_modules/.prisma/client/libquery_engine-linux-musl-openssl-3.0.x.so.node
ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1

# Start as root (required to read Docker secrets mounted 0400 root:root)
# docker-entrypoint.sh drops to appuser before exec-ing node
USER root

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=5 \
  CMD wget -qO- http://localhost:3001/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["./docker-entrypoint.sh"]
