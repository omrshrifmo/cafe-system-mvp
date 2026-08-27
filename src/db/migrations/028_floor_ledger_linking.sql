-- 028_floor_ledger_linking.sql
-- Links the operational floor (KDS, runner) and day-management cycle (shifts, EOD)
-- to the authoritative sales, inventory, cash, and audit ledgers.
-- Additive-only with no destructive rewrites so posted history is preserved.

-- 1. Shift scoping on the sales ledger: every payment and order session is bound
--    to exactly one immutable shift scope so EOD never relies on time windows.
ALTER TABLE v3_payments ADD COLUMN shift_id TEXT;
ALTER TABLE v3_payments ADD COLUMN device_id TEXT;
ALTER TABLE v3_order_sessions ADD COLUMN shift_id TEXT;
ALTER TABLE v3_order_sessions ADD COLUMN device_id TEXT;

CREATE INDEX IF NOT EXISTS idx_v3_payments_shift ON v3_payments(shift_id);
CREATE INDEX IF NOT EXISTS idx_v3_order_sessions_shift ON v3_order_sessions(shift_id);

-- 2. Floor binding to shifts: KDS orders and runner tasks belong to a shift scope.
ALTER TABLE kds_orders ADD COLUMN shift_id TEXT;
ALTER TABLE runner_tasks ADD COLUMN shift_id TEXT;
ALTER TABLE runner_tasks ADD COLUMN device_id TEXT;

CREATE INDEX IF NOT EXISTS idx_kds_orders_shift ON kds_orders(shift_id);
CREATE INDEX IF NOT EXISTS idx_runner_tasks_shift ON runner_tasks(shift_id);

-- 3. Immutable KDS transition audit trail.
--    Every state change records authenticated actor, station, device, version,
--    timestamp, and request id. Append-only with no UPDATE path provided.
CREATE TABLE IF NOT EXISTS kds_line_transitions (
    id TEXT PRIMARY KEY,
    kds_line_id TEXT NOT NULL,
    kds_order_id TEXT NOT NULL,
    order_session_id TEXT,
    station_id TEXT NOT NULL,
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL,
    actor_id TEXT,
    device_id TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    request_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(kds_line_id) REFERENCES kds_order_lines(id) ON DELETE CASCADE,
    FOREIGN KEY(kds_order_id) REFERENCES kds_orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kds_line_transitions_line ON kds_line_transitions(kds_line_id, created_at);
CREATE INDEX IF NOT EXISTS idx_kds_line_transitions_session ON kds_line_transitions(order_session_id);

-- 4. Exactly-once BOM consumption sets per accepted settlement.
--    One accepted order produces one logical BOM consumption set. The unique key
--    on consumption_set_id makes duplicate settlement retries fail safely.
CREATE TABLE IF NOT EXISTS bom_consumption_sets (
    id TEXT PRIMARY KEY,
    consumption_set_id TEXT NOT NULL UNIQUE,
    order_session_id TEXT NOT NULL,
    shift_id TEXT,
    line_count INTEGER NOT NULL DEFAULT 0,
    total_cost_minor INTEGER NOT NULL DEFAULT 0,
    actor_id TEXT,
    device_id TEXT,
    request_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_bom_sets_order ON bom_consumption_sets(order_session_id);

-- 5. Exactly-once loyalty awards bound to authoritative accepted settlements.
CREATE TABLE IF NOT EXISTS loyalty_awards (
    id TEXT PRIMARY KEY,
    award_key TEXT NOT NULL UNIQUE,
    customer_id TEXT NOT NULL,
    order_session_id TEXT NOT NULL,
    points INTEGER NOT NULL,
    policy_version TEXT NOT NULL DEFAULT 'v1',
    status TEXT NOT NULL DEFAULT 'EARNED', -- EARNED, REVERSED
    reversal_reason TEXT,
    actor_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(customer_id) REFERENCES v3_customers(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_loyalty_awards_customer ON loyalty_awards(customer_id);

-- 6. Enriched handover records: incoming staff, notes, approval, and live
--    exception lists captured at handover time.
ALTER TABLE shift_handovers ADD COLUMN outgoing_staff_id TEXT;
ALTER TABLE shift_handovers ADD COLUMN incoming_staff_id TEXT;
ALTER TABLE shift_handovers ADD COLUMN counted_cash_minor INTEGER;
ALTER TABLE shift_handovers ADD COLUMN notes TEXT;
ALTER TABLE shift_handovers ADD COLUMN approval_actor_id TEXT;
ALTER TABLE shift_handovers ADD COLUMN approved_at TEXT;
ALTER TABLE shift_handovers ADD COLUMN stock_exceptions_json TEXT;
ALTER TABLE shift_handovers ADD COLUMN printer_payment_exceptions_json TEXT;

-- 7. Documented authorized exceptions that permit closing over critical mismatches.
CREATE TABLE IF NOT EXISTS eod_close_exceptions (
    id TEXT PRIMARY KEY,
    shift_id TEXT NOT NULL,
    business_date TEXT NOT NULL,
    exception_type TEXT NOT NULL, -- UNRESOLVED_PAYMENT, CASH_VARIANCE, STOCK_MISMATCH, REPORT_MISMATCH
    severity TEXT NOT NULL DEFAULT 'CRITICAL',
    description TEXT NOT NULL,
    amount_minor INTEGER,
    approved_by TEXT NOT NULL,
    approval_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(shift_id) REFERENCES v3_shifts(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_eod_exceptions_shift ON eod_close_exceptions(shift_id);

-- 8. Realtime event cursors for reconnect replay without manual refresh.
CREATE TABLE IF NOT EXISTS realtime_client_cursors (
    client_id TEXT NOT NULL,
    venue_id TEXT NOT NULL,
    last_sequence INTEGER NOT NULL DEFAULT 0,
    last_event_id TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (client_id, venue_id)
);

-- 9. Update package registry for the safe update mechanism.
CREATE TABLE IF NOT EXISTS system_update_packages (
    id TEXT PRIMARY KEY,
    package_id TEXT NOT NULL,
    semantic_version TEXT NOT NULL,
    compatibility_min TEXT,
    compatibility_max TEXT,
    build_commit TEXT,
    schema_target TEXT,
    migrations_json TEXT,
    service_worker_version TEXT,
    translations_assets_json TEXT,
    config_schema_versions_json TEXT,
    checksum_sha256 TEXT NOT NULL,
    signature_verified INTEGER NOT NULL DEFAULT 0,
    release_notes TEXT,
    rollback_metadata_json TEXT,
    required_backup INTEGER NOT NULL DEFAULT 1,
    target_environment TEXT NOT NULL DEFAULT 'DEMO', -- DEMO, LIVE
    status TEXT NOT NULL DEFAULT 'UPLOADED', -- UPLOADED, VALIDATED, DRY_RUN_OK, APPLYING, ACTIVE, UPDATE_FAILED, RECOVERY_REQUIRED, ROLLED_BACK, REJECTED
    rejection_reason TEXT,
    backup_path TEXT,
    backup_checksum TEXT,
    applied_by TEXT,
    applied_at TEXT,
    health_check_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(package_id, semantic_version)
);

CREATE INDEX IF NOT EXISTS idx_update_packages_status ON system_update_packages(status);