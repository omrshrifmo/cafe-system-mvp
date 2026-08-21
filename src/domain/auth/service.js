/**
 * Authentication & Server-Side Session Management Service
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getQuery, runQuery, allQuery } = require('../../db/connection');
const { getRolePermissions } = require('./permissions');
const env = require('../../config/env');
const logger = require('../../observability/logger');

function hashToken(token) {
  return crypto.createHash('sha256').update(token + env.SESSION_SECRET).digest('hex');
}

async function hashPin(pin) {
  return bcrypt.hash(String(pin).trim(), env.BCRYPT_WORK_FACTOR);
}

async function verifyPin(pin, hash) {
  return bcrypt.compare(String(pin).trim(), hash);
}

async function authenticateWithPin(pin, ip = null, userAgent = null) {
  const cleanPin = String(pin).trim();
  if (!cleanPin) {
    throw new Error('AUTH_PIN_REQUIRED: يرجى إدخال رمز الدخول السري');
  }

  // Fetch all active users to test against bcrypt hashes
  const users = await allQuery(`SELECT id, name, role, pin_hash, is_active FROM users WHERE is_active = 1`);
  let matchedUser = null;

  for (const user of users) {
    if (user.pin_hash && (await verifyPin(cleanPin, user.pin_hash))) {
      matchedUser = user;
      break;
    }
  }

  if (!matchedUser) {
    logger.warn('Failed login attempt with invalid PIN', { ip });
    throw new Error('INVALID_CREDENTIALS: رمز الدخول السري غير صحيح');
  }

  // Generate random secure session token
  const rawSessionToken = crypto.randomBytes(32).toString('hex');
  const sessionHash = hashToken(rawSessionToken);
  const sessionId = crypto.randomUUID();

  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3600 * 1000).toISOString();

  await runQuery(
    `INSERT INTO user_sessions (id, user_id, session_hash, expires_at, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [sessionId, matchedUser.id, sessionHash, expiresAt, ip, userAgent]
  );

  logger.info('User successfully authenticated', { userId: matchedUser.id, role: matchedUser.role, ip });

  return {
    sessionId: rawSessionToken,
    user: {
      id: matchedUser.id,
      name: matchedUser.name,
      role: matchedUser.role
    },
    permissions: getRolePermissions(matchedUser.role)
  };
}

async function validateSession(rawSessionToken) {
  if (!rawSessionToken) return null;

  const sessionHash = hashToken(rawSessionToken);
  const session = await getQuery(
    `SELECT s.id as session_id, s.user_id, s.expires_at, s.revoked_at,
            u.id, u.name, u.role, u.is_active
     FROM user_sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.session_hash = ? AND s.revoked_at IS NULL AND u.is_active = 1`,
    [sessionHash]
  );

  if (!session) return null;

  // Check expiration
  if (new Date(session.expires_at).getTime() < Date.now()) {
    return null;
  }

  // Update last seen
  runQuery(
    `UPDATE user_sessions SET last_seen_at = datetime('now', 'localtime') WHERE id = ?`,
    [session.session_id]
  ).catch(() => {});

  return {
    id: session.id,
    name: session.name,
    role: session.role,
    sessionId: session.session_id,
    permissions: getRolePermissions(session.role)
  };
}

async function revokeSession(rawSessionToken) {
  if (!rawSessionToken) return false;
  const sessionHash = hashToken(rawSessionToken);
  const res = await runQuery(
    `UPDATE user_sessions SET revoked_at = datetime('now', 'localtime') WHERE session_hash = ?`,
    [sessionHash]
  );
  return res.changes > 0;
}

async function revokeAllUserSessions(userId) {
  const res = await runQuery(
    `UPDATE user_sessions SET revoked_at = datetime('now', 'localtime') WHERE user_id = ? AND revoked_at IS NULL`,
    [userId]
  );
  return res.changes;
}

async function verifyReauthentication(userId, pin) {
  const user = await getQuery(`SELECT pin_hash FROM users WHERE id = ?`, [userId]);
  if (!user || !user.pin_hash) return false;
  return verifyPin(pin, user.pin_hash);
}

module.exports = {
  authenticateWithPin,
  validateSession,
  revokeSession,
  revokeAllUserSessions,
  verifyReauthentication,
  hashPin,
  verifyPin
};
