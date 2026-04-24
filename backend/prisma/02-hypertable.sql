-- =============================================================================
-- 02-hypertable.sql
-- Converts port_metrics to a TimescaleDB hypertable and sets up continuous
-- aggregates, compression, and retention policies.
-- Runs AFTER Prisma migrations have created the tables.
-- Fully idempotent — safe to re-run on every container restart.
--
-- Policy window rules (TimescaleDB requirement):
--   start_offset - end_offset  must span at least 2 bucket widths.
--   1h bucket  → window ≥ 2h  → use start=4h, end=2h  (window=2h = 2 buckets)
--   15m bucket → window ≥ 30m → use start=3h, end=15m  (window=2h45m = 11 buckets)
-- =============================================================================

-- Convert port_metrics to a hypertable (1-day chunks)
SELECT create_hypertable(
  'port_metrics',
  'timestamp',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists       => TRUE,
  migrate_data        => TRUE
);

-- Compression settings
ALTER TABLE port_metrics SET (
  timescaledb.compress,
  timescaledb.compress_orderby   = 'timestamp DESC',
  timescaledb.compress_segmentby = 'switch_id, interface_name'
);

-- Compression policy (7 days) — idempotent
DO $$
BEGIN
  PERFORM add_compression_policy('port_metrics', INTERVAL '7 days', if_not_exists => TRUE);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Compression policy already set or error: %', SQLERRM;
END $$;

-- Retention policy (90 days) — idempotent
DO $$
BEGIN
  PERFORM add_retention_policy('port_metrics', INTERVAL '90 days', if_not_exists => TRUE);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Retention policy already set or error: %', SQLERRM;
END $$;

-- 15-minute continuous aggregate — only create if missing
-- Window: start=3h, end=15m → 2h45m = 11 × 15min buckets ✓
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.continuous_aggregates
    WHERE view_name = 'port_metrics_15m'
  ) THEN
    EXECUTE $sql$
      CREATE MATERIALIZED VIEW port_metrics_15m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('15 minutes', timestamp) AS bucket,
        switch_id,
        interface_name,
        AVG(tx_rate_bps)  AS avg_tx_bps,
        AVG(rx_rate_bps)  AS avg_rx_bps,
        MAX(crc_errors)   AS max_crc_errors,
        AVG(rx_power_dbm) AS avg_rx_power_dbm,
        AVG(temperature)  AS avg_temperature
      FROM port_metrics
      GROUP BY bucket, switch_id, interface_name
      WITH NO DATA
    $sql$;
    PERFORM add_continuous_aggregate_policy('port_metrics_15m',
      start_offset      => INTERVAL '3 hours',
      end_offset        => INTERVAL '15 minutes',
      schedule_interval => INTERVAL '15 minutes');
    RAISE NOTICE 'Created port_metrics_15m continuous aggregate.';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'port_metrics_15m aggregate error (may already exist): %', SQLERRM;
END $$;

-- Hourly continuous aggregate — only create if missing
-- Window: start=4h, end=2h → 2h = 2 × 1h buckets ✓ (minimum valid window)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.continuous_aggregates
    WHERE view_name = 'port_metrics_1h'
  ) THEN
    EXECUTE $sql$
      CREATE MATERIALIZED VIEW port_metrics_1h
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('1 hour', timestamp) AS bucket,
        switch_id,
        interface_name,
        AVG(tx_rate_bps)  AS avg_tx_bps,
        AVG(rx_rate_bps)  AS avg_rx_bps,
        MAX(crc_errors)   AS max_crc_errors,
        AVG(rx_power_dbm) AS avg_rx_power_dbm
      FROM port_metrics
      GROUP BY bucket, switch_id, interface_name
      WITH NO DATA
    $sql$;
    PERFORM add_continuous_aggregate_policy('port_metrics_1h',
      start_offset      => INTERVAL '4 hours',
      end_offset        => INTERVAL '2 hours',
      schedule_interval => INTERVAL '1 hour');
    RAISE NOTICE 'Created port_metrics_1h continuous aggregate.';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'port_metrics_1h aggregate error (may already exist): %', SQLERRM;
END $$;

-- Performance indexes (all idempotent)
CREATE INDEX IF NOT EXISTS idx_port_metrics_iface_ts
  ON port_metrics (switch_id, interface_name, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_zoning_snapshots_lookup
  ON zoning_snapshots (switch_id, vsan_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_zones_switch_vsan
  ON zones (switch_id, vsan_id);

CREATE INDEX IF NOT EXISTS idx_zone_sets_active
  ON zone_sets (switch_id, vsan_id, is_active);

CREATE INDEX IF NOT EXISTS idx_fc_aliases_wwn
  ON fc_aliases (wwn);
