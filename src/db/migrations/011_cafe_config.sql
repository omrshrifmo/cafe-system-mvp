-- 011_cafe_config.sql
-- Add configuration and administration fields to venues, devices, and stations.
-- Create the effective-dated policies table.

-- 1. Extend Venues
ALTER TABLE venues ADD COLUMN legal_name TEXT;
ALTER TABLE venues ADD COLUMN name_ar TEXT;
ALTER TABLE venues ADD COLUMN name_en TEXT;
ALTER TABLE venues ADD COLUMN logo_url TEXT;
ALTER TABLE venues ADD COLUMN contact_phone TEXT;
ALTER TABLE venues ADD COLUMN contact_email TEXT;
ALTER TABLE venues ADD COLUMN address TEXT;
ALTER TABLE venues ADD COLUMN locale TEXT DEFAULT 'en';
ALTER TABLE venues ADD COLUMN fiscal_policy TEXT; -- e.g., '04:00 AM'
ALTER TABLE venues ADD COLUMN tax_registration_number TEXT;
ALTER TABLE venues ADD COLUMN receipt_footer TEXT;
ALTER TABLE venues ADD COLUMN privacy_policy TEXT;
ALTER TABLE venues ADD COLUMN operating_hours TEXT; -- JSON array of ranges

-- 2. Extend Devices
ALTER TABLE devices ADD COLUMN station_id TEXT REFERENCES stations(id) ON DELETE SET NULL;
ALTER TABLE devices ADD COLUMN capabilities TEXT; -- JSON array
ALTER TABLE devices ADD COLUMN heartbeat_at TEXT;
ALTER TABLE devices ADD COLUMN last_seen_at TEXT;
ALTER TABLE devices ADD COLUMN revoked_at TEXT;

-- 3. Extend Stations
ALTER TABLE stations ADD COLUMN station_type TEXT NOT NULL DEFAULT 'GENERAL';
ALTER TABLE stations ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE';

-- 4. Create Policies Table for Effective-Dated Configuration
CREATE TABLE IF NOT EXISTS v3_policies (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    effective_from TEXT NOT NULL,
    payload TEXT NOT NULL, -- JSON containing all configuration keys
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE,
    FOREIGN KEY(created_by) REFERENCES v3_users(id) ON DELETE RESTRICT
);

-- Ensure a single venue only has one instance of a specific version
CREATE UNIQUE INDEX IF NOT EXISTS idx_v3_policies_venue_version ON v3_policies(venue_id, version);
