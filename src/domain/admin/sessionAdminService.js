/**
 * Active Session Administration & Forced Logout Service
 * Provides full session visibility, remote invalidation, and emergency global revocation.
 */
const { runQuery, getQuery, allQuery } = require('../../db/connection');
const { recordAuditEvent } = require('../audit/auditLedgerService');
const { verifyReauthentication } = require('../auth/service');
const { closeSessionSocket, closeUserSockets, getWss } = require('../../realtime/websocket');
const logger = require('../../observability/logger');

/**
 * List all active sessions with user, device, role, IP, and risk metadata
 */
async function listActiveSessions(venueId = 'V_DEFAULT', filters = {}) {
  let sql = `
    SELECT 
      s.id as session_id,
      s.user_id,
      u.name as user_name,
      COALESCE(r.name, u.role_id) as role_name,
      s.venue_id,
      s.device_id,
      d.friendly_name as device_name,
      COALESCE(s.device_class, d.device_class, 'POS') as device_class,
      d.is_trusted as device_is_trusted,
      s.issued_at,
      s.last_seen_at,
      s.absolute_expiry_at,
      s.inactivity_expiry_at,
      s.caffeine_expires_at,
      s.ip_address,
      s.user_agent,
      s.build_id,
      COALESCE(s.risk_state, 'LOW') as risk_state,
      s.is_emergency
    FROM v3_user_sessions s
    JOIN v3_users u ON s.user_id = u.id
    LEFT JOIN roles r ON u.role_id = r.id
    LEFT JOIN devices d ON s.device_id = d.id
    WHERE s.revoked_at IS NULL 
      AND s.absolute_expiry_at > datetime('now', 'localtime')
      AND u.is_active = 1
  `;
  const params = [];

  if (venueId && venueId !== 'ALL') {
    sql += ` AND s.venue_id = ?`;
    params.push(venueId);
  }

  if (filters.user_id) {
    sql += ` AND s.user_id = ?`;
    params.push(filters.user_id);
  }

  if (filters.device_id) {
    sql += ` AND s.device_id = ?`;
    params.push(filters.device_id);
  }

  if (filters.role) {
    sql += ` AND (r.name = ? OR u.role_id = ?)`;
    params.push(filters.role, filters.role);
  }

  if (filters.risk_state) {
    sql += ` AND s.risk_state = ?`;
    params.push(filters.risk_state);
  }

  sql += ` ORDER BY s.last_seen_at DESC`;

  const rows = await allQuery(sql, params);
  const now = Date.now();

  return rows.map(row => {
    const lastSeenTime = new Date(row.last_seen_at).getTime();
    const idleSeconds = Math.max(0, Math.floor((now - lastSeenTime) / 1000));
    const isCaffeineActive = row.caffeine_expires_at ? new Date(row.caffeine_expires_at).getTime() > now : false;

    return {
      sessionId: row.session_id,
      userId: row.user_id,
      userName: row.user_name,
      role: row.role_name,
      venueId: row.venue_id,
      deviceId: row.device_id,
      deviceName: row.device_name || (row.device_id ? `جهاز ${row.device_id}` : 'جهاز غير معروف'),
      deviceClass: row.device_class,
      deviceIsTrusted: row.device_is_trusted === 1,
      issuedAt: row.issued_at,
      lastSeenAt: row.last_seen_at,
      idleSeconds,
      inactivityExpiresAt: row.inactivity_expiry_at,
      absoluteExpiresAt: row.absolute_expiry_at,
      isCaffeineActive,
      ipAddress: row.ip_address || '127.0.0.1',
      userAgent: row.user_agent,
      buildId: row.build_id || 'v3.1.0',
      riskState: row.risk_state,
      isEmergency: row.is_emergency === 1
    };
  });
}

/**
 * Revoke a single active session
 */
async function revokeSessionById(sessionId, actorUserId, venueId = 'V_DEFAULT', reason = 'REVOKED_BY_ADMIN') {
  const session = await getQuery(`SELECT * FROM v3_user_sessions WHERE id = ?`, [sessionId]);
  if (!session) {
    throw new Error('SESSION_NOT_FOUND: الجلسة المحددة غير موجودة.');
  }

  await runQuery(
    `UPDATE v3_user_sessions SET revoked_at = datetime('now', 'localtime') WHERE id = ?`,
    [sessionId]
  );

  // Close connected WebSocket socket immediately
  try {
    closeSessionSocket(sessionId);
  } catch (e) {
    logger.warn('Failed to close session socket', { sessionId, error: e.message });
  }

  await recordAuditEvent({
    venue_id: venueId || session.venue_id || 'V_DEFAULT',
    actor_user_id: actorUserId,
    event_type: 'SESSION_REVOKED',
    entity_type: 'SESSION',
    entity_id: sessionId,
    details: { target_user_id: session.user_id, device_id: session.device_id, reason },
    outcome: 'SUCCESS'
  });

  return { success: true, sessionId, message: 'تم إبطال الجلسة بنجاح.' };
}

/**
 * Revoke all active sessions for a specific user
 */
async function revokeSessionsByUser(userId, actorUserId, venueId = 'V_DEFAULT', reason = 'USER_FORCED_LOGOUT') {
  const activeSessions = await allQuery(
    `SELECT id FROM v3_user_sessions WHERE user_id = ? AND revoked_at IS NULL`,
    [userId]
  );

  const res = await runQuery(
    `UPDATE v3_user_sessions SET revoked_at = datetime('now', 'localtime') WHERE user_id = ? AND revoked_at IS NULL`,
    [userId]
  );

  // Close all sockets for this user
  try {
    closeUserSockets(userId);
  } catch (e) {
    logger.warn('Failed to close user sockets', { userId, error: e.message });
  }

  await recordAuditEvent({
    venue_id: venueId,
    actor_user_id: actorUserId,
    event_type: 'USER_SESSIONS_REVOKED',
    entity_type: 'USER',
    entity_id: userId,
    details: { revokedCount: res.changes, reason, sessionIds: activeSessions.map(s => s.id) },
    outcome: 'SUCCESS'
  });

  return res.changes;
}

/**
 * Revoke all active sessions tied to a specific hardware device
 */
async function revokeSessionsByDevice(deviceId, actorUserId, reason = 'DEVICE_FORCED_LOGOUT') {
  const activeSessions = await allQuery(
    `SELECT id, user_id, venue_id FROM v3_user_sessions WHERE device_id = ? AND revoked_at IS NULL`,
    [deviceId]
  );

  const res = await runQuery(
    `UPDATE v3_user_sessions SET revoked_at = datetime('now', 'localtime') WHERE device_id = ? AND revoked_at IS NULL`,
    [deviceId]
  );

  for (const s of activeSessions) {
    try {
      closeSessionSocket(s.id);
    } catch (e) {}
  }

  if (activeSessions.length > 0) {
    await recordAuditEvent({
      venue_id: activeSessions[0].venue_id || 'V_DEFAULT',
      actor_user_id: actorUserId,
      event_type: 'DEVICE_SESSIONS_REVOKED',
      entity_type: 'DEVICE',
      entity_id: deviceId,
      details: { revokedCount: res.changes, reason, sessionIds: activeSessions.map(s => s.id) },
      outcome: 'SUCCESS'
    });
  }

  return res.changes;
}

/**
 * Global emergency session invalidation
 */
async function revokeAllSessionsGlobal(venueId, actorUser, managerPin, reason = 'GLOBAL_EMERGENCY_REVOKE') {
  if (!actorUser || !['OWNER', 'SUPER_ADMIN'].includes(actorUser.role)) {
    throw new Error('FORBIDDEN: يلزم صلاحية المالك أو سوبر أدمن لتنفيذ الإبطال الشامل لجميع الجلسات.');
  }

  if (!managerPin) {
    throw new Error('PIN_REQUIRED: يلزم إدخال الرمز السري لتأكيد الإبطال الشامل.');
  }

  const isPinValid = await verifyReauthentication(actorUser.id, managerPin);
  if (!isPinValid) {
    throw new Error('INVALID_PIN: الرمز السري غير صحيح.');
  }

  const res = await runQuery(
    `UPDATE v3_user_sessions SET revoked_at = datetime('now', 'localtime') 
     WHERE (venue_id = ? OR venue_id IS NULL) AND revoked_at IS NULL`,
    [venueId || 'V_DEFAULT']
  );

  // Terminate all WebSocket connections globally
  const wss = getWss();
  if (wss) {
    wss.clients.forEach(client => {
      if (client.readyState === 1) {
        try {
          client.close(4001, 'AUTH_REQUIRED: تم إبطال جميع الجلسات لدواعي أمنية طارئة.');
        } catch (e) {}
      }
    });
  }

  await recordAuditEvent({
    venue_id: venueId || 'V_DEFAULT',
    actor_user_id: actorUser.id,
    event_type: 'GLOBAL_SESSIONS_REVOKED',
    entity_type: 'VENUE',
    entity_id: venueId || 'V_DEFAULT',
    details: { totalRevoked: res.changes, reason, authorized_by: actorUser.id },
    outcome: 'SUCCESS'
  });

  logger.warn('GLOBAL EMERGENCY SESSION REVOCATION EXECUTED', {
    venueId,
    actorId: actorUser.id,
    revokedCount: res.changes,
    reason
  });

  return { success: true, totalRevoked: res.changes, message: 'تم إبطال جميع الجلسات بنجاح وإغلاق الاتصالات المتصلة.' };
}

module.exports = {
  listActiveSessions,
  revokeSessionById,
  revokeSessionsByUser,
  revokeSessionsByDevice,
  revokeAllSessionsGlobal
};
