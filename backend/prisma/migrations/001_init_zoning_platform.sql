-- =============================================================================
-- 001_init_zoning_platform.sql
-- Run AFTER prisma migrate deploy
-- =============================================================================

-- Enable TimescaleDB (superuser required)
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- Convert port_metrics to a TimescaleDB hypertable
SELECT create_hypertable(
  'port_metrics', 'timestamp',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE,
  migrate_data => TRUE
);

-- Compress chunks older than 7 days (~90% storage reduction)
ALTER TABLE port_metrics SET (
  timescaledb.compress,
  timescaledb.compress_orderby    = 'timestamp DESC',
  timescaledb.compress_segmentby  = 'switch_id, interface_name'
);
SELECT add_compression_policy('port_metrics', INTERVAL '7 days');

-- Retention: drop data older than 90 days
SELECT add_retention_policy('port_metrics', INTERVAL '90 days');

-- Continuous aggregate: 15-minute buckets for dashboard queries
CREATE MATERIALIZED VIEW port_metrics_15m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('15 minutes', timestamp)   AS bucket,
  switch_id,
  interface_name,
  AVG(tx_rate_bps)                        AS avg_tx_bps,
  AVG(rx_rate_bps)                        AS avg_rx_bps,
  MAX(crc_errors)                         AS max_crc_errors,
  AVG(rx_power_dbm)                       AS avg_rx_power_dbm,
  AVG(temperature)                        AS avg_temperature
FROM port_metrics
GROUP BY bucket, switch_id, interface_name
WITH NO DATA;

SELECT add_continuous_aggregate_policy('port_metrics_15m',
  start_offset      => INTERVAL '3 hours',
  end_offset        => INTERVAL '15 minutes',
  schedule_interval => INTERVAL '15 minutes'
);

-- Hourly rollup for 7-day view
CREATE MATERIALIZED VIEW port_metrics_1h
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', timestamp)       AS bucket,
  switch_id,
  interface_name,
  AVG(tx_rate_bps)                        AS avg_tx_bps,
  AVG(rx_rate_bps)                        AS avg_rx_bps,
  MAX(crc_errors)                         AS max_crc_errors,
  AVG(rx_power_dbm)                       AS avg_rx_power_dbm
FROM port_metrics
GROUP BY bucket, switch_id, interface_name
WITH NO DATA;

SELECT add_continuous_aggregate_policy('port_metrics_1h',
  start_offset      => INTERVAL '2 hours',
  end_offset        => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour'
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_port_metrics_iface_ts
  ON port_metrics (switch_id, interface_name, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_zoning_snapshots_switch_vsan_ts
  ON zoning_snapshots (switch_id, vsan_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fc_aliases_wwn
  ON fc_aliases (wwn);

CREATE INDEX IF NOT EXISTS idx_zones_switch_vsan
  ON zones (switch_id, vsan_id);

CREATE INDEX IF NOT EXISTS idx_zone_sets_active
  ON zone_sets (switch_id, vsan_id, is_active);

-- API query helper: time-bucketed metrics endpoint
-- The Express route calls this view via prisma.$queryRaw
CREATE OR REPLACE FUNCTION get_port_metrics_bucketed(
  p_switch_id     TEXT,
  p_interface     TEXT,
  p_window_hours  INT,
  p_bucket_mins   INT
)
RETURNS TABLE (
  bucket         TIMESTAMPTZ,
  avg_tx_bps     FLOAT,
  avg_rx_bps     FLOAT,
  max_crc_errors BIGINT,
  avg_rx_power   FLOAT
) LANGUAGE SQL STABLE AS $$
  SELECT
    time_bucket((p_bucket_mins || ' minutes')::INTERVAL, timestamp) AS bucket,
    AVG(tx_rate_bps)   AS avg_tx_bps,
    AVG(rx_rate_bps)   AS avg_rx_bps,
    MAX(crc_errors)    AS max_crc_errors,
    AVG(rx_power_dbm)  AS avg_rx_power
  FROM port_metrics
  WHERE
    switch_id      = p_switch_id
    AND interface_name = p_interface
    AND timestamp  >= NOW() - (p_window_hours || ' hours')::INTERVAL
  GROUP BY bucket
  ORDER BY bucket ASC;
$$;
