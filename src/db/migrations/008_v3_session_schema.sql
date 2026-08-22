-- 008_v3_session_schema.sql

CREATE TABLE v3_user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    venue_id TEXT NOT NULL,
    device_id TEXT,
    shift_id TEXT,
    session_hash TEXT NOT NULL UNIQUE,
    issued_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    absolute_expiry_at TEXT NOT NULL,
    inactivity_expiry_at TEXT NOT NULL,
    revoked_at TEXT,
    ip_address TEXT,
    user_agent TEXT,
    FOREIGN KEY(user_id) REFERENCES v3_users(id) ON DELETE CASCADE,
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE
);
CREATE INDEX idx_v3_user_sessions_user ON v3_user_sessions(user_id);
CREATE INDEX idx_v3_user_sessions_hash ON v3_user_sessions(session_hash);
CREATE INDEX idx_v3_user_sessions_active ON v3_user_sessions(user_id, revoked_at);

CREATE TABLE v3_audit_logs (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    user_id TEXT,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    details TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES v3_users(id) ON DELETE SET NULL
);
CREATE INDEX idx_v3_audit_logs_venue ON v3_audit_logs(venue_id, created_at);
