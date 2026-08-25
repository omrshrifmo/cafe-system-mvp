-- Migration 023: Canonical Hospitality Workflow, Table Events, Waiter Assist, CRM Privacy & Reservations
-- Transactional Migration

-- 1. Enhance tables for Hospitality & Optimistic Concurrency
ALTER TABLE tables ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tables ADD COLUMN shift_id INTEGER NULL;
ALTER TABLE tables ADD COLUMN device_id TEXT NULL;
ALTER TABLE tables ADD COLUMN opened_by_user_id INTEGER NULL;
ALTER TABLE tables ADD COLUMN turnover_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tables ADD COLUMN created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 2. Create Table Events Table (Immutable append-only lifecycle events)
CREATE TABLE IF NOT EXISTS table_events (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL DEFAULT 'V_DEFAULT',
    table_id TEXT NULL,
    table_number INTEGER NOT NULL,
    session_id TEXT NULL,
    event_type TEXT NOT NULL, -- OPEN, WAITER_APPROACHED, ORDER_PLACED, CHECK_REQUESTED, PAYMENT_RECORDED, VACATED, CLEARED, REVERTED, MOVED
    from_state TEXT,
    to_state TEXT,
    guest_count INTEGER DEFAULT 1,
    actor_id INTEGER NULL,
    shift_id INTEGER NULL,
    device_id TEXT NULL,
    order_total_minor INTEGER DEFAULT 0,
    context_notes TEXT NULL,
    idempotency_key TEXT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_table_events_table ON table_events(table_number, created_at);
CREATE INDEX IF NOT EXISTS idx_table_events_session ON table_events(session_id);

-- 3. Enhance Service Requests / Waiter Tasks
ALTER TABLE service_requests ADD COLUMN priority_level TEXT DEFAULT 'NORMAL';
ALTER TABLE service_requests ADD COLUMN sla_minutes INTEGER DEFAULT 5;
ALTER TABLE service_requests ADD COLUMN elapsed_minutes INTEGER DEFAULT 0;
ALTER TABLE service_requests ADD COLUMN assigned_waiter_id INTEGER NULL;
ALTER TABLE service_requests ADD COLUMN context_notes TEXT NULL;
ALTER TABLE service_requests ADD COLUMN idempotency_key TEXT NULL;
ALTER TABLE service_requests ADD COLUMN audit_trail_json TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_requests_idemp ON service_requests(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_requests_active ON service_requests(table_id, status);

-- 4. Enhance CRM Customers for Privacy & Consent
ALTER TABLE v3_customers ADD COLUMN privacy_scope TEXT DEFAULT 'STANDARD';
ALTER TABLE v3_customers ADD COLUMN preferences_json TEXT NULL;
ALTER TABLE v3_customers ADD COLUMN last_visit_at TEXT NULL;
ALTER TABLE v3_customers ADD COLUMN export_restricted INTEGER NOT NULL DEFAULT 0;

-- 5. Customer Visits Timeline Table
CREATE TABLE IF NOT EXISTS customer_visits (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL DEFAULT 'V_DEFAULT',
    customer_id TEXT NOT NULL,
    table_number INTEGER,
    order_id TEXT,
    spend_minor INTEGER NOT NULL DEFAULT 0,
    points_earned INTEGER NOT NULL DEFAULT 0,
    visit_date TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(customer_id) REFERENCES v3_customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_visits_cust ON customer_visits(customer_id, visit_date);

-- 6. Enhance Reservations for Timezone & Area Linkage
ALTER TABLE reservations ADD COLUMN venue_id TEXT DEFAULT 'V_DEFAULT';
ALTER TABLE reservations ADD COLUMN customer_id TEXT NULL;
ALTER TABLE reservations ADD COLUMN customer_name TEXT NULL;
ALTER TABLE reservations ADD COLUMN customer_phone TEXT NULL;
ALTER TABLE reservations ADD COLUMN guest_count INTEGER DEFAULT 2;
ALTER TABLE reservations ADD COLUMN party_size INTEGER DEFAULT 2;
ALTER TABLE reservations ADD COLUMN table_id TEXT NULL;
ALTER TABLE reservations ADD COLUMN table_number INTEGER NULL;
ALTER TABLE reservations ADD COLUMN reservation_date TEXT NULL;
ALTER TABLE reservations ADD COLUMN reservation_time TEXT NULL;
ALTER TABLE reservations ADD COLUMN duration_minutes INTEGER DEFAULT 90;
ALTER TABLE reservations ADD COLUMN timezone TEXT DEFAULT 'Africa/Cairo';
ALTER TABLE reservations ADD COLUMN area_id TEXT DEFAULT 'INDOOR_1';
ALTER TABLE reservations ADD COLUMN deposit_minor INTEGER DEFAULT 0;
ALTER TABLE reservations ADD COLUMN notes TEXT NULL;
ALTER TABLE reservations ADD COLUMN cancellation_reason TEXT NULL;
ALTER TABLE reservations ADD COLUMN seated_at TEXT NULL;
ALTER TABLE reservations ADD COLUMN completed_at TEXT NULL;
ALTER TABLE reservations ADD COLUMN audit_notes TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
