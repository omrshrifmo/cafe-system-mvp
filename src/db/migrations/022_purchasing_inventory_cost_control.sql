-- Migration 022: Safe Raw-Material, Purchasing Lifecycle & Operating-Cost Control
-- Transactional Migration

-- 1. Enhance Suppliers Master
ALTER TABLE suppliers ADD COLUMN contact_person TEXT NULL;
ALTER TABLE suppliers ADD COLUMN email TEXT NULL;
ALTER TABLE suppliers ADD COLUMN tax_identity TEXT NULL;
ALTER TABLE suppliers ADD COLUMN status TEXT DEFAULT 'ACTIVE';
ALTER TABLE suppliers ADD COLUMN payment_terms TEXT DEFAULT 'NET_30';
ALTER TABLE suppliers ADD COLUMN lead_time_days INTEGER DEFAULT 2;
ALTER TABLE suppliers ADD COLUMN minimum_order_minor INTEGER DEFAULT 0;

-- 2. Enhance Purchases Table for Full Document Lifecycle
ALTER TABLE purchases ADD COLUMN venue_id TEXT DEFAULT 'V_DEFAULT';
ALTER TABLE purchases ADD COLUMN currency TEXT DEFAULT 'ج.م';
ALTER TABLE purchases ADD COLUMN tax_minor INTEGER DEFAULT 0;
ALTER TABLE purchases ADD COLUMN subtotal_minor INTEGER DEFAULT 0;
ALTER TABLE purchases ADD COLUMN status TEXT DEFAULT 'DRAFT';
ALTER TABLE purchases ADD COLUMN grn_number TEXT NULL;
ALTER TABLE purchases ADD COLUMN document_ref TEXT NULL;
ALTER TABLE purchases ADD COLUMN attachment_ref TEXT NULL;
ALTER TABLE purchases ADD COLUMN approved_by INTEGER NULL;
ALTER TABLE purchases ADD COLUMN idempotency_key TEXT NULL;
ALTER TABLE purchases ADD COLUMN request_id TEXT NULL;
ALTER TABLE purchases ADD COLUMN receipt_date TEXT DEFAULT NULL;
ALTER TABLE purchases ADD COLUMN updated_at DATETIME DEFAULT NULL;

-- 3. Enhance Inventory Ledger with Granular Traceability
ALTER TABLE inventory_ledger ADD COLUMN location_id TEXT DEFAULT 'MAIN_STORE';
ALTER TABLE inventory_ledger ADD COLUMN device_id TEXT NULL;
ALTER TABLE inventory_ledger ADD COLUMN request_id TEXT NULL;
ALTER TABLE inventory_ledger ADD COLUMN cost_basis TEXT DEFAULT 'WEIGHTED_AVERAGE';
ALTER TABLE inventory_ledger ADD COLUMN batch_id TEXT NULL;

-- 4. Indirect Cost Allocation Table
CREATE TABLE IF NOT EXISTS indirect_cost_allocations (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL DEFAULT 'V_DEFAULT',
  expense_id TEXT NOT NULL,
  allocation_basis TEXT NOT NULL, -- REVENUE_PROPORTION, HOURS_PROPORTION, COVERS_PROPORTION, AREA_PROPORTION, CONSUMPTION_PROPORTION
  basis_version INTEGER NOT NULL DEFAULT 1,
  department TEXT NOT NULL,       -- BARISTA, KITCHEN, SHISHA, GENERAL
  ratio_basis_points INTEGER NOT NULL, -- e.g. 5000 = 50.00%
  allocated_amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ج.م',
  notes TEXT,
  created_at DATETIME NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 5. Indexes for Fast Traceability and Idempotency
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_idemp ON purchases(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_source ON inventory_ledger(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_indirect_allocations_exp ON indirect_cost_allocations(expense_id, department);

-- 6. Reconcile Supplier Defaults & Non-Zero Costs for Inventory Items
UPDATE inventory_items SET default_supplier_id = 1 WHERE default_supplier_id IS NULL AND id IN (1, 10, 11);
UPDATE inventory_items SET default_supplier_id = 2 WHERE default_supplier_id IS NULL AND id IN (2, 7, 8, 9, 12);
UPDATE inventory_items SET default_supplier_id = 3 WHERE default_supplier_id IS NULL AND id IN (3, 4, 5, 6);
UPDATE inventory_items SET default_supplier_id = 1 WHERE default_supplier_id IS NULL;

UPDATE inventory_items SET cost_per_unit_minor = 4 WHERE cost_per_unit_minor = 0 AND id = 2;
UPDATE inventory_items SET cost_basis = 'WEIGHTED_AVERAGE' WHERE cost_basis IS NULL;
UPDATE inventory_items SET negative_stock_policy = 'BLOCK' WHERE negative_stock_policy IS NULL OR negative_stock_policy = 'VENUE_DEFAULT';

-- 7. Ensure Complete Mathematical Parity Between Inventory Balance and Ledger
INSERT OR IGNORE INTO inventory_ledger (
  inventory_item_id, event_type, quantity_delta_microunits, unit,
  unit_cost_minor, source_type, source_id, idempotency_key,
  reason, actor_id, location_id, cost_basis
)
SELECT 
  i.id, 
  'OPENING', 
  (i.current_stock_microunits - COALESCE(SUM(l.quantity_delta_microunits), 0)), 
  i.unit, 
  i.cost_per_unit_minor, 
  'SYSTEM_INIT', 
  'OPENING_PARITY', 
  'OPENING_PARITY_' || i.id, 
  'تسوية ومطابقة الرصيد الافتتاحي مع رصيد المخزن', 
  1, 
  'MAIN_STORE', 
  'WEIGHTED_AVERAGE'
FROM inventory_items i
LEFT JOIN inventory_ledger l ON i.id = l.inventory_item_id
GROUP BY i.id
HAVING (i.current_stock_microunits - COALESCE(SUM(l.quantity_delta_microunits), 0)) != 0;

-- 8. Synchronize v3_users to legacy users table for FK integrity
INSERT OR IGNORE INTO users (id, name, role, is_active)
SELECT CAST(id AS INTEGER), name, role_id, is_active 
FROM v3_users 
WHERE CAST(id AS INTEGER) > 0;

