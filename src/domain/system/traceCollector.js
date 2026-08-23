/**
 * Enterprise Transaction & Event Trace Collector
 * Records comprehensive audit traces for all operational and financial events:
 * - Actor (id, role, name)
 * - Venue (venue_id)
 * - Device (device_id / user-agent / client IP)
 * - Shift (shift_id, business_date)
 * - Operation (e.g., ORDER_CREATE, PAYMENT_SETTLE, STOCK_TRANSFER, SHIFT_OPEN, KDS_READY, etc.)
 * - Source ID (order ID, payment ID, transaction ID, line ID)
 * - Request ID (trace correlation ID)
 * - Idempotency Key
 * - Before & After State (JSON snapshots)
 * - Timestamp (ISO 8601)
 */
const crypto = require('crypto');
const { runQuery, allQuery } = require('../../db/connection');
const logger = require('../../observability/logger');

let isTableInitialized = false;

async function initTraceTable(db = null) {
  if (isTableInitialized) return;
  const sql = `
    CREATE TABLE IF NOT EXISTS transaction_traces (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      actor_role TEXT,
      actor_name TEXT,
      venue_id TEXT NOT NULL DEFAULT 'V_DEFAULT',
      device_id TEXT,
      shift_id TEXT,
      business_date TEXT,
      operation TEXT NOT NULL,
      source_id TEXT,
      request_id TEXT,
      idempotency_key TEXT,
      before_state TEXT,
      after_state TEXT,
      status TEXT NOT NULL DEFAULT 'COMMITTED',
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_traces_op ON transaction_traces(operation);
    CREATE INDEX IF NOT EXISTS idx_traces_req ON transaction_traces(request_id);
    CREATE INDEX IF NOT EXISTS idx_traces_source ON transaction_traces(source_id);
    CREATE INDEX IF NOT EXISTS idx_traces_shift ON transaction_traces(shift_id);
  `;
  try {
    const stmts = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
    for (const stmt of stmts) {
      await runQuery(stmt, [], db);
    }
    isTableInitialized = true;
  } catch (err) {
    logger.error('Failed to initialize transaction_traces table', { error: err.message });
  }
}

/**
 * Records an immutable event/transaction trace.
 * @param {Object} traceData
 */
async function recordTrace(traceData = {}, customDb = null) {
  try {
    await initTraceTable(customDb);

    const traceId = traceData.id || `TRC-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const actorId = traceData.actor?.id || traceData.actor_id || null;
    const actorRole = traceData.actor?.role || traceData.actor_role || null;
    const actorName = traceData.actor?.name || traceData.actor_name || null;
    const venueId = traceData.venue || traceData.venue_id || 'V_DEFAULT';
    const deviceId = traceData.device || traceData.device_id || null;
    const shiftId = traceData.shift || traceData.shift_id || null;
    const businessDate = traceData.businessDate || traceData.business_date || new Date().toISOString().split('T')[0];
    const operation = traceData.operation || 'UNKNOWN_OPERATION';
    const sourceId = traceData.sourceId || traceData.source_id || null;
    const requestId = traceData.requestId || traceData.request_id || null;
    const idempotencyKey = traceData.idempotencyKey || traceData.idempotency_key || null;
    
    const beforeState = traceData.beforeState || traceData.before_state ? JSON.stringify(traceData.beforeState || traceData.before_state) : null;
    const afterState = traceData.afterState || traceData.after_state ? JSON.stringify(traceData.afterState || traceData.after_state) : null;
    const status = traceData.status || 'COMMITTED';
    const metadata = traceData.metadata ? JSON.stringify(traceData.metadata) : null;
    const timestamp = traceData.timestamp || new Date().toISOString();

    const sql = `
      INSERT INTO transaction_traces (
        id, actor_id, actor_role, actor_name, venue_id, device_id,
        shift_id, business_date, operation, source_id, request_id,
        idempotency_key, before_state, after_state, status, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await runQuery(sql, [
      traceId, actorId, actorRole, actorName, venueId, deviceId,
      shiftId, businessDate, operation, sourceId, requestId,
      idempotencyKey, beforeState, afterState, status, metadata, timestamp
    ], customDb);

    logger.debug('Transaction trace recorded', { traceId, operation, sourceId, requestId });
    return { success: true, traceId };
  } catch (err) {
    logger.error('Error recording transaction trace', { error: err.message, traceData });
    return { success: false, error: err.message };
  }
}

/**
 * Queries traces with flexible filtering.
 */
async function getTraces(filters = {}, customDb = null) {
  await initTraceTable(customDb);

  let sql = 'SELECT * FROM transaction_traces WHERE 1=1';
  const params = [];

  if (filters.operation) {
    sql += ' AND operation = ?';
    params.push(filters.operation);
  }
  if (filters.sourceId) {
    sql += ' AND source_id = ?';
    params.push(filters.sourceId);
  }
  if (filters.requestId) {
    sql += ' AND request_id = ?';
    params.push(filters.requestId);
  }
  if (filters.shiftId) {
    sql += ' AND shift_id = ?';
    params.push(filters.shiftId);
  }
  if (filters.businessDate) {
    sql += ' AND business_date = ?';
    params.push(filters.businessDate);
  }

  sql += ' ORDER BY created_at DESC';

  if (filters.limit) {
    sql += ' LIMIT ?';
    params.push(parseInt(filters.limit, 10));
  } else {
    sql += ' LIMIT 100';
  }

  const rows = await allQuery(sql, params, customDb);
  return rows.map(r => ({
    ...r,
    before_state: r.before_state ? JSON.parse(r.before_state) : null,
    after_state: r.after_state ? JSON.parse(r.after_state) : null,
    metadata: r.metadata ? JSON.parse(r.metadata) : null
  }));
}

module.exports = {
  initTraceTable,
  recordTrace,
  getTraces
};
