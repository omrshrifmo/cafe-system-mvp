-- 030_audit_activity_ledger_and_alerts.sql
-- Universal Append-Only Audit Ledger, Security Anomaly Alerts, and Multi-Channel Notification Outbox

-- 1. Universal Append-Only Audit Ledger with Cryptographic Hash Chaining
CREATE TABLE IF NOT EXISTS v3_audit_ledger (
    id TEXT PRIMARY KEY,
    sequence_num INTEGER,
    event_type TEXT NOT NULL,
    actor_user_id TEXT,
    actor_name TEXT,
    actor_role TEXT,
    session_id TEXT,
    device_id TEXT,
    seat_id TEXT,
    venue_id TEXT NOT NULL DEFAULT 'V_DEFAULT',
    shift_id TEXT,
    business_date TEXT,
    target_entity_type TEXT,
    target_entity_id TEXT,
    before_state_hash TEXT,
    after_state_hash TEXT,
    details_json TEXT,
    policy_version TEXT NOT NULL DEFAULT 'v1',
    catalog_version TEXT NOT NULL DEFAULT 'v1',
    schema_version TEXT NOT NULL DEFAULT '030',
    build_version TEXT NOT NULL DEFAULT '2.0.0',
    client_timestamp TEXT,
    server_timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    request_id TEXT,
    idempotency_key TEXT,
    source TEXT NOT NULL DEFAULT 'WEB',
    outcome TEXT NOT NULL DEFAULT 'SUCCESS',
    reason TEXT,
    previous_event_hash TEXT,
    event_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_ledger_event_time ON v3_audit_ledger(event_type, server_timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_ledger_actor_time ON v3_audit_ledger(actor_user_id, server_timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_ledger_shift ON v3_audit_ledger(shift_id);
CREATE INDEX IF NOT EXISTS idx_audit_ledger_target ON v3_audit_ledger(target_entity_type, target_entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_ledger_request ON v3_audit_ledger(request_id);
CREATE INDEX IF NOT EXISTS idx_audit_ledger_seq ON v3_audit_ledger(sequence_num);

-- 2. Security Anomaly Alerts Repository
CREATE TABLE IF NOT EXISTS v3_security_alerts (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL DEFAULT 'V_DEFAULT',
    alert_type TEXT NOT NULL, -- FAILED_PIN_BURST, IMPOSSIBLE_LOCATION, REVOKED_ACCESS_ATTEMPT, RAPID_ROLE_CHANGE, ABNORMAL_VOID_SURGE, UNKNOWN_PAYMENT_BURST, OFFLINE_ANOMALY
    severity TEXT NOT NULL DEFAULT 'MEDIUM', -- LOW, MEDIUM, HIGH, CRITICAL
    actor_user_id TEXT,
    device_id TEXT,
    ip_address TEXT,
    title_ar TEXT NOT NULL,
    description_ar TEXT NOT NULL,
    recommended_action_ar TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'TRIGGERED', -- TRIGGERED, ACKNOWLEDGED, RESOLVED, DISMISSED
    acknowledged_by TEXT,
    acknowledged_at TEXT,
    resolved_by TEXT,
    resolved_at TEXT,
    resolution_note TEXT,
    audit_event_id TEXT,
    dedup_key TEXT UNIQUE,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_security_alerts_status ON v3_security_alerts(venue_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_security_alerts_type ON v3_security_alerts(alert_type, created_at);

-- 3. System In-App and Outbound Notification Outbox
CREATE TABLE IF NOT EXISTS v3_system_notifications (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL DEFAULT 'V_DEFAULT',
    recipient_user_id TEXT,
    recipient_role TEXT,
    channel TEXT NOT NULL DEFAULT 'IN_APP', -- IN_APP, WEBHOOK, EMAIL, SMS
    alert_id TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'INFO', -- INFO, WARNING, ERROR, CRITICAL
    status TEXT NOT NULL DEFAULT 'QUEUED', -- QUEUED, DELIVERED, FAILED, RETRYING
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    last_attempt_at TEXT,
    last_error TEXT,
    delivery_response_json TEXT,
    dedup_key TEXT UNIQUE,
    metadata_json TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(alert_id) REFERENCES v3_security_alerts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON v3_system_notifications(recipient_user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_channel ON v3_system_notifications(channel, status);

-- 4. Notification Channels Connector Configuration
CREATE TABLE IF NOT EXISTS v3_notification_channels_config (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL DEFAULT 'V_DEFAULT',
    channel TEXT NOT NULL, -- WEBHOOK, EMAIL, SMS
    is_enabled INTEGER NOT NULL DEFAULT 0,
    endpoint_url TEXT,
    auth_token_encrypted TEXT,
    recipient_targets_json TEXT, -- JSON array of URLs, emails, or phone numbers
    event_types_filter_json TEXT, -- JSON array of alert_types or event_types
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(venue_id, channel)
);
