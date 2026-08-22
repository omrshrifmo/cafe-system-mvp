-- 006_v3_authoritative_schema.sql
-- Creates the strict, authoritative V3 schema.
-- Old tables are NOT dropped here, they are migrated in 007.

-- 1. Venues & Branches
CREATE TABLE IF NOT EXISTS venues (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'EGP',
    timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    name TEXT NOT NULL,
    device_type TEXT NOT NULL, -- 'POS', 'KDS', 'KIOSK'
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(branch_id) REFERENCES branches(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stations (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(branch_id) REFERENCES branches(id) ON DELETE CASCADE
);

-- 2. Identity & Access
CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS permissions (
    id TEXT PRIMARY KEY,
    role_id TEXT NOT NULL,
    permission_string TEXT NOT NULL,
    FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS v3_users (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    name TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    role_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    hourly_rate_minor INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE,
    FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_id TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    ended_at TEXT,
    FOREIGN KEY(user_id) REFERENCES v3_users(id) ON DELETE CASCADE,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE SET NULL
);

-- 3. Catalog
CREATE TABLE IF NOT EXISTS v3_menu_categories (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    name TEXT NOT NULL,
    icon TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS v3_menu_items (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL,
    name TEXT NOT NULL,
    department TEXT NOT NULL DEFAULT 'GENERAL',
    is_available INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(category_id) REFERENCES v3_menu_categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS v3_menu_prices (
    id TEXT PRIMARY KEY,
    menu_item_id TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'EGP',
    effective_date TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    end_date TEXT,
    FOREIGN KEY(menu_item_id) REFERENCES v3_menu_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS v3_recipe_versions (
    id TEXT PRIMARY KEY,
    menu_item_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    instructions TEXT,
    tolerance_basis TEXT NOT NULL DEFAULT 'PERCENT',
    tolerance_percent_basis_points INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(menu_item_id) REFERENCES v3_menu_items(id) ON DELETE CASCADE
);

-- 4. Inventory
CREATE TABLE IF NOT EXISTS v3_inventory_items (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    unit TEXT NOT NULL,
    min_limit INTEGER NOT NULL DEFAULT 0,
    cost_per_unit_minor INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS v3_recipe_ingredients (
    id TEXT PRIMARY KEY,
    recipe_version_id TEXT NOT NULL,
    inventory_item_id TEXT NOT NULL,
    quantity_microunits INTEGER NOT NULL,
    unit TEXT NOT NULL,
    FOREIGN KEY(recipe_version_id) REFERENCES v3_recipe_versions(id) ON DELETE CASCADE,
    FOREIGN KEY(inventory_item_id) REFERENCES v3_inventory_items(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS inventory_locations (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    name TEXT NOT NULL,
    FOREIGN KEY(branch_id) REFERENCES branches(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inventory_ledger (
    id TEXT PRIMARY KEY,
    inventory_item_id TEXT NOT NULL,
    location_id TEXT,
    change_microunits INTEGER NOT NULL,
    balance_microunits INTEGER NOT NULL,
    reference_type TEXT NOT NULL, -- 'SALE', 'PURCHASE', 'WASTE', 'COUNT'
    reference_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(inventory_item_id) REFERENCES v3_inventory_items(id) ON DELETE CASCADE,
    FOREIGN KEY(location_id) REFERENCES inventory_locations(id) ON DELETE SET NULL
);

-- 5. Orders & Payments
CREATE TABLE IF NOT EXISTS v3_tables (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    table_number INTEGER NOT NULL,
    zone TEXT NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 2,
    status TEXT NOT NULL DEFAULT 'VACANT',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    UNIQUE(branch_id, table_number)
);

CREATE TABLE IF NOT EXISTS v3_customers (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    credit_balance_minor INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS v3_order_sessions (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    table_id TEXT,
    customer_id TEXT,
    created_by TEXT NOT NULL,
    order_type TEXT NOT NULL DEFAULT 'DINE_IN',
    status TEXT NOT NULL DEFAULT 'OPEN',
    subtotal_minor INTEGER NOT NULL DEFAULT 0,
    tax_minor INTEGER NOT NULL DEFAULT 0,
    service_minor INTEGER NOT NULL DEFAULT 0,
    discount_minor INTEGER NOT NULL DEFAULT 0,
    total_minor INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY(table_id) REFERENCES v3_tables(id) ON DELETE SET NULL,
    FOREIGN KEY(customer_id) REFERENCES v3_customers(id) ON DELETE SET NULL,
    FOREIGN KEY(created_by) REFERENCES v3_users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS v3_order_lines (
    id TEXT PRIMARY KEY,
    order_session_id TEXT NOT NULL,
    menu_item_id TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price_minor INTEGER NOT NULL,
    total_minor INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(order_session_id) REFERENCES v3_order_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY(menu_item_id) REFERENCES v3_menu_items(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS v3_payments (
    id TEXT PRIMARY KEY,
    order_session_id TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'EGP',
    payment_method TEXT NOT NULL, -- 'CASH', 'CARD', 'CREDIT'
    status TEXT NOT NULL DEFAULT 'COMPLETED',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(order_session_id) REFERENCES v3_order_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY(created_by) REFERENCES v3_users(id) ON DELETE RESTRICT
);

-- 6. Auditing & Sync
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    response_body TEXT,
    response_status INTEGER
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    actor_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    old_data TEXT,
    new_data TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE,
    FOREIGN KEY(actor_id) REFERENCES v3_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS outbox_events (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    processed_at TEXT,
    error TEXT,
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE
);
