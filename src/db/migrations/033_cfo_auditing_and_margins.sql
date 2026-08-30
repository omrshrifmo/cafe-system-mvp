-- Migration 033: CFO Auditing, Margins, Hospitality Comps and Reconciliations

CREATE TABLE IF NOT EXISTS inventory_reconciliations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_id INTEGER NOT NULL,
  theoretical_qty REAL NOT NULL,
  actual_qty REAL NOT NULL,
  variance REAL NOT NULL,
  user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_inv_reconciliations_inv ON inventory_reconciliations(inventory_id);
CREATE INDEX IF NOT EXISTS idx_inv_reconciliations_created ON inventory_reconciliations(created_at);

INSERT OR IGNORE INTO system_config (key, value) VALUES ('daily_target', '5000');
