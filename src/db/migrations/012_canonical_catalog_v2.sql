-- 012_canonical_catalog_v2.sql: Canonical Catalog, Lifecycle, Active Pricing, and BOM Updates

-- 1. Catalog and Lifecycle Updates
ALTER TABLE menu_items ADD COLUMN sku TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_items_sku ON menu_items(sku) WHERE sku IS NOT NULL;
ALTER TABLE menu_items ADD COLUMN image_ref TEXT;
ALTER TABLE menu_items ADD COLUMN is_sellable INTEGER NOT NULL DEFAULT 1;
ALTER TABLE menu_items ADD COLUMN is_ingredient INTEGER NOT NULL DEFAULT 0;
ALTER TABLE menu_items ADD COLUMN tax_class TEXT NOT NULL DEFAULT 'STANDARD';
ALTER TABLE menu_items ADD COLUMN allergens TEXT;
ALTER TABLE menu_items ADD COLUMN venue_scope TEXT NOT NULL DEFAULT 'ALL';
ALTER TABLE menu_items ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'PUBLISHED';
ALTER TABLE menu_items ADD COLUMN publication_version INTEGER NOT NULL DEFAULT 1;

-- 2. Pricing Updates
ALTER TABLE menu_prices ADD COLUMN author_id INTEGER REFERENCES users(id);
ALTER TABLE menu_prices ADD COLUMN reason TEXT;
ALTER TABLE menu_prices ADD COLUMN approved_by INTEGER REFERENCES users(id);
ALTER TABLE menu_prices ADD COLUMN publication_version INTEGER NOT NULL DEFAULT 1;

-- 3. Offers System
CREATE TABLE IF NOT EXISTS catalog_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  discount_type TEXT NOT NULL,
  discount_value_minor INTEGER NOT NULL,
  eligibility_rules_json TEXT NOT NULL DEFAULT '{}',
  stacking_rules_json TEXT NOT NULL DEFAULT '{}',
  usage_limit INTEGER,
  valid_from TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  valid_to TEXT,
  author_id INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  lifecycle_state TEXT NOT NULL DEFAULT 'PUBLISHED',
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 4. Inventory Tracking Metadata
ALTER TABLE inventory_items ADD COLUMN canonical_unit TEXT;
ALTER TABLE inventory_items ADD COLUMN storage_location TEXT;
ALTER TABLE inventory_items ADD COLUMN reorder_level REAL NOT NULL DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN shelf_life_days INTEGER;
ALTER TABLE inventory_items ADD COLUMN allergen_traceability TEXT;

-- 5. BOM (Recipe Ingredients) Costing and Yield
ALTER TABLE recipe_ingredients ADD COLUMN yield_percent INTEGER NOT NULL DEFAULT 100;
ALTER TABLE recipe_ingredients ADD COLUMN preparation_loss_percent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recipe_ingredients ADD COLUMN station_id TEXT;
ALTER TABLE recipe_ingredients ADD COLUMN optional_alternative_rule TEXT;
ALTER TABLE recipe_ingredients ADD COLUMN cost_basis TEXT NOT NULL DEFAULT 'WEIGHTED_AVERAGE';

-- 6. Order Line Historical Snapshots
ALTER TABLE order_items ADD COLUMN price_minor INTEGER;
ALTER TABLE order_items ADD COLUMN tax_minor INTEGER;
ALTER TABLE order_items ADD COLUMN service_minor INTEGER;
ALTER TABLE order_items ADD COLUMN discount_minor INTEGER;
ALTER TABLE order_items ADD COLUMN offer_id INTEGER REFERENCES catalog_offers(id);
ALTER TABLE order_items ADD COLUMN catalog_version INTEGER;
ALTER TABLE order_items ADD COLUMN quote_snapshot TEXT;
