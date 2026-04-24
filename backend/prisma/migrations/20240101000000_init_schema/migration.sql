-- =============================================================================
-- Prisma Migration: 20240101000000_init_schema
-- Creates all tables for the SAN Management Platform.
-- This is a Prisma-managed migration file — do not edit manually.
-- TimescaleDB hypertable conversion runs AFTER this via 02-hypertable.sql.
-- =============================================================================

-- Enable TimescaleDB extension (created in 01-timescale.sql on DB init,
-- but we declare it here too so Prisma's extension tracking is satisfied)
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "ZoneMemberType" AS ENUM (
  'PWWN',
  'DEVICE_ALIAS',
  'FCID'
);

CREATE TYPE "SnapshotTrigger" AS ENUM (
  'PRE_COMMIT',
  'MANUAL',
  'SCHEDULED'
);

-- ---------------------------------------------------------------------------
-- switches
-- ---------------------------------------------------------------------------

CREATE TABLE "switches" (
  "id"            TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "ip_address"    TEXT NOT NULL,
  "hostname"      TEXT,
  "serial_number" TEXT,
  "model"         TEXT,
  "nxos_version"  TEXT,
  "is_active"     BOOLEAN NOT NULL DEFAULT true,
  "last_seen_at"  TIMESTAMPTZ,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "switches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "switches_ip_address_key" ON "switches"("ip_address");

-- ---------------------------------------------------------------------------
-- fc_aliases
-- ---------------------------------------------------------------------------

CREATE TABLE "fc_aliases" (
  "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "switch_id"   TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "wwn"         TEXT NOT NULL,
  "description" TEXT,
  "synced_at"   TIMESTAMPTZ,
  "is_orphaned" BOOLEAN NOT NULL DEFAULT false,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "fc_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fc_aliases_switch_id_wwn_key"  ON "fc_aliases"("switch_id", "wwn");
CREATE UNIQUE INDEX "fc_aliases_switch_id_name_key" ON "fc_aliases"("switch_id", "name");
CREATE INDEX        "fc_aliases_switch_id_idx"      ON "fc_aliases"("switch_id");

ALTER TABLE "fc_aliases"
  ADD CONSTRAINT "fc_aliases_switch_id_fkey"
  FOREIGN KEY ("switch_id") REFERENCES "switches"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- zones
-- ---------------------------------------------------------------------------

CREATE TABLE "zones" (
  "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "switch_id"   TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "vsan_id"     INTEGER NOT NULL,
  "description" TEXT,
  "is_draft"    BOOLEAN NOT NULL DEFAULT true,
  "synced_at"   TIMESTAMPTZ,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "zones_switch_id_name_vsan_id_key" ON "zones"("switch_id", "name", "vsan_id");
CREATE INDEX        "zones_switch_id_vsan_id_idx"      ON "zones"("switch_id", "vsan_id");

ALTER TABLE "zones"
  ADD CONSTRAINT "zones_switch_id_fkey"
  FOREIGN KEY ("switch_id") REFERENCES "switches"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- zone_members
-- ---------------------------------------------------------------------------

CREATE TABLE "zone_members" (
  "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "zone_id"     TEXT NOT NULL,
  "member_type" "ZoneMemberType" NOT NULL DEFAULT 'PWWN',
  "value"       TEXT NOT NULL,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "zone_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "zone_members_zone_id_value_key" ON "zone_members"("zone_id", "value");

ALTER TABLE "zone_members"
  ADD CONSTRAINT "zone_members_zone_id_fkey"
  FOREIGN KEY ("zone_id") REFERENCES "zones"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- zone_sets
-- ---------------------------------------------------------------------------

CREATE TABLE "zone_sets" (
  "id"           TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "switch_id"    TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "vsan_id"      INTEGER NOT NULL,
  "is_active"    BOOLEAN NOT NULL DEFAULT false,
  "is_draft"     BOOLEAN NOT NULL DEFAULT true,
  "activated_at" TIMESTAMPTZ,
  "synced_at"    TIMESTAMPTZ,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "zone_sets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "zone_sets_switch_id_name_vsan_id_key" ON "zone_sets"("switch_id", "name", "vsan_id");
CREATE INDEX        "zone_sets_switch_id_vsan_id_is_active_idx" ON "zone_sets"("switch_id", "vsan_id", "is_active");

ALTER TABLE "zone_sets"
  ADD CONSTRAINT "zone_sets_switch_id_fkey"
  FOREIGN KEY ("switch_id") REFERENCES "switches"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- zone_set_members
-- ---------------------------------------------------------------------------

CREATE TABLE "zone_set_members" (
  "zone_set_id" TEXT NOT NULL,
  "zone_id"     TEXT NOT NULL,
  "added_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "zone_set_members_pkey" PRIMARY KEY ("zone_set_id", "zone_id")
);

ALTER TABLE "zone_set_members"
  ADD CONSTRAINT "zone_set_members_zone_set_id_fkey"
  FOREIGN KEY ("zone_set_id") REFERENCES "zone_sets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "zone_set_members"
  ADD CONSTRAINT "zone_set_members_zone_id_fkey"
  FOREIGN KEY ("zone_id") REFERENCES "zones"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- zoning_snapshots
-- ---------------------------------------------------------------------------

CREATE TABLE "zoning_snapshots" (
  "id"           TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "switch_id"    TEXT NOT NULL,
  "vsan_id"      INTEGER NOT NULL,
  "trigger"      "SnapshotTrigger" NOT NULL DEFAULT 'MANUAL',
  "payload"      JSONB NOT NULL,
  "diff_summary" JSONB,
  "triggered_by" TEXT,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "zoning_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "zoning_snapshots_switch_id_vsan_id_created_at_idx"
  ON "zoning_snapshots"("switch_id", "vsan_id", "created_at" DESC);

ALTER TABLE "zoning_snapshots"
  ADD CONSTRAINT "zoning_snapshots_switch_id_fkey"
  FOREIGN KEY ("switch_id") REFERENCES "switches"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- port_metrics  (TimescaleDB hypertable — converted by 02-hypertable.sql)
-- ---------------------------------------------------------------------------

CREATE TABLE "port_metrics" (
  "timestamp"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "switch_id"      TEXT NOT NULL,
  "interface_name" TEXT NOT NULL,
  "tx_bytes"       BIGINT NOT NULL DEFAULT 0,
  "rx_bytes"       BIGINT NOT NULL DEFAULT 0,
  "crc_errors"     BIGINT NOT NULL DEFAULT 0,
  "link_failures"  BIGINT NOT NULL DEFAULT 0,
  "tx_rate_bps"    DOUBLE PRECISION,
  "rx_rate_bps"    DOUBLE PRECISION,
  "rx_power_dbm"   DOUBLE PRECISION,
  "tx_power_dbm"   DOUBLE PRECISION,
  "temperature"    DOUBLE PRECISION,
  "voltage"        DOUBLE PRECISION,
  "current"        DOUBLE PRECISION,

  CONSTRAINT "port_metrics_pkey" PRIMARY KEY ("timestamp", "switch_id", "interface_name")
);

CREATE INDEX "port_metrics_switch_id_interface_name_timestamp_idx"
  ON "port_metrics"("switch_id", "interface_name", "timestamp" DESC);

ALTER TABLE "port_metrics"
  ADD CONSTRAINT "port_metrics_switch_id_fkey"
  FOREIGN KEY ("switch_id") REFERENCES "switches"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
