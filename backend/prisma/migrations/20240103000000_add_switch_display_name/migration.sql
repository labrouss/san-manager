-- Migration: 20240103000000_add_switch_display_name
-- Adds display_name (user friendly label) and notes (operator memo) to switches

ALTER TABLE "switches"
  ADD COLUMN IF NOT EXISTS "display_name" TEXT,
  ADD COLUMN IF NOT EXISTS "notes"        TEXT;
