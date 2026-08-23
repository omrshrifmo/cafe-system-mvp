-- 017_shifts_and_eod.sql

-- 1. Shifts
CREATE TABLE IF NOT EXISTS v3_shifts (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    business_date TEXT NOT NULL, -- YYYY-MM-DD
    timezone TEXT NOT NULL DEFAULT 'UTC',
    shift_type TEXT NOT NULL, -- 'MORNING', 'NIGHT', 'ALL_DAY'
    status TEXT NOT NULL DEFAULT 'PLANNED', -- 'PLANNED', 'OPEN', 'HANDOVER_PENDING', 'CLOSED', 'REOPENED_BY_APPROVAL', 'ARCHIVED'
    opened_by TEXT,
    opened_at TEXT,
    opening_float_minor INTEGER NOT NULL DEFAULT 0,
    counted_cash_minor INTEGER,
    expected_cash_minor INTEGER,
    variance_minor INTEGER,
    closed_by TEXT,
    closed_at TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE,
    FOREIGN KEY(opened_by) REFERENCES v3_users(id) ON DELETE SET NULL,
    FOREIGN KEY(closed_by) REFERENCES v3_users(id) ON DELETE SET NULL
);

-- Ensure only one shift of a given type per business date can exist per venue
CREATE UNIQUE INDEX idx_shifts_business_date_type ON v3_shifts(venue_id, business_date, shift_type);

-- 2. Shift Handovers (Snapshot of state at close/handover)
CREATE TABLE IF NOT EXISTS shift_handovers (
    id TEXT PRIMARY KEY,
    shift_id TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(shift_id) REFERENCES v3_shifts(id) ON DELETE CASCADE,
    FOREIGN KEY(created_by) REFERENCES v3_users(id) ON DELETE RESTRICT
);

-- 3. Cash Operations (Expenses, Advances, Withdrawals, Adjustments)
CREATE TABLE IF NOT EXISTS cash_operations (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    shift_id TEXT NOT NULL,
    type TEXT NOT NULL, -- 'EXPENSE', 'ADVANCE', 'WITHDRAWAL', 'ADJUSTMENT'
    amount_minor INTEGER NOT NULL, -- Positive represents cash OUT, except ADJUSTMENT which can be neg/pos
    reason TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    approval_actor_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE,
    FOREIGN KEY(shift_id) REFERENCES v3_shifts(id) ON DELETE RESTRICT,
    FOREIGN KEY(actor_id) REFERENCES v3_users(id) ON DELETE RESTRICT,
    FOREIGN KEY(approval_actor_id) REFERENCES v3_users(id) ON DELETE RESTRICT
);

-- 4. Accounting Periods (Locks)
CREATE TABLE IF NOT EXISTS accounting_periods (
    id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    period_date TEXT NOT NULL, -- YYYY-MM-DD or YYYY-Wxx or YYYY-MM
    period_type TEXT NOT NULL, -- 'DAILY', 'WEEKLY', 'MONTHLY'
    status TEXT NOT NULL DEFAULT 'OPEN', -- 'OPEN', 'LOCKED'
    locked_by TEXT,
    locked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE CASCADE,
    FOREIGN KEY(locked_by) REFERENCES v3_users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX idx_accounting_periods_date_type ON accounting_periods(venue_id, period_date, period_type);
