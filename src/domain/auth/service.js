/**
 * Authentication & Server-Side Session Management Service
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getQuery, runQuery, allQuery } = require('../../db/connection');
const { getRolePermissions } = require('./permissions');
const env = require('../../config/env');
const logger = require('../../observability/logger');

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const ABSOLUTE_EXPIRY_HOURS = 24;
const INACTIVITY_EXPIRY_MINUTES = 15; // By default, session needs pinging

function hashToken(token) {
  return crypto.createHash('sha256').update(token + env.SESSION_SECRET).digest('hex');
}

async function hashPin(pin) {
  return bcrypt.hash(String(pin).trim(), env.BCRYPT_WORK_FACTOR);
}

async function verifyPin(pin, hash) {
  return bcrypt.compare(String(pin).trim(), hash);
}

async function logAudit(venueId, userId, action, targetType, targetId, details, ip) {
  try {
    const payload = details || {};
    payload.ip_address = ip;
    const detailsJson = JSON.stringify({ old_data: payload.old_data || null, new_data: payload.new_data || payload });
    
    await runQuery(
      `INSERT INTO v3_audit_logs (id, venue_id, user_id, action, target_type, target_id, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), venueId, userId, action, targetType, targetId, detailsJson]
    );
  } catch (e) {
    logger.error('Failed to write audit log', e);
  }
}

async function authenticateWithPin(pin, ip = null, userAgent = null, deviceId = null) {
  const cleanPin = String(pin).trim();
  if (!cleanPin) {
    throw new Error('AUTH_PIN_REQUIRED: يرجى إدخال رمز الدخول السري');
  }

  // Use a timing-safe generic approach:
  // Since we use PINs, finding the user by PIN directly is an option, BUT to support lockout we need to find by some other ID, or we check ALL active users to prevent timing attacks revealing if a PIN exists.
  // We'll fetch all active users and test. 
  const users = await allQuery(`SELECT id, venue_id, name, role_id, pin_hash, is_active, failed_attempts, locked_until FROM v3_users WHERE is_active = 1`);
  let matchedUser = null;

  for (const user of users) {
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      continue; // Skip locked users during matching
    }
    if (user.pin_hash && (await verifyPin(cleanPin, user.pin_hash))) {
      matchedUser = user;
      break;
    }
  }

  if (!matchedUser) {
    // We cannot easily increment failed attempts without knowing WHO failed if they only provide a PIN.
    // If they provide a username/ID, we could lock them out. For a pure PIN system, rate limiting by IP is vital (handled by Express rate limit).
    // If we assume a generic PIN failure, we just throw.
    logger.warn('Failed login attempt with invalid PIN', { ip });
    throw new Error('INVALID_CREDENTIALS: رمز الدخول السري غير صحيح أو الحساب مقفول');
  }

  // Reset failed attempts for the successful user
  if (matchedUser.failed_attempts > 0) {
    await runQuery(`UPDATE v3_users SET failed_attempts = 0, locked_until = NULL WHERE id = ?`, [matchedUser.id]);
  }

  const roleRow = await getQuery(`SELECT name FROM roles WHERE id = ?`, [matchedUser.role_id]);
  const roleName = roleRow ? roleRow.name : 'READ_ONLY';

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

  await logAudit(matchedUser.venue_id, matchedUser.id, 'LOGIN', 'SESSION', sessionId, { deviceId }, ip);
  logger.info('User successfully authenticated', { userId: matchedUser.id, role: roleName, ip });

  return {
    sessionId: rawSessionToken,
    user: {
      id: matchedUser.id,
      name: matchedUser.name,
      role: roleName,
      venueId: matchedUser.venue_id
    },
    permissions: getRolePermissions(roleName)
  };
}

async function validateSession(rawSessionToken, touch = true) {
  if (!rawSessionToken) return null;

  const sessionHash = hashToken(rawSessionToken);
  const session = await getQuery(
    `SELECT s.id as session_id, s.user_id, s.venue_id, s.absolute_expiry_at, s.inactivity_expiry_at, s.revoked_at,
            u.name, u.role_id, u.is_active, COALESCE(r.name, u.role_id) as role_name
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
    venueId: session.venue_id,
    sessionId: session.session_id,
    permissions: getRolePermissions(session.role_name || 'READ_ONLY')
  };
}

async function revokeSessionByHash(sessionHash) {
  await runQuery(
    `UPDATE v3_user_sessions SET revoked_at = datetime('now', 'localtime') WHERE session_hash = ?`,
    [sessionHash]
  );
}

async function revokeSession(rawSessionToken) {
  if (!rawSessionToken) return false;
  const sessionHash = hashToken(rawSessionToken);
  const res = await runQuery(
    `UPDATE v3_user_sessions SET revoked_at = datetime('now', 'localtime') WHERE session_hash = ? AND revoked_at IS NULL`,
    [sessionHash]
  );
  return res.changes > 0;
}

async function revokeAllUserSessions(userId) {
  const res = await runQuery(
    `UPDATE v3_user_sessions SET revoked_at = datetime('now', 'localtime') WHERE user_id = ? AND revoked_at IS NULL`,
    [userId]
  );
  return res.changes;
}

async function verifyReauthentication(userId, pin) {
  const user = await getQuery(`SELECT pin_hash, failed_attempts, locked_until FROM v3_users WHERE id = ?`, [userId]);
  if (!user || !user.pin_hash) return false;

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    throw new Error('ACCOUNT_LOCKED: الحساب مقفول مؤقتاً بسبب كثرة المحاولات الخاطئة');
  }

  const valid = await verifyPin(pin, user.pin_hash);
  if (!valid) {
    const fails = (user.failed_attempts || 0) + 1;
    let lockedUntil = null;
    if (fails >= MAX_FAILED_ATTEMPTS) {
      lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
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

module.exports = {
  authenticateWithPin,
  validateSession,
  revokeSession,
  revokeAllUserSessions,
  verifyReauthentication,
  hashPin,
  verifyPin,
  logAudit
};
