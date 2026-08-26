-- Migration 027: Safe Update Mechanism & Package Management Tracking
-- Transactional Migration

CREATE TABLE IF NOT EXISTS system_updates (
  id TEXT PRIMARY KEY,
  package_name TEXT NOT NULL,
  version TEXT NOT NULL,
  previous_version TEXT NOT NULL,
  schema_target TEXT,
  checksum TEXT NOT NULL,
  signature TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'INSPECTED',
  backup_file TEXT,
  backup_checksum TEXT,
  applied_by INTEGER,
  applied_at TEXT,
  rollback_at TEXT,
  release_notes_ar TEXT,
  release_notes_en TEXT,
  affected_modules TEXT,
  manifest_payload TEXT NOT NULL,
  error_details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_system_updates_status ON system_updates(status);
CREATE INDEX IF NOT EXISTS idx_system_updates_version ON system_updates(version);
