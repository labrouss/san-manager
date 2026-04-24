-- =============================================================================
-- db/init/02-hypertable.sql  (runs on DB container first boot via initdb.d)
-- Same content as backend/prisma/02-hypertable.sql — keep in sync.
-- =============================================================================

SELECT create_hypertable(
  'port_metrics', 'timestamp',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists       => TRUE,
  migrate_data        => TRUE
);

ALTER TABLE port_metrics SET (
  timescaledb.compress,
  timescaledb.compress_orderby   = 'timestamp DESC',
  timescaledb.compress_segmentby = 'switch_id, interface_name'
);

DO $$
BEGIN
  PERFORM add_compression_policy('port_metrics', INTERVAL '7 days', if_not_exists => TRUE);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Compression policy: %', SQLERRM;
END $$;

DO $$
BEGIN
  PERFORM add_retention_policy('port_metrics', INTERVAL '90 days', if_not_exists => TRUE);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Retention policy: %', SQLERRM;
END $$;

-- 15m aggregate: window = 3h-15m = 2h45m = 11 buckets ✓
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
        switch_id, interface_name,
        AVG(tx_rate_bps) AS avg_tx_bps, AVG(rx_rate_bps) AS avg_rx_bps,
        MAX(crc_errors) AS max_crc_errors, AVG(rx_power_dbm) AS avg_rx_power_dbm,
        AVG(temperature) AS avg_temperature
      FROM port_metrics
      GROUP BY bucket, switch_id, interface_name
      WITH NO DATA
    $sql$;
    PERFORM add_continuous_aggregate_policy('port_metrics_15m',
      start_offset => INTERVAL '3 hours', end_offset => INTERVAL '15 minutes',
      schedule_interval => INTERVAL '15 minutes');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'port_metrics_15m: %', SQLERRM;
END $$;

-- 1h aggregate: window = 4h-2h = 2h = 2 buckets ✓ (minimum)
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
        switch_id, interface_name,
        AVG(tx_rate_bps) AS avg_tx_bps, AVG(rx_rate_bps) AS avg_rx_bps,
        MAX(crc_errors) AS max_crc_errors, AVG(rx_power_dbm) AS avg_rx_power_dbm
      FROM port_metrics
      GROUP BY bucket, switch_id, interface_name
      WITH NO DATA
    $sql$;
    PERFORM add_continuous_aggregate_policy('port_metrics_1h',
      start_offset => INTERVAL '4 hours', end_offset => INTERVAL '2 hours',
      schedule_interval => INTERVAL '1 hour');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'port_metrics_1h: %', SQLERRM;
END $$;

CREATE INDEX IF NOT EXISTS idx_port_metrics_iface_ts
  ON port_metrics (switch_id, interface_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_zoning_snapshots_lookup
  ON zoning_snapshots (switch_id, vsan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_zones_switch_vsan ON zones (switch_id, vsan_id);
CREATE INDEX IF NOT EXISTS idx_zone_sets_active ON zone_sets (switch_id, vsan_id, is_active);
CREATE INDEX IF NOT EXISTS idx_fc_aliases_wwn ON fc_aliases (wwn);
