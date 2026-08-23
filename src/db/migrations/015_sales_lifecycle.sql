-- 015_sales_lifecycle.sql

-- 1. Update v3_order_sessions
CREATE TABLE IF NOT EXISTS v3_order_sessions_new (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    table_id TEXT,
    customer_id TEXT,
    created_by TEXT NOT NULL,
    order_type TEXT NOT NULL DEFAULT 'DINE_IN',
    status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN, SUBMITTED, IN_PREPARATION, PARTIALLY_READY, READY, SERVED, PAYMENT_PENDING, PAID
    subtotal_minor INTEGER NOT NULL DEFAULT 0,
    tax_minor INTEGER NOT NULL DEFAULT 0,
    service_minor INTEGER NOT NULL DEFAULT 0,
    discount_minor INTEGER NOT NULL DEFAULT 0,
    tip_minor INTEGER NOT NULL DEFAULT 0,
    total_minor INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY(table_id) REFERENCES v3_tables(id) ON DELETE SET NULL,
    FOREIGN KEY(customer_id) REFERENCES v3_customers(id) ON DELETE SET NULL,
    FOREIGN KEY(created_by) REFERENCES v3_users(id) ON DELETE RESTRICT
);

INSERT INTO v3_order_sessions_new (id, branch_id, table_id, customer_id, created_by, order_type, status, subtotal_minor, tax_minor, service_minor, discount_minor, total_minor, version, created_at, updated_at)
SELECT id, branch_id, table_id, customer_id, created_by, order_type, status, subtotal_minor, tax_minor, service_minor, discount_minor, total_minor, version, created_at, updated_at FROM v3_order_sessions;

DROP TABLE v3_order_sessions;
ALTER TABLE v3_order_sessions_new RENAME TO v3_order_sessions;

-- 2. Update v3_order_lines
CREATE TABLE IF NOT EXISTS v3_order_lines_new (
    id TEXT PRIMARY KEY,
    order_session_id TEXT NOT NULL,
    menu_item_id TEXT NOT NULL,
    catalog_version INTEGER NOT NULL DEFAULT 1,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price_minor INTEGER NOT NULL,
    modifiers_json TEXT,
    modifier_total_minor INTEGER NOT NULL DEFAULT 0,
    total_minor INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, PREPARING, READY, SERVED
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(order_session_id) REFERENCES v3_order_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY(menu_item_id) REFERENCES v3_menu_items(id) ON DELETE RESTRICT
);

INSERT INTO v3_order_lines_new (id, order_session_id, menu_item_id, quantity, unit_price_minor, total_minor, status, notes, created_at)
SELECT id, order_session_id, menu_item_id, quantity, unit_price_minor, total_minor, status, notes, created_at FROM v3_order_lines;

DROP TABLE v3_order_lines;
ALTER TABLE v3_order_lines_new RENAME TO v3_order_lines;

-- 3. Update v3_payments
CREATE TABLE IF NOT EXISTS v3_payments_new (
    id TEXT PRIMARY KEY,
    order_session_id TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    tip_minor INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'EGP',
    payment_method TEXT NOT NULL, -- 'CASH', 'CARD', 'CREDIT'
    external_reference TEXT,
    idempotency_key TEXT,
    status TEXT NOT NULL DEFAULT 'COMPLETED',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(order_session_id) REFERENCES v3_order_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY(created_by) REFERENCES v3_users(id) ON DELETE RESTRICT
);

INSERT INTO v3_payments_new (id, order_session_id, amount_minor, currency, payment_method, status, created_by, created_at)
SELECT id, order_session_id, amount_minor, currency, payment_method, status, created_by, created_at FROM v3_payments;

DROP TABLE v3_payments;
ALTER TABLE v3_payments_new RENAME TO v3_payments;

-- 4. Reversals Ledger
CREATE TABLE IF NOT EXISTS reversals (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    order_session_id TEXT NOT NULL,
    payment_id TEXT,
    type TEXT NOT NULL, -- 'CANCELLED_UNPAID', 'VOID_UNPAID', 'VOID_PAID', 'REFUND_FULL', 'REFUND_PARTIAL', 'ADJUSTMENT'
    reason TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    actor_id TEXT NOT NULL,
    approval_actor_id TEXT,
    idempotency_key TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE,
    FOREIGN KEY(order_session_id) REFERENCES v3_order_sessions(id) ON DELETE RESTRICT,
    FOREIGN KEY(payment_id) REFERENCES v3_payments(id) ON DELETE RESTRICT,
    FOREIGN KEY(actor_id) REFERENCES v3_users(id) ON DELETE RESTRICT,
    FOREIGN KEY(approval_actor_id) REFERENCES v3_users(id) ON DELETE SET NULL
);

-- 5. Printer Jobs
CREATE TABLE IF NOT EXISTS printer_jobs (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    target_printer_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'SENT', 'ACKNOWLEDGED', 'FAILED', 'DEAD_LETTER'
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE
);

-- 6. Add payload_hash to idempotency_keys
ALTER TABLE idempotency_keys ADD COLUMN payload_hash TEXT;
