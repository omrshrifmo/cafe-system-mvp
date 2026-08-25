-- Migration 021: Setup Onboarding Progress & Catalog Master Data Harmonization
-- Transactional Migration

-- 1. Onboarding Progress Table for Resumable Setup Wizard
CREATE TABLE IF NOT EXISTS onboarding_progress (
  id TEXT PRIMARY KEY DEFAULT 'WIZARD_DEFAULT',
  current_step INTEGER NOT NULL DEFAULT 1,
  completed_steps TEXT NOT NULL DEFAULT '[]',
  draft_payload TEXT NOT NULL DEFAULT '{}',
  mode TEXT NOT NULL DEFAULT 'ONBOARDING',
  last_saved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL
);

-- Initialize default onboarding progress row if not exists
INSERT OR IGNORE INTO onboarding_progress (id, current_step, completed_steps, draft_payload, mode)
VALUES ('WIZARD_DEFAULT', 1, '[]', '{}', 'ONBOARDING');

-- 2. Add Missing Columns to Categories, Items, and Sessions
ALTER TABLE menu_categories ADD COLUMN is_quarantined INTEGER DEFAULT 0;
ALTER TABLE menu_categories ADD COLUMN quarantine_reason TEXT NULL;

ALTER TABLE menu_items ADD COLUMN modifiers_json TEXT DEFAULT '[]';
ALTER TABLE menu_items ADD COLUMN effective_from DATETIME DEFAULT NULL;
ALTER TABLE menu_items ADD COLUMN effective_to DATETIME NULL;
ALTER TABLE menu_items ADD COLUMN is_quarantined INTEGER DEFAULT 0;
ALTER TABLE menu_items ADD COLUMN quarantine_reason TEXT NULL;

ALTER TABLE order_sessions ADD COLUMN policy_version INTEGER DEFAULT 1;

-- 3. Quarantine Empty / Legacy Customer Categories
INSERT INTO menu_categories (id, name, name_en, icon, color, sort_order, is_active, is_quarantined, quarantine_reason)
VALUES
  (8, 'BARISTA', 'Barista Station', '☕', '#64748b', 99, 0, 1, 'INTERNAL_STATION_ROUTING_ONLY'),
  (9, 'SHISHA', 'Shisha Station', '💨', '#64748b', 99, 0, 1, 'INTERNAL_STATION_ROUTING_ONLY'),
  (10, 'KITCHEN', 'Kitchen Station', '🍳', '#64748b', 99, 0, 1, 'INTERNAL_STATION_ROUTING_ONLY')
ON CONFLICT(id) DO UPDATE SET 
  is_active = 0, 
  is_quarantined = 1, 
  quarantine_reason = 'INTERNAL_STATION_ROUTING_ONLY';

UPDATE menu_categories 
SET is_active = 0, 
    is_quarantined = 1, 
    quarantine_reason = 'INTERNAL_STATION_ROUTING_ONLY'
WHERE name IN ('BARISTA', 'SHISHA', 'KITCHEN') OR id IN (8, 9, 10);

-- 4. Ensure Canonical Customer Categories
UPDATE menu_categories SET name = 'temp_' || id;

INSERT INTO menu_categories (id, name, name_en, icon, color, sort_order, is_active, is_quarantined)
VALUES 
  (1, 'مشروبات ساخنة', 'Hot Drinks', '☕', '#d97706', 1, 1, 0),
  (2, 'حلويات', 'Desserts', '🍰', '#db2777', 3, 1, 0),
  (3, 'مشروبات باردة', 'Cold Drinks', '🧊', '#0284c7', 2, 1, 0),
  (6, 'مأكولات', 'Food', '🥪', '#16a34a', 4, 1, 0),
  (7, 'شيشة', 'Shisha', '💨', '#7c3aed', 5, 1, 0)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  name_en = excluded.name_en,
  icon = excluded.icon,
  color = excluded.color,
  sort_order = excluded.sort_order,
  is_active = 1,
  is_quarantined = 0;

-- 5. Correct Categories & Assign Deterministic SKUs
-- Hot Drinks
UPDATE menu_items SET category_id = 1, department = 'BARISTA', name_en = 'Single Espresso', sku = 'SKU-BEV-ESPRESSO-SGL' WHERE id = 1;
UPDATE menu_items SET category_id = 1, department = 'BARISTA', name_en = 'Double Espresso', sku = 'SKU-BEV-ESPRESSO-DBL' WHERE id = 2;
UPDATE menu_items SET category_id = 1, department = 'BARISTA', name_en = 'Caffe Latte', sku = 'SKU-BEV-LATTE' WHERE id = 3;
UPDATE menu_items SET category_id = 1, department = 'BARISTA', name_en = 'Italian Cappuccino', sku = 'SKU-BEV-CAPPUCCINO' WHERE id = 4;

-- Cold Drinks (Reclassified from Desserts / other)
UPDATE menu_items SET category_id = 3, department = 'BARISTA', name_en = 'Iced Vanilla Latte', sku = 'SKU-BEV-LATTE-ICE', tax_class = 'STANDARD' WHERE id = 5;
UPDATE menu_items SET category_id = 3, department = 'BARISTA', name_en = 'Lemon Mint Mojito', sku = 'SKU-BEV-MOJITO-MINT', tax_class = 'STANDARD' WHERE id = 6;

-- Shisha
UPDATE menu_items SET category_id = 7, department = 'SHISHA', name_en = 'Double Apple Shisha', sku = 'SKU-SHI-DOUBLE-APPLE' WHERE id = 7;
UPDATE menu_items SET category_id = 7, department = 'SHISHA', name_en = 'Mint Shisha', sku = 'SKU-SHI-MINT' WHERE id = 8;
UPDATE menu_items SET category_id = 7, department = 'SHISHA', name_en = 'Flavored Shisha', sku = 'SKU-SHI-FRUITS' WHERE id = 13;

-- Food & Sandwiches
UPDATE menu_items SET category_id = 6, department = 'KITCHEN', name = 'كلوب ساندوتش فراخ مشوية', name_en = 'Grilled Chicken Club Sandwich', sku = 'SKU-FOOD-CLUBSANDWICH-CHK' WHERE id = 9;
UPDATE menu_items SET category_id = 6, department = 'KITCHEN', name_en = 'Crispy French Fries', sku = 'SKU-FOOD-FRIES' WHERE id = 10;

-- Disambiguated 2nd Club Sandwich
INSERT INTO menu_items (id, name, name_en, sku, category_id, department, is_available, is_sellable, tax_class)
VALUES (19, 'كلوب ساندوتش تركي وجبن', 'Turkey & Cheese Club Sandwich', 'SKU-FOOD-CLUBSANDWICH-TRK', 6, 'KITCHEN', 1, 1, 'STANDARD')
ON CONFLICT(id) DO UPDATE SET 
  name = 'كلوب ساندوتش تركي وجبن',
  name_en = 'Turkey & Cheese Club Sandwich',
  sku = 'SKU-FOOD-CLUBSANDWICH-TRK',
  category_id = 6,
  department = 'KITCHEN';

-- Desserts (Reclassified from Hot Drinks / other)
UPDATE menu_items SET category_id = 2, department = 'KITCHEN', name = 'كريم بروليه فاخر', name_en = 'Crème Brûlée', sku = 'SKU-DSRT-CREME-BRULEE', tax_class = 'STANDARD' WHERE id = 11;
UPDATE menu_items SET category_id = 2, department = 'KITCHEN', name_en = 'Molten Chocolate Cake', sku = 'SKU-DSRT-MOLTEN-CAKE', tax_class = 'STANDARD' WHERE id = 12;

-- Fallback for any unassigned item
UPDATE menu_items SET sku = 'SKU-ITEM-' || id WHERE sku IS NULL OR sku = '';

-- 6. Create Index on SKU and Publication State
CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_items_sku ON menu_items(sku);
CREATE INDEX IF NOT EXISTS idx_menu_items_published ON menu_items(category_id, is_available, lifecycle_state);
CREATE INDEX IF NOT EXISTS idx_order_sessions_policy ON order_sessions(policy_version);
