-- 020_foundation_repair.sql: Schema Harmonization, Constraints & Performance Indexes

-- 1. Ensure users table has department and phone fields
ALTER TABLE users ADD COLUMN department TEXT DEFAULT 'BARISTA';
ALTER TABLE users ADD COLUMN phone TEXT;

-- 2. Ensure v3_users table has department and phone fields
ALTER TABLE v3_users ADD COLUMN department TEXT DEFAULT 'BARISTA';
ALTER TABLE v3_users ADD COLUMN phone TEXT;

-- 3. Composite and Analytical Indexes for BI and Reporting
CREATE INDEX IF NOT EXISTS idx_order_items_created_status ON order_items(status, created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_dept_status ON order_items(department, status);
CREATE INDEX IF NOT EXISTS idx_payments_session_created ON payments(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_expenses_created ON expenses(created_at);
CREATE INDEX IF NOT EXISTS idx_waste_log_created ON waste_log(created_at);
CREATE INDEX IF NOT EXISTS idx_material_transfers_created ON material_transfers(created_at);
CREATE INDEX IF NOT EXISTS idx_customer_phone ON customers(phone);
