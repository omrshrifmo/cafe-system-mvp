/**
 * Caffeine Mode & Activity Checkpoint Service
 * Server-authoritative keep-alive duration capping and safe activity restoration.
 */

const crypto = require('crypto');
const { runQuery, getQuery, allQuery } = require('../../db/connection');
const { logAudit, verifyPin } = require('./service');

const MAX_CAFFEINE_MINUTES = 60;
const DEFAULT_CAFFEINE_MINUTES = 30;

// Sensitive screen keywords that must NEVER be restored automatically
const SENSITIVE_KEYWORDS = [
  'settle', 'checkout', 'payment', 'refund', 'void', 'drawer', 'cash',
  'payroll', 'eod', 'close-shift', 'backup', 'update', 'admin-config'
];

function isSensitiveRouteOrDraft(route, draftType, draftPayload = {}) {
  const r = String(route || '').toLowerCase();
  const d = String(draftType || '').toLowerCase();
  
  for (const kw of SENSITIVE_KEYWORDS) {
    if (r.includes(kw) || d.includes(kw)) return true;
  }

  if (draftPayload) {
    const pStr = typeof draftPayload === 'string' ? draftPayload.toLowerCase() : JSON.stringify(draftPayload).toLowerCase();
    if (pStr.includes('payment_method') || pStr.includes('cash_received') || pStr.includes('refund_reason')) {
      return true;
    }
  }

  return false;
}

async function enableCaffeineMode(sessionId, userId, venueId, durationMinutes = DEFAULT_CAFFEINE_MINUTES, reason = 'OPERATIONAL_KEEP_ALIVE', managerPin = null, ip = null) {
  const cappedMinutes = Math.min(Math.max(1, parseInt(durationMinutes, 10) || DEFAULT_CAFFEINE_MINUTES), MAX_CAFFEINE_MINUTES);
  
  // If manager pin provided for step-up, verify it
  if (managerPin) {
    const managers = await allQuery(
      `SELECT u.id, u.pin_hash FROM v3_users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.venue_id = ? AND r.name IN ('OP_MANAGER', 'OWNER', 'SUPER_ADMIN') AND u.is_active = 1`,
      [venueId]
    );

    let pinValid = false;
    for (const m of managers) {
      if (await verifyPin(managerPin, m.pin_hash)) {
        pinValid = true;
        break;
      }
    }
    if (!pinValid) {
      await logAudit(venueId, userId, 'CAFFEINE_MODE_DENIED', 'SESSION', sessionId, { reason: 'INVALID_MANAGER_PIN' }, ip);
      throw new Error('STEP_UP_FAILED: الرمز السري للمدير غير صحيح لتفعيل وضع الكافيين');
    }
  }

  const expiresAt = new Date(Date.now() + cappedMinutes * 60 * 1000).toISOString();

  await runQuery(
    `UPDATE v3_user_sessions 
     SET caffeine_expires_at = ?, caffeine_reason = ?
     WHERE id = ? AND user_id = ?`,
    [expiresAt, reason, sessionId, userId]
  );

  await logAudit(venueId, userId, 'CAFFEINE_MODE_ENABLED', 'SESSION', sessionId, {
    duration_minutes: cappedMinutes,
    expires_at: expiresAt,
    reason
  }, ip);

  return {
    enabled: true,
    duration_minutes: cappedMinutes,
    expires_at: expiresAt,
    reason
  };
}

async function disableCaffeineMode(sessionId, userId, venueId, ip = null) {
  await runQuery(
    `UPDATE v3_user_sessions 
     SET caffeine_expires_at = NULL, caffeine_reason = NULL
     WHERE id = ?`,
    [sessionId]
  );

  await logAudit(venueId, userId, 'CAFFEINE_MODE_DISABLED', 'SESSION', sessionId, {}, ip);

  return { enabled: false };
}

async function getCaffeineModeStatus(sessionId) {
  const session = await getQuery(
    `SELECT caffeine_expires_at, caffeine_reason FROM v3_user_sessions WHERE id = ?`,
    [sessionId]
  );

  if (!session || !session.caffeine_expires_at) {
    return { enabled: false, remaining_seconds: 0 };
  }

  const expTime = new Date(session.caffeine_expires_at).getTime();
  const nowTime = Date.now();

  if (nowTime >= expTime) {
    // Expired
    await runQuery(`UPDATE v3_user_sessions SET caffeine_expires_at = NULL, caffeine_reason = NULL WHERE id = ?`, [sessionId]);
    return { enabled: false, remaining_seconds: 0, expired: true };
  }

  return {
    enabled: true,
    expires_at: session.caffeine_expires_at,
    remaining_seconds: Math.round((expTime - nowTime) / 1000),
    reason: session.caffeine_reason
  };
}

async function saveActivityCheckpoint(userId, venueId, roleId, deviceId, contextId, route, draftType, draftPayload, ip = null) {
  const isSensitive = isSensitiveRouteOrDraft(route, draftType, draftPayload) ? 1 : 0;
  const checkpointId = 'CHK-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
  const payloadStr = typeof draftPayload === 'string' ? draftPayload : JSON.stringify(draftPayload);
  
  // Checkpoint valid for 4 hours
  const expiresAt = new Date(Date.now() + 4 * 3600 * 1000).toISOString();

  // Clear previous checkpoint for this user/context
  await runQuery(`DELETE FROM v3_user_activity_checkpoints WHERE user_id = ? AND (context_id = ? OR context_id IS NULL)`, [userId, contextId || null]);

  await runQuery(
    `INSERT INTO v3_user_activity_checkpoints 
     (id, user_id, venue_id, role_id, device_id, context_id, route, draft_type, draft_payload, is_sensitive, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [checkpointId, userId, venueId, roleId, deviceId || null, contextId || null, route, draftType, payloadStr, isSensitive, expiresAt]
  );

  return { checkpointId, isSensitive: !!isSensitive };
}

async function getValidActivityCheckpoint(userId, venueId, roleId, deviceId = null, contextId = null) {
  const checkpoint = await getQuery(
    `SELECT * FROM v3_user_activity_checkpoints 
     WHERE user_id = ? AND venue_id = ? AND expires_at > datetime('now', 'localtime')
     ORDER BY created_at DESC LIMIT 1`,
    [userId, venueId]
  );

  if (!checkpoint) return null;

  // Strict validation: never return sensitive drafts or mismatched roles
  if (checkpoint.is_sensitive === 1) {
    return {
      allowed: false,
      reason: 'SENSITIVE_ACTION_BLOCKED: لا يمكن استعادة عمليات الدفع أو الإلغاء أو الرواتب تلقائياً لمتطلبات الأمان'
    };
  }

  if (checkpoint.role_id !== roleId) {
    return {
      allowed: false,
      reason: 'ROLE_MISMATCH: تغير الدور الوظيفي للمستخدم منذ آخر جلسة'
    };
  }

  let parsedPayload = {};
  try {
    parsedPayload = JSON.parse(checkpoint.draft_payload);
  } catch (e) {
    parsedPayload = {};
  }

  return {
    allowed: true,
    checkpoint: {
      id: checkpoint.id,
      route: checkpoint.route,
      draft_type: checkpoint.draft_type,
      draft_payload: parsedPayload,
      created_at: checkpoint.created_at
    }
  };
}

async function clearActivityCheckpoint(userId, checkpointId = null) {
  if (checkpointId) {
    await runQuery(`DELETE FROM v3_user_activity_checkpoints WHERE id = ? AND user_id = ?`, [checkpointId, userId]);
  } else {
    await runQuery(`DELETE FROM v3_user_activity_checkpoints WHERE user_id = ?`, [userId]);
  }
  return { success: true };
}

module.exports = {
  enableCaffeineMode,
  disableCaffeineMode,
  getCaffeineModeStatus,
  saveActivityCheckpoint,
  getValidActivityCheckpoint,
  clearActivityCheckpoint,
  isSensitiveRouteOrDraft
};
