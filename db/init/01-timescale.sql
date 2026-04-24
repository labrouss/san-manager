-- =============================================================================
-- db/init/01-timescale.sql
-- Runs once on first container boot (postgres docker-entrypoint-initdb.d).
-- Sets up TimescaleDB extension and all performance tuning.
-- Prisma migrations create the actual tables; this file runs BEFORE them.
-- =============================================================================

-- TimescaleDB extension (must be created as superuser, which initdb runs as)
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- Tune shared_buffers and work_mem for a dedicated DB container
-- (These are advisory; the real knobs live in postgresql.conf)
ALTER SYSTEM SET max_connections = 100;
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '768MB';
ALTER SYSTEM SET work_mem = '16MB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET random_page_cost = 1.1;

-- Grant required privileges to the application user
GRANT ALL PRIVILEGES ON DATABASE san_zoning TO san_admin;
