-- 031_device_registry_and_emergency_access.sql
-- Device Trust Registry, Active Session Administration, Emergency Break-Glass & Kiosk Mode Schema

-- 1. Extend devices table with trust, kiosk, and risk metadata
ALTER TABLE devices ADD COLUMN friendly_name TEXT;
ALTER TABLE devices ADD COLUMN device_class TEXT DEFAULT 'POS'; -- POS, KDS, KIOSK, WAITER_HANDHELD, MANAGER_TABLET, BACKOFFICE
ALTER TABLE devices ADD COLUMN browser_version TEXT;
ALTER TABLE devices ADD COLUMN os_info TEXT;
ALTER TABLE devices ADD COLUMN venue_id TEXT DEFAULT 'V_DEFAULT';
ALTER TABLE devices ADD COLUMN is_trusted INTEGER DEFAULT 0;
ALTER TABLE devices ADD COLUMN trust_expires_at TEXT;
ALTER TABLE devices ADD COLUMN trusted_by TEXT;
ALTER TABLE devices ADD COLUMN trusted_at TEXT;
ALTER TABLE devices ADD COLUMN is_kiosk INTEGER DEFAULT 0;
ALTER TABLE devices ADD COLUMN kiosk_allowed_route TEXT;
ALTER TABLE devices ADD COLUMN first_seen_at TEXT DEFAULT (datetime('now', 'localtime'));
ALTER TABLE devices ADD COLUMN enrolled_by TEXT;
ALTER TABLE devices ADD COLUMN policy_version INTEGER DEFAULT 1;
ALTER TABLE devices ADD COLUMN risk_state TEXT DEFAULT 'LOW'; -- LOW, MEDIUM, HIGH, BLOCKED
ALTER TABLE devices ADD COLUMN risk_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_devices_venue_trusted ON devices(venue_id, is_trusted);
CREATE INDEX IF NOT EXISTS idx_devices_kiosk ON devices(is_kiosk, kiosk_allowed_route);

-- 2. Create emergency break-glass sessions table
CREATE TABLE IF NOT EXISTS v3_emergency_access_sessions (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    ticket_ref TEXT NOT NULL,
    reason TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'SYSTEM_RECOVERY', -- SYSTEM_RECOVERY, READ_ONLY_AUDIT, EMERGENCY_OVERRIDE
    started_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    expires_at TEXT NOT NULL,
    terminated_at TEXT,
    terminated_by TEXT,
    ip_address TEXT,
    session_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES v3_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_v3_emergency_active ON v3_emergency_access_sessions(venue_id, expires_at, terminated_at);
CREATE INDEX IF NOT EXISTS idx_v3_emergency_user ON v3_emergency_access_sessions(user_id);

-- 3. Extend v3_user_sessions with device class, build ID, risk state, and emergency flag
ALTER TABLE v3_user_sessions ADD COLUMN device_class TEXT;
ALTER TABLE v3_user_sessions ADD COLUMN build_id TEXT;
ALTER TABLE v3_user_sessions ADD COLUMN risk_state TEXT DEFAULT 'LOW';
ALTER TABLE v3_user_sessions ADD COLUMN is_emergency INTEGER DEFAULT 0;
ALTER TABLE v3_user_sessions ADD COLUMN emergency_session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_v3_user_sessions_device ON v3_user_sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_v3_user_sessions_emergency ON v3_user_sessions(is_emergency);
