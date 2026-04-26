#!/bin/sh
# =============================================================================
# docker-entrypoint.sh  (v2.5)
# Runs as root: reads secrets → migrates → drops to appuser for node server.
# =============================================================================
set -e

# ── 0. Point Prisma at the pre-bundled engine (no internet download needed) ──
export PRISMA_QUERY_ENGINE_LIBRARY=/app/node_modules/.prisma/client/libquery_engine-linux-musl-openssl-3.0.x.so.node
export PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1

# ── 1. Read Docker secrets (root-only 0400 files) ────────────────────────────
if [ -f /run/secrets/db_password ]; then
  DB_PASSWORD=$(cat /run/secrets/db_password)
  export DB_PASSWORD
  echo "[entrypoint] DB password loaded from secret."
else
  DB_PASSWORD="${DB_PASSWORD:-san_secret}"
  export DB_PASSWORD
  echo "[entrypoint] WARNING: /run/secrets/db_password not found — using env fallback."
fi

if [ -f /run/secrets/mds_password ]; then
  MDS_PASSWORD=$(cat /run/secrets/mds_password)
  export MDS_PASSWORD
  echo "[entrypoint] MDS password loaded from secret."
else
  MDS_PASSWORD="${MDS_PASSWORD:-}"
  export MDS_PASSWORD
fi

# Prisma DATABASE_URL assembled from individual env vars
export DATABASE_URL="postgresql://${DB_USER:-san_admin}:${DB_PASSWORD}@${DB_HOST:-db}:${DB_PORT:-5432}/${DB_NAME:-san_zoning}"

echo "[entrypoint] Backend starting | DB: ${DB_HOST:-db}:${DB_PORT:-5432}/${DB_NAME:-san_zoning}"

# ── 2. Wait for Postgres ─────────────────────────────────────────────────────
echo "[entrypoint] Waiting for database…"
MAX=30; N=0
until pg_isready -h "${DB_HOST:-db}" -p "${DB_PORT:-5432}" -U "${DB_USER:-san_admin}" -q; do
  N=$((N+1))
  [ "$N" -ge "$MAX" ] && echo "[entrypoint] ERROR: DB not ready after ${MAX} attempts." && exit 1
  echo "[entrypoint] Retrying (${N}/${MAX})…"
  sleep 3
done
echo "[entrypoint] Database is ready."

# ── 3. Prisma migrations ─────────────────────────────────────────────────────
echo "[entrypoint] Running Prisma migrations…"
npx prisma migrate deploy
echo "[entrypoint] Migrations complete."

# ── 4. TimescaleDB hypertable setup (idempotent) ─────────────────────────────
echo "[entrypoint] Applying TimescaleDB hypertable setup…"
PGPASSWORD="${DB_PASSWORD}" psql \
  -h "${DB_HOST:-db}" \
  -p "${DB_PORT:-5432}" \
  -U "${DB_USER:-san_admin}" \
  -d "${DB_NAME:-san_zoning}" \
  -f /app/prisma/02-hypertable.sql \
  2>&1 | grep -v "^NOTICE" | grep -v "^$" || true
echo "[entrypoint] TimescaleDB setup complete."

# Fix continuous aggregate refresh policies on existing installations.
# Removes the old too-narrow 1h policy (start=2h, end=1h = only 1 bucket)
# and replaces it with the correct window (start=4h, end=2h = 2 buckets min).
echo "[entrypoint] Verifying continuous aggregate policies…"
PGPASSWORD="${DB_PASSWORD}" psql \
  -h "${DB_HOST:-db}" \
  -p "${DB_PORT:-5432}" \
  -U "${DB_USER:-san_admin}" \
  -d "${DB_NAME:-san_zoning}" \
  -c "
    DO \$\$
    BEGIN
      -- Remove the old too-narrow policy if it exists, then re-add with correct window
      PERFORM remove_continuous_aggregate_policy('port_metrics_1h', if_exists => TRUE);
      PERFORM add_continuous_aggregate_policy('port_metrics_1h',
        start_offset      => INTERVAL '4 hours',
        end_offset        => INTERVAL '2 hours',
        schedule_interval => INTERVAL '1 hour',
        if_not_exists     => TRUE);
      RAISE NOTICE 'port_metrics_1h policy updated (start=4h end=2h).';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'port_metrics_1h policy: %', SQLERRM;
    END \$\$;
  " 2>&1 | grep -v "^NOTICE" | grep -v "^$" || true
echo "[entrypoint] Policy check complete."

# ── 5. Optional demo seed ─────────────────────────────────────────────────────
if [ "${SAN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] Seeding demo data…"
  npx tsx prisma/seed.ts 2>&1 || echo "[entrypoint] Seed skipped (data may already exist)."
fi

# ── 6. Drop privileges → exec API server ─────────────────────────────────────
echo "[entrypoint] Dropping to appuser — starting API on port ${PORT:-3001}…"
exec su-exec appuser node dist/app.js
