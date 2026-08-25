-- 026_reporting_bi_indexes.sql
-- Performance Indexes for Business Intelligence, Reporting Engine & Fast Aggregations

CREATE INDEX IF NOT EXISTS idx_v3_order_sessions_reporting_v2 ON v3_order_sessions(branch_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_v3_order_lines_session_dept ON v3_order_lines(order_session_id, menu_item_id, status);
CREATE INDEX IF NOT EXISTS idx_v3_payments_status_method_created ON v3_payments(status, payment_method, created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_item_event_created ON inventory_ledger(inventory_item_id, event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_payroll_periods_venue_status_dates ON payroll_periods(venue_id, status, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_payroll_lines_period_user ON payroll_lines(payroll_period_id, user_id);
CREATE INDEX IF NOT EXISTS idx_cash_ops_venue_type_created ON cash_operations(venue_id, type, created_at);
CREATE INDEX IF NOT EXISTS idx_equity_ledger_venue_event_effective ON equity_ledger(venue_id, event_type, effective_date);
CREATE INDEX IF NOT EXISTS idx_hr_attendance_venue_status_clockin ON hr_attendance(venue_id, status, clock_in);
CREATE INDEX IF NOT EXISTS idx_daily_expenses_dates ON daily_expenses(expense_date, created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_dept_status ON order_items(department, status, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_method_created ON payments(method, created_at);
CREATE INDEX IF NOT EXISTS idx_reversals_session_type ON reversals(order_session_id, type, created_at);
