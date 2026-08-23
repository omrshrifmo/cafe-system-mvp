-- 016_operational_floor.sql

-- 1. KDS Orders
CREATE TABLE IF NOT EXISTS kds_orders (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    order_session_id TEXT NOT NULL,
    station_id TEXT NOT NULL, -- 'BARISTA', 'SHISHA', 'KITCHEN'
    state TEXT NOT NULL DEFAULT 'NEW', -- 'NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'READY', 'SERVED', 'CANCELLED'
    actor_id TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE,
    FOREIGN KEY(order_session_id) REFERENCES v3_order_sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_kds_orders_station ON kds_orders(venue_id, station_id, state);

-- 2. KDS Order Lines
CREATE TABLE IF NOT EXISTS kds_order_lines (
    id TEXT PRIMARY KEY,
    kds_order_id TEXT NOT NULL,
    v3_order_line_id TEXT NOT NULL,
    menu_item_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'NEW', -- 'NEW', 'IN_PROGRESS', 'READY', 'CANCELLED'
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(kds_order_id) REFERENCES kds_orders(id) ON DELETE CASCADE,
    FOREIGN KEY(v3_order_line_id) REFERENCES v3_order_lines(id) ON DELETE CASCADE
);

-- 3. Runner Tasks
CREATE TABLE IF NOT EXISTS runner_tasks (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    task_type TEXT NOT NULL, -- 'DELIVERY', 'TABLE_REQUEST', 'CUSTOMER_ASSISTANCE'
    status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'CLAIMED', 'COMPLETED', 'CANCELLED'
    owner_id TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    context_json TEXT, -- details like table_id, order_id, etc.
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE,
    FOREIGN KEY(owner_id) REFERENCES v3_users(id) ON DELETE SET NULL
);

CREATE INDEX idx_runner_tasks_venue ON runner_tasks(venue_id, status);

-- 4. Alter outbox_events to add new columns (sqlite allows ADD COLUMN one by one)
-- Using a new table approach if there is existing data we don't care to migrate for the sake of these columns,
-- but we can just ADD COLUMN to the existing outbox_events table.
ALTER TABLE outbox_events ADD COLUMN sequence INTEGER;
ALTER TABLE outbox_events ADD COLUMN aggregate_version INTEGER DEFAULT 1;
ALTER TABLE outbox_events ADD COLUMN schema_version TEXT DEFAULT 'v1';
ALTER TABLE outbox_events ADD COLUMN venue_id TEXT;
ALTER TABLE outbox_events ADD COLUMN station_id TEXT;
ALTER TABLE outbox_events ADD COLUMN source_device_id TEXT;

-- Create an index to help with cursor replays
CREATE INDEX idx_outbox_events_venue_seq ON outbox_events(venue_id, sequence);
