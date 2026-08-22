-- 009_auth_enhancements.sql

-- SQLite ALTER TABLE is limited. We'll add new columns to v3_users for progressive delay and lockouts.
ALTER TABLE v3_users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE v3_users ADD COLUMN locked_until TEXT;
ALTER TABLE v3_users ADD COLUMN pin_updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'));
