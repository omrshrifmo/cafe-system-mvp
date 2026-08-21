-- 002_canonical_catalog.sql: Canonical Menu, Active Pricing, BOM & Inventory

CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'GENERAL',
  unit TEXT NOT NULL,
  min_limit REAL NOT NULL DEFAULT 5,
  cost_per_unit_minor INTEGER NOT NULL DEFAULT 0,
  default_supplier_id INTEGER,
  current_stock_microunits INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  category TEXT,
  address TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS menu_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  name_en TEXT,
  icon TEXT,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES menu_categories(id),
  name TEXT NOT NULL UNIQUE,
  name_en TEXT,
  description TEXT,
  department TEXT NOT NULL DEFAULT 'BARISTA', -- 'BARISTA', 'KITCHEN', 'SHISHA'
  is_available INTEGER NOT NULL DEFAULT 1,
  is_featured INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS menu_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  amount_minor INTEGER NOT NULL, -- e.g. 5000 = 50.00 EGP
  currency TEXT NOT NULL DEFAULT 'ج.م',
  valid_from TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  valid_to TEXT,
  created_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS recipe_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  instructions TEXT,
  tolerance_basis TEXT NOT NULL DEFAULT 'NONE',
  tolerance_percent_basis_points INTEGER NOT NULL DEFAULT 0, -- 500 = 5%
  active_from TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  active_to TEXT,
  UNIQUE(menu_item_id, version)
);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_version_id INTEGER NOT NULL REFERENCES recipe_versions(id) ON DELETE CASCADE,
  inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  quantity_microunits INTEGER NOT NULL, -- e.g. 20000000 = 20g
  unit TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_delta_minor INTEGER NOT NULL DEFAULT 0,
  is_available INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS item_addons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_minor INTEGER NOT NULL DEFAULT 0,
  is_available INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_dept ON menu_items(department);
CREATE INDEX IF NOT EXISTS idx_menu_prices_item ON menu_prices(menu_item_id, valid_to);
CREATE INDEX IF NOT EXISTS idx_recipe_versions_item ON recipe_versions(menu_item_id, active_to);
