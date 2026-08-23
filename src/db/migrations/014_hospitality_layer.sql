-- 014_hospitality_layer.sql
-- Implements canonical hospitality models: Tables, Service Requests, Customers/CRM, Loyalty Ledger, and Reservations.

-- 1. Hospitality Tables Enhancement
-- We recreate v3_tables to add hospitality fields like floor_position, qr_token_ref, active_order_id, reservation_id, customer_context, version.
CREATE TABLE IF NOT EXISTS v3_tables_new (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    table_number INTEGER NOT NULL,
    display_name TEXT,
    custom_name TEXT,
    zone TEXT NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 2,
    floor_position_x INTEGER,
    floor_position_y INTEGER,
    qr_token_ref TEXT,
    active_order_id TEXT,
    active_reservation_id TEXT,
    customer_context_json TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'AVAILABLE', -- AVAILABLE, HELD_FOR_RESERVATION, OCCUPIED, ORDER_OPEN, REQUESTED_CHECK, PAYMENT_PENDING, PAID_PENDING_CLEAR, CLEANING, OUT_OF_SERVICE
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    UNIQUE(branch_id, table_number)
);

INSERT INTO v3_tables_new (id, branch_id, table_number, zone, capacity, status, created_at, updated_at)
SELECT id, branch_id, table_number, zone, capacity, status, created_at, updated_at FROM v3_tables;

DROP TABLE v3_tables;
ALTER TABLE v3_tables_new RENAME TO v3_tables;

-- 2. Waiter Assistance (Service Requests)
CREATE TABLE IF NOT EXISTS service_requests (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    table_id TEXT NOT NULL,
    order_session_id TEXT,
    type TEXT NOT NULL, -- 'WATER', 'BILL', 'CLEANUP', 'MANAGER', 'HOOKAH', 'MISSING_ITEM', 'CUSTOMER_ASSISTANCE'
    priority INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'ACKNOWLEDGED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
    owner_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    acknowledged_at TEXT,
    started_at TEXT,
    completed_at TEXT,
    cancelled_at TEXT,
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE,
    FOREIGN KEY(table_id) REFERENCES v3_tables(id) ON DELETE CASCADE,
    FOREIGN KEY(owner_id) REFERENCES v3_users(id) ON DELETE SET NULL
);

-- 3. CRM & Loyalty
-- Enhance v3_customers
CREATE TABLE IF NOT EXISTS v3_customers_new (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    masked_phone TEXT,
    email TEXT,
    masked_email TEXT,
    consent_status TEXT NOT NULL DEFAULT 'PENDING',
    tags TEXT,
    notes TEXT,
    visit_count INTEGER NOT NULL DEFAULT 0,
    lifetime_spend_minor INTEGER NOT NULL DEFAULT 0,
    loyalty_balance INTEGER NOT NULL DEFAULT 0,
    credit_balance_minor INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE
);

INSERT INTO v3_customers_new (id, venue_id, name, phone, credit_balance_minor, created_at)
SELECT id, venue_id, name, phone, credit_balance_minor, created_at FROM v3_customers;

DROP TABLE v3_customers;
ALTER TABLE v3_customers_new RENAME TO v3_customers;

-- Loyalty Ledger
CREATE TABLE IF NOT EXISTS loyalty_ledger (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    change_points INTEGER NOT NULL,
    balance_points INTEGER NOT NULL,
    reference_type TEXT NOT NULL, -- 'SETTLEMENT', 'ADJUSTMENT'
    reference_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(customer_id) REFERENCES v3_customers(id) ON DELETE CASCADE
);

-- 4. Reservations
CREATE TABLE IF NOT EXISTS reservations (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    table_id TEXT,
    party_size INTEGER NOT NULL,
    reservation_time TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 90,
    status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'
    deposit_minor INTEGER NOT NULL DEFAULT 0,
    reference TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE,
    FOREIGN KEY(customer_id) REFERENCES v3_customers(id) ON DELETE CASCADE,
    FOREIGN KEY(table_id) REFERENCES v3_tables(id) ON DELETE SET NULL
);
