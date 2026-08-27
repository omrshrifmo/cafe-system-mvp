/**
 * Authentication & Server-Side Session Management Service
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getQuery, runQuery, allQuery } = require('../../db/connection');
const { getRolePermissions, getRoleDefaultRoute, getClientSafePermissions, normalizeRole, PERMISSION_VERSION } = require('./permissions');
const env = require('../../config/env');
const logger = require('../../observability/logger');

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const ABSOLUTE_EXPIRY_HOURS = 24;
const INACTIVITY_EXPIRY_MINUTES = 15; // Inactivity limit

function hashToken(token) {
  return crypto.createHash('sha256').update(token + env.SESSION_SECRET).digest('hex');
}

async function hashPin(pin) {
  return bcrypt.hash(String(pin).trim(), env.BCRYPT_WORK_FACTOR || 10);
}

async function verifyPin(pin, hash) {
  return bcrypt.compare(String(pin).trim(), hash);
}

async function logAudit(venueId, userId, action, targetType, targetId, details, ip, outcome = 'SUCCESS', reason = null) {
  try {
    const payload = details || {};
    payload.ip_address = ip;
    const detailsJson = JSON.stringify({ old_data: payload.old_data || null, new_data: payload.new_data || payload });
    
    // Write to legacy v3_audit_logs
    await runQuery(
      `INSERT INTO v3_audit_logs (id, venue_id, user_id, action, target_type, target_id, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), venueId || 'V_DEFAULT', userId, action, targetType, targetId, detailsJson]
    );

    // Write to universal v3_audit_ledger with cryptographic hash chain
    const { recordAuditEvent } = require('../audit/auditLedgerService');
    await recordAuditEvent({
      event_type: action,
      actor_user_id: userId,
      venue_id: venueId || 'V_DEFAULT',
      target_entity_type: targetType,
      target_entity_id: targetId,
      details: payload,
      outcome,
      reason
    });
  } catch (e) {
    logger.error('Failed to write audit log', e);
  }
}

async function authenticateWithPin(pin, ip = null, userAgent = null, deviceId = null) {
  const cleanPin = String(pin || '').trim();
  if (!cleanPin || cleanPin.length < 4) {
    throw new Error('AUTH_PIN_REQUIRED: رمز الدخول السري يجب ألا يقل عن 4 أرقام');
  }

  // Fetch all users to check active state, locks, and PIN matches
  const users = await allQuery(`SELECT id, venue_id, name, role_id, pin_hash, is_active, failed_attempts, locked_until FROM v3_users`);
  let matchedUser = null;
  let isLockedOut = false;
  let isDisabled = false;

  for (const user of users) {
    if (user.pin_hash && (await verifyPin(cleanPin, user.pin_hash))) {
      if (user.is_active === 0) {
        isDisabled = true;
        matchedUser = user;
        break;
      }
      if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
        isLockedOut = true;
        matchedUser = user;
        break;
      }
      matchedUser = user;
      break;
    }
  }

  if (isDisabled) {
    await logAudit(matchedUser.venue_id, matchedUser.id, 'LOGIN_FAILED', 'USER', matchedUser.id, { reason: 'ACCOUNT_DISABLED' }, ip, 'REJECTED', 'ACCOUNT_DISABLED');
    throw new Error('ACCOUNT_DISABLED: هذا الحساب معطل حالياً، يرجى مراجعة إدارة النظام');
  }

  if (isLockedOut) {
    await logAudit(matchedUser.venue_id, matchedUser.id, 'LOGIN_FAILED', 'USER', matchedUser.id, { reason: 'ACCOUNT_LOCKED' }, ip, 'REJECTED', 'ACCOUNT_LOCKED');
    throw new Error('ACCOUNT_LOCKED: الحساب مقفول مؤقتاً لمدة 15 دقيقة بسبب تكرار المحاولات الخاطئة');
  }

  if (!matchedUser) {
    await logAudit('V_DEFAULT', null, 'PIN_ATTEMPT', 'AUTH', null, { deviceId, userAgent, ip }, ip, 'FAILURE', 'INVALID_CREDENTIALS');
    logger.warn('Failed login attempt with invalid PIN', { ip });
    throw new Error('INVALID_CREDENTIALS: رمز الدخول السري غير صحيح أو الحساب غير موجود');
  }

  // Reset failed attempts for the successful user
  if (matchedUser.failed_attempts > 0 || matchedUser.locked_until) {
    await runQuery(`UPDATE v3_users SET failed_attempts = 0, locked_until = NULL WHERE id = ?`, [matchedUser.id]);
  }

  const roleRow = await getQuery(`SELECT name FROM roles WHERE id = ?`, [matchedUser.role_id]);
  let roleName = roleRow ? roleRow.name : matchedUser.role_id;
  if (!roleName) {
    const legacyUser = await getQuery(`SELECT role FROM users WHERE id = ?`, [matchedUser.id]);
    roleName = legacyUser ? ('R_' + legacyUser.role.toUpperCase()) : 'WAITER';
  }
  roleName = normalizeRole(roleName);
  const defaultRoute = getRoleDefaultRoute(roleName);

  const rawSessionToken = crypto.randomBytes(32).toString('hex');
  const sessionHash = hashToken(rawSessionToken);
  const sessionId = crypto.randomUUID();

  const now = Date.now();
  const absoluteExpiry = new Date(now + ABSOLUTE_EXPIRY_HOURS * 3600 * 1000).toISOString();
  const inactivityExpiry = new Date(now + INACTIVITY_EXPIRY_MINUTES * 60 * 1000).toISOString();

  await runQuery(
    `INSERT INTO v3_user_sessions (id, user_id, venue_id, device_id, session_hash, absolute_expiry_at, inactivity_expiry_at, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [sessionId, matchedUser.id, matchedUser.venue_id, deviceId, sessionHash, absoluteExpiry, inactivityExpiry, ip, userAgent]
  );

  await logAudit(matchedUser.venue_id, matchedUser.id, 'LOGIN_SUCCESS', 'SESSION', sessionId, { deviceId, role: roleName }, ip);
  logger.info('User successfully authenticated', { userId: matchedUser.id, role: roleName, ip });

  return {
    sessionId: rawSessionToken,
    user: {
      id: matchedUser.id,
      name: matchedUser.name,
      role: roleName,
      permission_version: PERMISSION_VERSION,
      venueId: matchedUser.venue_id,
      defaultRoute,
      permissions: getClientSafePermissions(roleName)
    },
    permissions: getClientSafePermissions(roleName)
  };
}

async function validateSession(rawSessionToken, touch = true) {
  if (!rawSessionToken) return null;

  const sessionHash = hashToken(rawSessionToken);
  const session = await getQuery(
    `SELECT s.id as session_id, s.user_id, s.venue_id, s.absolute_expiry_at, s.inactivity_expiry_at, s.revoked_at,
            u.name, u.role_id, u.is_active, 
            COALESCE(r.name, u.role_id, (SELECT 'R_' || UPPER(legacy.role) FROM users legacy WHERE legacy.id = u.id)) as role_name
     FROM v3_user_sessions s
     JOIN v3_users u ON s.user_id = u.id
     LEFT JOIN roles r ON u.role_id = r.id
     WHERE s.session_hash = ? AND s.revoked_at IS NULL AND u.is_active = 1`,
    [sessionHash]
  );

  if (!session) return null;

  const now = Date.now();
  // Check absolute expiration
  if (new Date(session.absolute_expiry_at).getTime() < now) {
    await revokeSessionByHash(sessionHash);
    return null;
  }
  // Check inactivity expiration
  if (new Date(session.inactivity_expiry_at).getTime() < now) {
    await revokeSessionByHash(sessionHash);
    return null;
  }

  // Touch session (extend inactivity)
  if (touch) {
    const newInactivity = new Date(now + INACTIVITY_EXPIRY_MINUTES * 60 * 1000).toISOString();
    runQuery(
      `UPDATE v3_user_sessions SET last_seen_at = datetime('now', 'localtime'), inactivity_expiry_at = ? WHERE id = ?`,
      [newInactivity, session.session_id]
    ).catch(() => {});
  }

  return {
    id: session.user_id,
    name: session.name,
    role: session.role_name || 'READ_ONLY',
    permission_version: PERMISSION_VERSION,
    venueId: session.venue_id,
    sessionId: session.session_id,
    permissions: getRolePermissions(session.role_name || 'READ_ONLY')
  };
}

async function revokeSessionByHash(sessionHash) {
  const session = await getQuery(`SELECT id, user_id FROM v3_user_sessions WHERE session_hash = ?`, [sessionHash]);
  await runQuery(
    `UPDATE v3_user_sessions SET revoked_at = datetime('now', 'localtime') WHERE session_hash = ?`,
    [sessionHash]
  );
  if (session) {
    try {
      const { closeSessionSocket } = require('../../realtime/websocket');
      closeSessionSocket(session.id);
    } catch (e) {}
  }
}

async function revokeSession(rawSessionToken) {
  if (!rawSessionToken) return false;
  const sessionHash = hashToken(rawSessionToken);
  const session = await getQuery(`SELECT id, user_id FROM v3_user_sessions WHERE session_hash = ?`, [sessionHash]);
  const res = await runQuery(
    `UPDATE v3_user_sessions SET revoked_at = datetime('now', 'localtime') WHERE session_hash = ? AND revoked_at IS NULL`,
    [sessionHash]
  );
  if (session) {
    try {
      const { closeSessionSocket } = require('../../realtime/websocket');
      closeSessionSocket(session.id);
    } catch (e) {}
  }
  return res.changes > 0;
}

async function revokeAllUserSessions(userId) {
  const res = await runQuery(
    `UPDATE v3_user_sessions SET revoked_at = datetime('now', 'localtime') WHERE user_id = ? AND revoked_at IS NULL`,
    [userId]
  );
  try {
    const { closeUserSockets } = require('../../realtime/websocket');
    closeUserSockets(userId);
  } catch (e) {}
  return res.changes;
}

async function verifyReauthentication(userId, pin) {
  const user = await getQuery(`SELECT pin_hash, failed_attempts, locked_until FROM v3_users WHERE id = ?`, [userId]);
  if (!user || !user.pin_hash) return false;

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    throw new Error('ACCOUNT_LOCKED: الحساب مقفول مؤقتاً لمدة 15 دقيقة بسبب تكرار المحاولات الخاطئة');
  }

  const valid = await verifyPin(pin, user.pin_hash);
  if (!valid) {
    const fails = (user.failed_attempts || 0) + 1;
    let lockedUntil = null;
    if (fails >= MAX_FAILED_ATTEMPTS) {
      lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
      await runQuery(`UPDATE v3_users SET failed_attempts = ?, locked_until = ? WHERE id = ?`, [fails, lockedUntil, userId]);
      throw new Error('ACCOUNT_LOCKED: الحساب مقفول مؤقتاً لمدة 15 دقيقة بسبب تكرار المحاولات الخاطئة');
    }
    await runQuery(`UPDATE v3_users SET failed_attempts = ?, locked_until = ? WHERE id = ?`, [fails, lockedUntil, userId]);
    throw new Error('INVALID_PIN: الرمز السري غير صحيح');
  } else {
    if (user.failed_attempts > 0) {
      await runQuery(`UPDATE v3_users SET failed_attempts = 0, locked_until = NULL WHERE id = ?`, [userId]);
    }
  }

  // Extend inactivity upon successful reauth
  return true;
}

async function rotateUserPin(userId, oldPin, newPin, actorId = null, ip = null) {
  const cleanNewPin = String(newPin || '').trim();
  if (!cleanNewPin || cleanNewPin.length < 4) {
    throw new Error('VALIDATION_ERROR: رمز الدخول الجديد يجب أن يتكون من 4 أرقام على الأقل');
  }

  const user = await getQuery(`SELECT id, venue_id, pin_hash FROM v3_users WHERE id = ?`, [userId]);
  if (!user) throw new Error('USER_NOT_FOUND: المستخدم غير موجود');

  // If oldPin provided, verify it first
  if (oldPin) {
    const valid = await verifyPin(oldPin, user.pin_hash);
    if (!valid) throw new Error('INVALID_PIN: الرمز السري الحالي غير صحيح');
  }

  const newHash = await hashPin(cleanNewPin);
  await runQuery(`UPDATE v3_users SET pin_hash = ?, failed_attempts = 0, locked_until = NULL, updated_at = datetime('now', 'localtime') WHERE id = ?`, [newHash, userId]);

  // Revoke all existing sessions for this user to force re-login with new credentials
  await revokeAllUserSessions(userId);

  await logAudit(user.venue_id, actorId || userId, 'PIN_ROTATION', 'USER', userId, { rotated_by: actorId || userId }, ip);
  return true;
}

module.exports = {
  authenticateWithPin,
  validateSession,
  revokeSession,
  revokeAllUserSessions,
  verifyReauthentication,
  rotateUserPin,
  hashPin,
  verifyPin,
  logAudit
};
