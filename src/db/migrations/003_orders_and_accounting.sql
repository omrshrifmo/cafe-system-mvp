-- 003_orders_and_accounting.sql: Orders, Accounting, Payments, and Inventory Ledger

CREATE TABLE IF NOT EXISTS order_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_ref TEXT NOT NULL UNIQUE,
  order_type TEXT NOT NULL DEFAULT 'DINE_IN', -- 'DINE_IN', 'TAKEAWAY', 'DELIVERY', 'STAFF'
  table_id INTEGER REFERENCES tables(id),
  customer_id TEXT REFERENCES customers(phone),
  status TEXT NOT NULL DEFAULT 'OPEN', -- 'OPEN', 'PENDING_PAYMENT', 'SETTLED', 'VOIDED', 'CANCELLED'
  currency TEXT NOT NULL DEFAULT 'ج.م',
  subtotal_minor INTEGER NOT NULL DEFAULT 0,
  service_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  discount_minor INTEGER NOT NULL DEFAULT 0,
  tip_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES order_sessions(id) ON DELETE CASCADE,
  menu_item_id INTEGER REFERENCES menu_items(id),
  item_name_snapshot TEXT NOT NULL,
  unit_price_minor INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  modifiers_json TEXT, -- { sugar_level, roast_type, addons: [] }
  recipe_version_id INTEGER REFERENCES recipe_versions(id),
  department TEXT NOT NULL DEFAULT 'BARISTA',
  kds_status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'ACCEPTED', 'READY', 'DELIVERED'
  edit_request TEXT, -- NULL, 'CANCEL_REQUESTED', 'EDIT_REQUESTED'
  cancel_reason TEXT,
  waiter_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'CANCELLED', 'VOIDED'
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES order_sessions(id),
  method TEXT NOT NULL, -- 'CASH', 'INSTAPAY', 'VISA', 'WALLET', 'ON_CREDIT', 'LOYALTY_POINTS'
  amount_minor INTEGER NOT NULL,
  tip_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'ج.م',
  external_ref TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  reversed_by INTEGER REFERENCES users(id),
  reversed_at TEXT
);

CREATE TABLE IF NOT EXISTS payment_reversals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_payment_id INTEGER NOT NULL REFERENCES payments(id),
  amount_minor INTEGER NOT NULL,
  reason TEXT NOT NULL,
  approved_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS inventory_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  event_type TEXT NOT NULL, -- 'PURCHASE', 'CONSUMPTION', 'WASTE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT', 'REVERSAL'
  quantity_delta_microunits INTEGER NOT NULL,
  unit TEXT NOT NULL,
  unit_cost_minor INTEGER DEFAULT 0,
  source_type TEXT, -- 'ORDER_ITEM', 'PURCHASE_INVOICE', 'WASTE_LOG', 'TRANSFER', 'MANUAL'
  source_id TEXT,
  idempotency_key TEXT UNIQUE,
  reason TEXT,
  actor_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER REFERENCES suppliers(id),
  invoice_number TEXT,
  total_cost_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'POSTED',
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  quantity_microunits INTEGER NOT NULL,
  unit TEXT NOT NULL,
  unit_cost_minor INTEGER NOT NULL,
  total_line_minor INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS material_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  item_name TEXT NOT NULL,
  source_dept TEXT NOT NULL,
  target_dept TEXT NOT NULL,
  quantity_microunits INTEGER NOT NULL,
  unit TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'POSTED',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS waste_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  quantity_microunits INTEGER NOT NULL,
  unit TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT 'GENERAL',
  reason TEXT NOT NULL,
  cost_minor INTEGER NOT NULL DEFAULT 0,
  reported_by INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_order_sessions_table ON order_sessions(table_id, status);
CREATE INDEX IF NOT EXISTS idx_order_sessions_created ON order_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_session ON order_items(session_id);
CREATE INDEX IF NOT EXISTS idx_order_items_kds ON order_items(department, kds_status);
CREATE INDEX IF NOT EXISTS idx_payments_session ON payments(session_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_item ON inventory_ledger(inventory_item_id, created_at);
