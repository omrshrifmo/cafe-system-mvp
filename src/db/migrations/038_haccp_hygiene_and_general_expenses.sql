-- Migration 038: HACCP Hygiene Temperature Logs & Cleaning Checklists & General Expenses Enhancements

-- 1. HACCP Fridge & Freezer Temperature Logs
CREATE TABLE IF NOT EXISTS haccp_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_name TEXT NOT NULL, -- e.g. 'ثلاجة الحليب 1', 'فريزر الآيس كريم', 'ثلاجة الكيك والحلويات'
    unit_type TEXT NOT NULL DEFAULT 'FRIDGE', -- 'FRIDGE', 'FREEZER', 'STORAGE'
    temperature REAL NOT NULL,
    min_safe_temp REAL DEFAULT 2.0,
    max_safe_temp REAL DEFAULT 5.0,
    is_alert BOOLEAN DEFAULT 0,
    logged_by TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_haccp_created ON haccp_logs(created_at);

-- 2. Daily & Weekly Cleaning / Sanitation Checklists
CREATE TABLE IF NOT EXISTS cleaning_checklists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'DAILY', -- 'DAILY', 'WEEKLY', 'MONTHLY'
    department TEXT NOT NULL DEFAULT 'BARISTA', -- 'BARISTA', 'KITCHEN', 'FLOOR', 'ALL'
    is_completed BOOLEAN DEFAULT 0,
    completed_by TEXT,
    user_id INTEGER REFERENCES users(id),
    completed_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_cleaning_completed ON cleaning_checklists(is_completed, category);

-- Seed default sanitation tasks if empty
INSERT INTO cleaning_checklists (task_name, category, department)
SELECT 'تعقيم عصا البخار (Steam Wand) بالبار', 'DAILY', 'BARISTA'
WHERE NOT EXISTS (SELECT 1 FROM cleaning_checklists LIMIT 1);

INSERT INTO cleaning_checklists (task_name, category, department)
SELECT 'تفريغ وتنظيف باسكت القهوة ومصيدة البقايا (Knock Box)', 'DAILY', 'BARISTA'
WHERE NOT EXISTS (SELECT 1 FROM cleaning_checklists WHERE task_name LIKE '%Knock Box%');

INSERT INTO cleaning_checklists (task_name, category, department)
SELECT 'فحص وتوثيق درجات حرارة الثلاجات والمجمدات (HACCP Log)', 'DAILY', 'ALL'
WHERE NOT EXISTS (SELECT 1 FROM cleaning_checklists WHERE task_name LIKE '%HACCP%');

INSERT INTO cleaning_checklists (task_name, category, department)
SELECT 'تطهير ومسح أرضيات البار والصالة وطاولات الخدمة', 'DAILY', 'FLOOR'
WHERE NOT EXISTS (SELECT 1 FROM cleaning_checklists WHERE task_name LIKE '%أرضيات%');

INSERT INTO cleaning_checklists (task_name, category, department)
SELECT 'تنظيف شفرات المطحنة وإزالة زيوت البن المتراكمة (Grinder Flush)', 'WEEKLY', 'BARISTA'
WHERE NOT EXISTS (SELECT 1 FROM cleaning_checklists WHERE task_name LIKE '%المطحنة%');

INSERT INTO cleaning_checklists (task_name, category, department)
SELECT 'إزالة الرواسب الكلسية والغسيل العكسي لمكينة الإسبريسو (Backflush)', 'WEEKLY', 'BARISTA'
WHERE NOT EXISTS (SELECT 1 FROM cleaning_checklists WHERE task_name LIKE '%Backflush%');

-- 3. Ensure system_config has USB printer defaults
INSERT OR IGNORE INTO system_config (key, value) VALUES ('printer_connection_type', 'NETWORK');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('printer_name', 'ReceiptPrinter');
