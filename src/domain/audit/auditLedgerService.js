/**
 * Universal Append-Only Audit Ledger Service
 * Cryptographic Hash Chained, Tamper-Evident, Role-Scoped, Secret-Sanitized
 */
const crypto = require('crypto');
const { getQuery, allQuery, runQuery } = require('../../db/connection');
const logger = require('../../observability/logger');

const SENSITIVE_KEYS = new Set([
  'pin', 'pin_hash', 'password', 'password_hash', 'token', 'secret',
  'authorization', 'auth_token', 'pan', 'cvv', 'card_number', 'cardnumber',
  'access_token', 'refresh_token', 'session_hash'
]);

function sha256(data) {
  return crypto.createHash('sha256').update(typeof data === 'string' ? data : JSON.stringify(data)).digest('hex');
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  
  const clean = {};
  for (const [key, val] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      clean[key] = '[REDACTED_SECRET]';
    } else if (val && typeof val === 'object') {
      clean[key] = sanitizeObject(val);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

function computeEventHash(id, seq, prevHash, eventType, actorUserId, targetId, outcome, serverTimestamp) {
  const payload = `${id}|${seq}|${prevHash}|${eventType}|${actorUserId || ''}|${targetId || ''}|${outcome || 'SUCCESS'}|${serverTimestamp}`;
  return sha256(payload);
}

/**
 * Record an immutable, cryptographically chained audit event
 */
async function recordAuditEvent(params = {}) {
  const {
    event_type,
    actor_user_id = null,
    actor_name = null,
    actor_role = null,
    session_id = null,
    device_id = null,
    seat_id = null,
    venue_id = 'V_DEFAULT',
    shift_id = null,
    business_date = null,
    target_entity_type = null,
    target_entity_id = null,
    before_state = null,
    after_state = null,
    details = {},
    policy_version = 'v1',
    catalog_version = 'v1',
    client_timestamp = null,
    request_id = null,
    idempotency_key = null,
    source = 'WEB',
    outcome = 'SUCCESS',
    reason = null
  } = params;

  if (!event_type) {
    throw new Error('VALIDATION_ERROR: event_type is required for audit recording');
  }

  const id = crypto.randomUUID();
  const serverTimestamp = new Date().toISOString();
  
  // Sanitize states and details
  const cleanBefore = sanitizeObject(before_state);
  const cleanAfter = sanitizeObject(after_state);
  const cleanDetails = sanitizeObject(details);

  const beforeHash = cleanBefore ? sha256(cleanBefore) : null;
  const afterHash = cleanAfter ? sha256(cleanAfter) : null;
  const detailsJson = JSON.stringify(cleanDetails);

  // Fetch previous row to calculate chain sequence and hash
  const lastRow = await getQuery(
    `SELECT sequence_num, event_hash FROM v3_audit_ledger WHERE venue_id = ? ORDER BY sequence_num DESC LIMIT 1`,
    [venue_id]
  );

  const seq = (lastRow && lastRow.sequence_num) ? Number(lastRow.sequence_num) + 1 : 1;
  const prevHash = (lastRow && lastRow.event_hash) ? lastRow.event_hash : 'GENESIS_0000000000000000000000000000000000000000000000000000000000000000';
  
  const eventHash = computeEventHash(id, seq, prevHash, event_type, actor_user_id, target_entity_id, outcome, serverTimestamp);

  await runQuery(
    `INSERT INTO v3_audit_ledger (
      id, sequence_num, event_type, actor_user_id, actor_name, actor_role,
      session_id, device_id, seat_id, venue_id, shift_id, business_date,
      target_entity_type, target_entity_id, before_state_hash, after_state_hash,
      details_json, policy_version, catalog_version, schema_version, build_version,
      client_timestamp, server_timestamp, request_id, idempotency_key, source,
      outcome, reason, previous_event_hash, event_hash
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, '030', '2.0.0',
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?
    )`,
    [
      id, seq, event_type, actor_user_id, actor_name, actor_role,
      session_id, device_id, seat_id, venue_id, shift_id, business_date,
      target_entity_type, target_entity_id, beforeHash, afterHash,
      detailsJson, policy_version, catalog_version,
      client_timestamp, serverTimestamp, request_id, idempotency_key, source,
      outcome, reason, prevHash, eventHash
    ]
  );

  // Maintain dual-write to legacy v3_audit_logs for existing readers
  try {
    await runQuery(
      `INSERT INTO v3_audit_logs (id, venue_id, user_id, action, target_type, target_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, venue_id, actor_user_id, event_type, target_entity_type || 'SYSTEM', target_entity_id, detailsJson, serverTimestamp]
    );
  } catch (e) {
    // Ignore legacy failure if table structure differs
  }

  const createdEvent = {
    id,
    sequence_num: seq,
    event_type,
    actor_user_id,
    actor_name,
    actor_role,
    session_id,
    device_id,
    venue_id,
    shift_id,
    target_entity_type,
    target_entity_id,
    before_state_hash: beforeHash,
    after_state_hash: afterHash,
    server_timestamp: serverTimestamp,
    outcome,
    reason,
    previous_event_hash: prevHash,
    event_hash: eventHash
  };

  // Pass to anomaly detector asynchronously
  try {
    const { evaluateSecurityAnomaly } = require('./securityAnomalyService');
    evaluateSecurityAnomaly(createdEvent).catch(err => {
      logger.error('Security anomaly evaluation error:', err);
    });
  } catch (e) {}

  return createdEvent;
}

/**
 * Verify cryptographic hash chain integrity for a venue
 */
async function verifyAuditChainIntegrity(venueId = 'V_DEFAULT', startSeq = 1, endSeq = null) {
  const params = [venueId, startSeq];
  let sql = `SELECT * FROM v3_audit_ledger WHERE venue_id = ? AND sequence_num >= ?`;
  if (endSeq) {
    sql += ` AND sequence_num <= ?`;
    params.push(endSeq);
  }
  sql += ` ORDER BY sequence_num ASC`;

  const rows = await allQuery(sql, params);

  if (!rows || rows.length === 0) {
    return {
      isValid: true,
      totalChecked: 0,
      brokenAtSeq: null,
      message: 'لا توجد سجلات تدقيق للتحقق منها (No records found)'
    };
  }

  let expectedPrevHash = (startSeq === 1) 
    ? 'GENESIS_0000000000000000000000000000000000000000000000000000000000000000'
    : rows[0].previous_event_hash;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    
    // Check previous hash link
    if (r.previous_event_hash !== expectedPrevHash) {
      return {
        isValid: false,
        totalChecked: i,
        brokenAtSeq: r.sequence_num,
        eventId: r.id,
        message: `انقطاع في سلسلة التدقيق عند السجل #${r.sequence_num}: تجزئة السجل السابق غير متطابقة (Previous hash mismatch)`
      };
    }

    // Recompute current event hash
    const recomputedHash = computeEventHash(
      r.id,
      r.sequence_num,
      r.previous_event_hash,
      r.event_type,
      r.actor_user_id,
      r.target_entity_id,
      r.outcome,
      r.server_timestamp
    );

    if (r.event_hash !== recomputedHash) {
      return {
        isValid: false,
        totalChecked: i,
        brokenAtSeq: r.sequence_num,
        eventId: r.id,
        message: `تلاعب في محتوى السجل #${r.sequence_num}: تجزئة السجل المحسوبة لا تطابق التجزئة المسجلة (Event hash mismatch/tampering detected)`
      };
    }

    expectedPrevHash = r.event_hash;
  }

  return {
    isValid: true,
    totalChecked: rows.length,
    startSeq: rows[0].sequence_num,
    endSeq: rows[rows.length - 1].sequence_num,
    latestHash: rows[rows.length - 1].event_hash,
    message: `سلسلة التدقيق سليمة وموثقة بنسبة 100% لجميع السجلات المفحوصة (${rows.length} سجل)`
  };
}

/**
 * Role-scoped query for audit logs
 */
async function queryAuditLedger(filters = {}, actor = null) {
  const venueId = (actor && actor.venueId) || filters.venue_id || 'V_DEFAULT';
  let sql = `SELECT * FROM v3_audit_ledger WHERE venue_id = ?`;
  const params = [venueId];

  // Role scoping: Cashiers, Waiters, Baristas only see their own actions
  const isManagerOrAdmin = actor && ['OWNER', 'SUPER_ADMIN', 'OP_MANAGER', 'ADMIN'].includes(String(actor.role).toUpperCase());
  if (!isManagerOrAdmin && actor && actor.id) {
    sql += ` AND actor_user_id = ?`;
    params.push(actor.id);
  } else if (filters.actor_user_id) {
    sql += ` AND actor_user_id = ?`;
    params.push(filters.actor_user_id);
  }

  if (filters.event_type) {
    sql += ` AND event_type = ?`;
    params.push(filters.event_type);
  }
  if (filters.actor_role) {
    sql += ` AND actor_role = ?`;
    params.push(filters.actor_role);
  }
  if (filters.device_id) {
    sql += ` AND device_id = ?`;
    params.push(filters.device_id);
  }
  if (filters.shift_id) {
    sql += ` AND shift_id = ?`;
    params.push(filters.shift_id);
  }
  if (filters.outcome) {
    sql += ` AND outcome = ?`;
    params.push(filters.outcome);
  }
  if (filters.target_entity_type) {
    sql += ` AND target_entity_type = ?`;
    params.push(filters.target_entity_type);
  }
  if (filters.target_entity_id) {
    sql += ` AND target_entity_id = ?`;
    params.push(filters.target_entity_id);
  }
  if (filters.start_date) {
    sql += ` AND server_timestamp >= ?`;
    params.push(filters.start_date);
  }
  if (filters.end_date) {
    sql += ` AND server_timestamp <= ?`;
    params.push(filters.end_date);
  }
  if (filters.search_term) {
    sql += ` AND (details_json LIKE ? OR reason LIKE ? OR request_id LIKE ?)`;
    const st = `%${filters.search_term}%`;
    params.push(st, st, st);
  }

  // Count total matching
  const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
  const countRes = await getQuery(countSql, params);
  const total = (countRes && countRes.total) || 0;

  const limit = Math.min(Number(filters.limit) || 50, 500);
  const offset = Number(filters.offset) || 0;

  sql += ` ORDER BY sequence_num DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const logs = await allQuery(sql, params);

  return {
    total,
    limit,
    offset,
    logs: (logs || []).map(r => ({
      ...r,
      details: r.details_json ? JSON.parse(r.details_json) : {}
    }))
  };
}

/**
 * Export audit events to CSV or JSON with tamper signature
 */
async function exportAuditLedger(filters = {}, format = 'JSON', actor = null) {
  const result = await queryAuditLedger({ ...filters, limit: 5000, offset: 0 }, actor);
  const verification = await verifyAuditChainIntegrity(filters.venue_id || 'V_DEFAULT');

  const exportMetadata = {
    exported_at: new Date().toISOString(),
    exported_by: actor ? { id: actor.id, name: actor.name, role: actor.role } : 'SYSTEM',
    record_count: result.logs.length,
    chain_verified: verification.isValid,
    chain_latest_hash: verification.latestHash || null
  };

  if (String(format).toUpperCase() === 'CSV') {
    const headers = [
      'sequence_num', 'id', 'event_type', 'actor_user_id', 'actor_name', 'actor_role',
      'device_id', 'shift_id', 'outcome', 'server_timestamp', 'previous_event_hash', 'event_hash'
    ];
    
    let csv = `# Export Integrity Header: ${JSON.stringify(exportMetadata)}\n`;
    csv += headers.join(',') + '\n';
    
    for (const r of result.logs) {
      const line = headers.map(h => {
        const val = r[h] !== undefined && r[h] !== null ? String(r[h]).replace(/"/g, '""') : '';
        return `"${val}"`;
      }).join(',');
      csv += line + '\n';
    }

    return {
      contentType: 'text/csv; charset=utf-8',
      filename: `audit-ledger-${Date.now()}.csv`,
      data: csv,
      metadata: exportMetadata
    };
  }

  return {
    contentType: 'application/json',
    filename: `audit-ledger-${Date.now()}.json`,
    data: JSON.stringify({ metadata: exportMetadata, logs: result.logs }, null, 2),
    metadata: exportMetadata
  };
}

/**
 * Aggregates staff performance activity metrics
 * Invariant: Operational metrics DO NOT convert to statutory payroll or deductions without explicit approval
 */
async function getStaffActivitySummary(userId, venueId = 'V_DEFAULT', periodStart = null, periodEnd = null) {
  const pStart = periodStart || new Date(Date.now() - 30 * 86400000).toISOString();
  const pEnd = periodEnd || new Date().toISOString();

  const activityStats = await allQuery(
    `SELECT event_type, outcome, COUNT(*) as count 
     FROM v3_audit_ledger 
     WHERE actor_user_id = ? AND venue_id = ? 
       AND server_timestamp >= ? AND server_timestamp <= ?
     GROUP BY event_type, outcome`,
    [userId, venueId, pStart, pEnd]
  );

  let ordersCreated = 0;
  let kdsActions = 0;
  let runnerClaims = 0;
  let voidsCount = 0;
  let refundsCount = 0;
  let failedActions = 0;

  for (const s of (activityStats || [])) {
    if (s.event_type.startsWith('ORDER_')) ordersCreated += s.count;
    if (s.event_type.startsWith('KDS_')) kdsActions += s.count;
    if (s.event_type.startsWith('RUNNER_')) runnerClaims += s.count;
    if (s.event_type.includes('VOID')) voidsCount += s.count;
    if (s.event_type.includes('REFUND')) refundsCount += s.count;
    if (s.outcome !== 'SUCCESS') failedActions += s.count;
  }

  return {
    user_id: userId,
    venue_id: venueId,
    period: { start: pStart, end: pEnd },
    operational_metrics: {
      orders_created: ordersCreated,
      kds_actions: kdsActions,
      runner_claims: runnerClaims,
      voids_logged: voidsCount,
      refunds_logged: refundsCount,
      failed_attempts: failedActions
    },
    policy_notice: "تنبيه سياسة الأجور: هذه المقاييس التشغيلية مخصصة للتحليل الإداري فقط ولا تُحوّل تلقائياً إلى خصومات أو مستحقات مالية في الرواتب دون مراجعة واعتماد بشري."
  };
}

module.exports = {
  recordAuditEvent,
  verifyAuditChainIntegrity,
  queryAuditLedger,
  exportAuditLedger,
  getStaffActivitySummary,
  sanitizeObject,
  computeEventHash
};
