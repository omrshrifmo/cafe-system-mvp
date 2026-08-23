-- 013_inventory_and_purchasing.sql: Ledger-Based Inventory, Purchasing, Stocktaking, and Expenses

-- 1. Inventory Extensions
ALTER TABLE inventory_items ADD COLUMN par_level_microunits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN cost_basis TEXT NOT NULL DEFAULT 'WEIGHTED_AVERAGE'; -- 'WEIGHTED_AVERAGE', 'FIFO', 'LIFO'
ALTER TABLE inventory_items ADD COLUMN negative_stock_policy TEXT NOT NULL DEFAULT 'VENUE_DEFAULT'; -- 'ALLOW', 'BLOCK', 'WARN', 'VENUE_DEFAULT'
ALTER TABLE inventory_items ADD COLUMN quarantined_microunits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN reserved_microunits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN damaged_microunits INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS inventory_lots (
    id TEXT PRIMARY KEY,
    inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
    batch_number TEXT NOT NULL,
    manufactured_date TEXT,
    expiry_date TEXT,
    received_quantity_microunits INTEGER NOT NULL,
    available_quantity_microunits INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'QUARANTINED', 'EXPIRED', 'CONSUMED'
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS inventory_unit_conversions (
    id TEXT PRIMARY KEY,
    inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
    from_unit TEXT NOT NULL,
    to_unit TEXT NOT NULL,
    multiplier REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 2. Immutable Ledger Enhancements
ALTER TABLE inventory_ledger ADD COLUMN batch_id TEXT REFERENCES inventory_lots(id);
ALTER TABLE inventory_ledger ADD COLUMN device_id TEXT REFERENCES devices(id);

-- 3. Purchasing & Suppliers
ALTER TABLE suppliers ADD COLUMN tax_identity TEXT;
ALTER TABLE suppliers ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE suppliers ADD COLUMN payment_terms TEXT;
ALTER TABLE suppliers ADD COLUMN lead_time_days INTEGER;
ALTER TABLE suppliers ADD COLUMN minimum_order_minor INTEGER;

CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    venue_id TEXT NOT NULL REFERENCES venues(id),
    document_ref TEXT,
    currency TEXT NOT NULL DEFAULT 'EGP',
    tax_treatment TEXT NOT NULL DEFAULT 'INCLUSIVE',
    status TEXT NOT NULL DEFAULT 'DRAFT', -- 'DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'REVERSED'
    actor_id INTEGER REFERENCES users(id),
    approval_actor_id INTEGER REFERENCES users(id),
    idempotency_key TEXT UNIQUE,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
    id TEXT PRIMARY KEY,
    purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
    expected_quantity_microunits INTEGER NOT NULL,
    received_quantity_microunits INTEGER NOT NULL DEFAULT 0,
    unit TEXT NOT NULL,
    unit_cost_minor INTEGER NOT NULL,
    line_total_minor INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING'
);

-- 4. Stocktaking
CREATE TABLE IF NOT EXISTS stocktake_sessions (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL REFERENCES venues(id),
    status TEXT NOT NULL DEFAULT 'FROZEN', -- 'FROZEN', 'COUNTING', 'REVIEW', 'POSTED', 'REOPENED'
    created_by INTEGER REFERENCES users(id),
    reviewer_id INTEGER REFERENCES users(id),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    posted_at TEXT
);

CREATE TABLE IF NOT EXISTS stocktake_lines (
    id TEXT PRIMARY KEY,
    stocktake_session_id TEXT NOT NULL REFERENCES stocktake_sessions(id) ON DELETE CASCADE,
    inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
    location_id TEXT REFERENCES inventory_locations(id),
    batch_id TEXT REFERENCES inventory_lots(id),
    expected_microunits INTEGER NOT NULL,
    counted_microunits INTEGER,
    variance_microunits INTEGER,
    reason TEXT,
    counter_id INTEGER REFERENCES users(id),
    counted_at TEXT
);

-- 5. Expenses & Utilities
CREATE TABLE IF NOT EXISTS expense_categories (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL REFERENCES venues(id),
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- 'DIRECT_PRODUCT', 'DIRECT_OPERATING', 'INDIRECT'
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS vendors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    contact_details TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL REFERENCES venues(id),
    vendor_id TEXT NOT NULL REFERENCES vendors(id),
    category_id TEXT NOT NULL REFERENCES expense_categories(id),
    amount_minor INTEGER NOT NULL,
    tax_minor INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'EGP',
    billing_period_start TEXT,
    billing_period_end TEXT,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'DRAFT', -- 'DRAFT', 'APPROVED', 'PAID'
    allocation_policy_json TEXT, -- e.g., {"method": "REVENUE", "period": "MONTHLY"}
    attachment_ref TEXT,
    created_by INTEGER REFERENCES users(id),
    approved_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
