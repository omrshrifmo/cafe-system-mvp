-- 025_add_hr_payroll_columns.sql
-- Ensure all HR and Payroll extension columns are added

-- Note: SQLite ALTER TABLE ADD COLUMN is safe when table exists
ALTER TABLE hr_staff_profiles ADD COLUMN venue_id TEXT DEFAULT "V_DEFAULT";
ALTER TABLE hr_staff_profiles ADD COLUMN role TEXT DEFAULT "WAITER";

ALTER TABLE hr_attendance ADD COLUMN approved_at TEXT;
ALTER TABLE hr_attendance ADD COLUMN notes TEXT;

ALTER TABLE hr_adjustments ADD COLUMN audit_trace_json TEXT;

ALTER TABLE tip_pools ADD COLUMN pool_date TEXT DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE tip_pools ADD COLUMN source TEXT DEFAULT "CASH_TIPS";
ALTER TABLE tip_pools ADD COLUMN approved_by TEXT;
ALTER TABLE tip_pools ADD COLUMN approved_at TEXT;
ALTER TABLE tip_pools ADD COLUMN allocation_json TEXT DEFAULT "[]";

ALTER TABLE payroll_periods ADD COLUMN period_type TEXT DEFAULT "MONTHLY";
ALTER TABLE payroll_periods ADD COLUMN calculated_at TEXT;
ALTER TABLE payroll_periods ADD COLUMN reviewed_at TEXT;
ALTER TABLE payroll_periods ADD COLUMN reviewed_by TEXT;
ALTER TABLE payroll_periods ADD COLUMN approved_at TEXT;
ALTER TABLE payroll_periods ADD COLUMN approved_by TEXT;
ALTER TABLE payroll_periods ADD COLUMN paid_at TEXT;
ALTER TABLE payroll_periods ADD COLUMN paid_by TEXT;
ALTER TABLE payroll_periods ADD COLUMN total_net_pay_minor INTEGER DEFAULT 0;
ALTER TABLE payroll_periods ADD COLUMN version INTEGER DEFAULT 1;

ALTER TABLE payroll_lines ADD COLUMN hours_worked REAL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN overtime_hours REAL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN hourly_rate_minor INTEGER DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN rewards_minor INTEGER DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN competitions_minor INTEGER DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN advances_minor INTEGER DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN status TEXT DEFAULT "DRAFT";
