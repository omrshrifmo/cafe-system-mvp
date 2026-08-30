-- Migration: 032_advanced_operations_and_promotions.sql
-- Entertainment, WiFi vouchers, Promotions, and Reservations enhancements

CREATE TABLE IF NOT EXISTS rentable_resources (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL DEFAULT 'V_DEFAULT',
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  hourly_rate_single REAL NOT NULL DEFAULT 40.0,
  hourly_rate_multi REAL NOT NULL DEFAULT 60.0,
  status TEXT NOT NULL DEFAULT 'AVAILABLE',
  current_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS entertainment_sessions (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL DEFAULT 'V_DEFAULT',
  resource_id TEXT NOT NULL,
  table_number INTEGER,
  player_mode TEXT NOT NULL DEFAULT 'SINGLE',
  started_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  ended_at TEXT,
  duration_minutes INTEGER DEFAULT 0,
  hourly_rate REAL NOT NULL,
  total_amount REAL NOT NULL DEFAULT 0.0,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  order_session_id TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (resource_id) REFERENCES rentable_resources(id)
);

CREATE TABLE IF NOT EXISTS wifi_vouchers (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  profile TEXT NOT NULL DEFAULT '1_HOUR',
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  data_limit_mb INTEGER DEFAULT 0,
  price REAL NOT NULL DEFAULT 10.0,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  mikrotik_hotspot_command TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  target_item_name TEXT,
  reward_item_name TEXT,
  discount_percent REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  start_time TEXT,
  end_time TEXT,
  min_spend REAL DEFAULT 0,
  customer_tier TEXT DEFAULT 'ALL',
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id INTEGER NOT NULL,
  ingredient_id INTEGER NOT NULL,
  quantity_required REAL NOT NULL,
  unit TEXT NOT NULL,
  tolerance_percentage REAL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Seed default rentable gaming resources if empty
INSERT OR IGNORE INTO rentable_resources (id, name, type, hourly_rate_single, hourly_rate_multi, status) VALUES
('PS5_01', 'بلايستيشن 5 - جهاز 1', 'PS5', 60.0, 90.0, 'AVAILABLE'),
('PS5_02', 'بلايستيشن 5 - جهاز 2', 'PS5', 60.0, 90.0, 'AVAILABLE'),
('PS4_01', 'بلايستيشن 4 - جهاز 1', 'PS4', 40.0, 60.0, 'AVAILABLE'),
('XBOX_01', 'إكس بوكس سيريس X', 'XBOX', 50.0, 75.0, 'AVAILABLE'),
('BILLIARD_01', 'طاولة بلياردو فرنساوية VIP', 'BILLIARDS', 70.0, 70.0, 'AVAILABLE');
