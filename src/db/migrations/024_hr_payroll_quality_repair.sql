-- 024_hr_payroll_quality_repair.sql
-- Authoritative HR Profiles, Effective Rates, Attendance, Payroll Lifecycle & Quality Assurance

-- 1. HR Profiles & Effective Rate History
CREATE TABLE IF NOT EXISTS hr_staff_profiles (
    user_id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL DEFAULT 'V_DEFAULT',
    role TEXT NOT NULL DEFAULT 'WAITER',
    employment_status TEXT NOT NULL DEFAULT 'ACTIVE',
    hire_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    termination_date TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES v3_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS hr_rate_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    hourly_rate_minor INTEGER NOT NULL DEFAULT 0,
    overtime_multiplier REAL NOT NULL DEFAULT 1.5,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES v3_users(id) ON DELETE CASCADE
);

-- 2. Attendance & Leave
CREATE TABLE IF NOT EXISTS hr_attendance (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    venue_id TEXT NOT NULL DEFAULT 'V_DEFAULT',
    shift_id TEXT,
    clock_in TEXT NOT NULL,
    clock_out TEXT,
    break_minutes INTEGER NOT NULL DEFAULT 0,
    approved_productive_minutes INTEGER,
    status TEXT NOT NULL DEFAULT 'PENDING',
    approved_by TEXT,
    approved_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES v3_users(id) ON DELETE CASCADE,
    FOREIGN KEY(approved_by) REFERENCES v3_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS hr_leave (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'PAID',
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'APPROVED',
    approved_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES v3_users(id) ON DELETE CASCADE
);

-- 3. Tips Pools & Adjustments
CREATE TABLE IF NOT EXISTS tip_pools (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL DEFAULT 'V_DEFAULT',
    shift_id TEXT,
    pool_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    source TEXT NOT NULL DEFAULT 'CASH_TIPS',
    total_amount_minor INTEGER NOT NULL DEFAULT 0,
    allocation_method TEXT NOT NULL DEFAULT 'HOURS_WORKED',
    status TEXT NOT NULL DEFAULT 'CALCULATED',
    approved_by TEXT,
    approved_at TEXT,
    allocation_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hr_adjustments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    amount_minor INTEGER NOT NULL DEFAULT 0,
    reason TEXT NOT NULL,
    effective_date TEXT NOT NULL,
    payroll_period_id TEXT,
    actor_id TEXT NOT NULL,
    approval_actor_id TEXT,
    audit_trace_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES v3_users(id) ON DELETE CASCADE
);

-- 4. Payroll Periods & Lines
CREATE TABLE IF NOT EXISTS payroll_periods (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL DEFAULT 'V_DEFAULT',
    period_type TEXT NOT NULL DEFAULT 'MONTHLY',
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    calculated_at TEXT,
    reviewed_at TEXT,
    reviewed_by TEXT,
    approved_at TEXT,
    approved_by TEXT,
    locked_at TEXT,
    locked_by TEXT,
    paid_at TEXT,
    paid_by TEXT,
    total_net_pay_minor INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payroll_lines (
    id TEXT PRIMARY KEY,
    payroll_period_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    hours_worked REAL NOT NULL DEFAULT 0,
    overtime_hours REAL NOT NULL DEFAULT 0,
    hourly_rate_minor INTEGER NOT NULL DEFAULT 0,
    base_pay_minor INTEGER NOT NULL DEFAULT 0,
    overtime_pay_minor INTEGER NOT NULL DEFAULT 0,
    tips_minor INTEGER NOT NULL DEFAULT 0,
    bonuses_minor INTEGER NOT NULL DEFAULT 0,
    rewards_minor INTEGER NOT NULL DEFAULT 0,
    competitions_minor INTEGER NOT NULL DEFAULT 0,
    penalties_minor INTEGER NOT NULL DEFAULT 0,
    advances_minor INTEGER NOT NULL DEFAULT 0,
    deductions_minor INTEGER NOT NULL DEFAULT 0,
    net_pay_minor INTEGER NOT NULL DEFAULT 0,
    recoverable_advance_minor INTEGER NOT NULL DEFAULT 0,
    calculation_trace_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'DRAFT',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(payroll_period_id) REFERENCES payroll_periods(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES v3_users(id) ON DELETE CASCADE,
    UNIQUE(payroll_period_id, user_id)
);

CREATE TABLE IF NOT EXISTS payroll_corrections (
    id TEXT PRIMARY KEY,
    payroll_period_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    correction_type TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    reason TEXT NOT NULL,
    applied_to_payroll_period_id TEXT,
    approved_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(payroll_period_id) REFERENCES payroll_periods(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES v3_users(id) ON DELETE CASCADE
);

-- 5. Quality Assurance & Complaints Lifecycle
CREATE TABLE IF NOT EXISTS quality_complaints (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL DEFAULT 'V_DEFAULT',
    order_session_id TEXT,
    logged_by_user_id TEXT NOT NULL,
    against_user_id TEXT,
    customer_name_masked TEXT DEFAULT 'عميل',
    customer_phone_masked TEXT,
    severity TEXT NOT NULL DEFAULT 'LOW',
    status TEXT NOT NULL DEFAULT 'OPEN',
    description TEXT NOT NULL,
    evidence_json TEXT NOT NULL DEFAULT '[]',
    owner_user_id TEXT,
    root_cause TEXT,
    corrective_action TEXT,
    due_date TEXT,
    resolution_notes TEXT,
    resolved_at TEXT,
    resolved_by TEXT,
    audit_trail_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(logged_by_user_id) REFERENCES v3_users(id) ON DELETE RESTRICT
);

