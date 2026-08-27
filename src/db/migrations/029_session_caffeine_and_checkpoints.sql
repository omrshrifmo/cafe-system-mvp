-- Migration 029: Session Caffeine Mode & Activity Checkpoints
-- Safe Transactional Migration

-- 1. Enhance v3_user_sessions for Caffeine Keep-Alive Mode
ALTER TABLE v3_user_sessions ADD COLUMN caffeine_expires_at TEXT NULL;
ALTER TABLE v3_user_sessions ADD COLUMN caffeine_reason TEXT NULL;

-- 2. Create v3_user_activity_checkpoints table
CREATE TABLE IF NOT EXISTS v3_user_activity_checkpoints (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    venue_id TEXT NOT NULL DEFAULT 'V_DEFAULT',
    role_id TEXT NOT NULL,
    device_id TEXT NULL,
    context_id TEXT NULL,
    route TEXT NOT NULL,
    draft_type TEXT NOT NULL, -- 'ORDER_DRAFT', 'STOCKTAKE_DRAFT', 'TABLE_SELECTION'
    draft_payload TEXT NOT NULL, -- JSON string
    is_sensitive INTEGER NOT NULL DEFAULT 0, -- 1 = Never restore automatically
    schema_version TEXT NOT NULL DEFAULT '029_session_caffeine_and_checkpoints.sql',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES v3_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_v3_checkpoints_user ON v3_user_activity_checkpoints(user_id, venue_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_v3_checkpoints_context ON v3_user_activity_checkpoints(context_id, user_id);
