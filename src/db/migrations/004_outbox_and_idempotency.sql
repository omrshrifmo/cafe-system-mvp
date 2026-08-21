-- 004_outbox_and_idempotency.sql: Print Jobs Outbox, Realtime Outbox, Idempotency & Auditing

CREATE TABLE IF NOT EXISTS print_jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL, -- 'RECEIPT', 'KITCHEN_TICKET', 'Z_REPORT', 'TEST'
  printer_ip TEXT NOT NULL DEFAULT '192.168.1.100',
  printer_port INTEGER NOT NULL DEFAULT 9100,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'PRINTING', 'COMPLETED', 'RETRYING', 'FAILED'
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  printed_at TEXT
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  topic TEXT NOT NULL, -- 'ORDER_PLACED', 'KDS_STATUS_CHANGED', 'TABLE_STATE_CHANGED', 'CONFIG_UPDATED'
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id),
  operation TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER,
  response_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  target_table TEXT NOT NULL,
  record_id TEXT,
  previous_value TEXT,
  new_value TEXT,
  request_id TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_outbox_events_status ON outbox_events(status);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
