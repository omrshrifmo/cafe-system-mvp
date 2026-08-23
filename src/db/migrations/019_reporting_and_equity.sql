-- 019_reporting_and_equity.sql

CREATE TABLE IF NOT EXISTS equity_ledger (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    event_type TEXT NOT NULL, -- 'CAPITAL_CONTRIBUTION', 'OWNER_WITHDRAWAL', 'DISTRIBUTION', 'RETAINED_EARNINGS_ADJUSTMENT'
    amount_minor INTEGER NOT NULL, -- Positive adds to equity, Negative removes
    effective_date TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE,
    FOREIGN KEY(actor_id) REFERENCES v3_users(id) ON DELETE RESTRICT
);

-- Materialized constraints or index optimizations for reporting speed
CREATE INDEX IF NOT EXISTS idx_orders_reporting ON v3_order_sessions(branch_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_reporting ON v3_payments(status, created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_reporting ON inventory_ledger(event_type, created_at);
