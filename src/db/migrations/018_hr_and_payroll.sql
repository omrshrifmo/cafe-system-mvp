-- 018_hr_and_payroll.sql

-- 1. HR Profiles & Rates
CREATE TABLE IF NOT EXISTS hr_staff_profiles (
    user_id TEXT PRIMARY KEY,
    employment_status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'SUSPENDED', 'TERMINATED'
    hire_date TEXT NOT NULL,
    termination_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(user_id) REFERENCES v3_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS hr_rate_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    hourly_rate_minor INTEGER NOT NULL,
    overtime_multiplier REAL NOT NULL DEFAULT 1.5,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(user_id) REFERENCES v3_users(id) ON DELETE CASCADE
);

-- Ensure no overlapping effective date ranges per user
-- We can't do full temporal constraint in SQLite, but we can do a partial one or enforce in app logic.

-- 2. Attendance & Leave
CREATE TABLE IF NOT EXISTS hr_attendance (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    venue_id TEXT NOT NULL,
    shift_id TEXT, -- nullable if not strictly bound to a shift
    clock_in TEXT NOT NULL,
    clock_out TEXT,
    break_minutes INTEGER NOT NULL DEFAULT 0,
    approved_productive_minutes INTEGER,
    status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'APPROVED', 'REJECTED'
    approved_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(user_id) REFERENCES v3_users(id) ON DELETE CASCADE,
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE,
    FOREIGN KEY(shift_id) REFERENCES v3_shifts(id) ON DELETE SET NULL,
    FOREIGN KEY(approved_by) REFERENCES v3_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS hr_leave (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL, -- 'PAID', 'UNPAID', 'SICK'
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'APPROVED',
    approved_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(user_id) REFERENCES v3_users(id) ON DELETE CASCADE,
    FOREIGN KEY(approved_by) REFERENCES v3_users(id) ON DELETE RESTRICT
);

-- 3. Adjustments & Tips
CREATE TABLE IF NOT EXISTS tip_pools (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    shift_id TEXT,
    total_amount_minor INTEGER NOT NULL,
    allocation_method TEXT NOT NULL, -- 'HOURS_WORKED', 'EQUAL', 'POINTS'
    status TEXT NOT NULL DEFAULT 'CALCULATED',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE,
    FOREIGN KEY(shift_id) REFERENCES v3_shifts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS hr_adjustments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL, -- 'BONUS', 'PENALTY', 'ADVANCE', 'COMMISSION'
    amount_minor INTEGER NOT NULL,
    reason TEXT NOT NULL,
    effective_date TEXT NOT NULL,
    payroll_period_id TEXT, -- Null if unassigned, set when locked in a period
    actor_id TEXT NOT NULL,
    approval_actor_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(user_id) REFERENCES v3_users(id) ON DELETE CASCADE,
    FOREIGN KEY(actor_id) REFERENCES v3_users(id) ON DELETE RESTRICT,
    FOREIGN KEY(approval_actor_id) REFERENCES v3_users(id) ON DELETE RESTRICT
);

-- 4. Payroll
CREATE TABLE IF NOT EXISTS payroll_periods (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT', -- 'DRAFT', 'CALCULATED', 'REVIEWED', 'APPROVED', 'LOCKED', 'PAID'
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    locked_at TEXT,
    locked_by TEXT,
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE,
    FOREIGN KEY(locked_by) REFERENCES v3_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS payroll_lines (
    id TEXT PRIMARY KEY,
    payroll_period_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    base_pay_minor INTEGER NOT NULL DEFAULT 0,
    overtime_pay_minor INTEGER NOT NULL DEFAULT 0,
    tips_minor INTEGER NOT NULL DEFAULT 0,
    bonuses_minor INTEGER NOT NULL DEFAULT 0,
    penalties_minor INTEGER NOT NULL DEFAULT 0,
    deductions_minor INTEGER NOT NULL DEFAULT 0,
    net_pay_minor INTEGER NOT NULL DEFAULT 0,
    recoverable_advance_minor INTEGER NOT NULL DEFAULT 0, -- If net pay was negative and rolled into advance
    calculation_trace_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(payroll_period_id) REFERENCES payroll_periods(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES v3_users(id) ON DELETE CASCADE,
    UNIQUE(payroll_period_id, user_id)
);
