const express = require('express');
const router = express.Router();
const { 
  authenticateWithPin, 
  revokeSession, 
  revokeAllUserSessions,
  verifyReauthentication, 
  rotateUserPin,
  logAudit 
} = require('../../domain/auth/service');
const { getClientSafePermissions, getRoleDefaultRoute } = require('../../domain/auth/permissions');
const { authLimiter } = require('../middleware/rate-limit');
const { requireAuth } = require('../middleware/auth');
const env = require('../../config/env');

// All auth responses must never be cached by browser, proxy, or service worker
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

router.post('/login', authLimiter, async (req, res) => {
  try {
    const pin = req.body.pin || req.body.pin_code;
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const deviceId = req.headers['x-device-id'] || null;

    const result = await authenticateWithPin(pin, ip, userAgent, deviceId);

    // Set secure HttpOnly cookie
    res.cookie('session_token', result.sessionId, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: env.SESSION_TTL_HOURS * 3600 * 1000
    });

    res.json({
      success: true,
      token: result.sessionId,
      user: result.user
    });
  } catch (err) {
    res.status(401).json({
      success: false,
      error: err.message,
      code: err.message.includes('LOCKED') ? 'ACCOUNT_LOCKED' : (err.message.includes('DISABLED') ? 'ACCOUNT_DISABLED' : 'AUTH_FAILED'),
      requestId: req.id
    });
  }
});

const handleLogout = async (req, res) => {
  const token = (req.cookies && req.cookies.session_token) ||
                (req.headers.authorization && req.headers.authorization.startsWith('Bearer ') ? req.headers.authorization.substring(7) : null) ||
                req.headers['x-session-token'];
  const ip = req.ip || req.connection.remoteAddress;

  if (token) {
    await revokeSession(token);
  }
  if (req.user && req.user.id) {
    await revokeSession(req.user.sessionId || req.user.id);
    await logAudit(req.user.venueId, req.user.id, 'LOGOUT', 'SESSION', null, {}, ip).catch(() => {});
  }

  res.clearCookie('session_token', {
    path: '/',
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax'
  });
  
  res.json({ success: true, message: 'تم تسجيل الخروج بنجاح' });
};

router.post('/logout', handleLogout);
router.get('/logout', handleLogout);

router.get('/me', requireAuth, (req, res) => {
  // Return strictly least identity needed: never expose raw session tokens or wildcard '*'
  const safePermissions = getClientSafePermissions(req.user.role);
  const defaultRoute = getRoleDefaultRoute(req.user.role);

  res.json({
    success: true,
    user: {
      id: req.user.id,
      name: req.user.name,
      role: req.user.role,
      permission_version: req.user.permission_version || '2.1.0',
      venueId: req.user.venueId,
      defaultRoute,
      permissions: safePermissions
    }
  });
});

router.post('/verify-pin', requireAuth, authLimiter, async (req, res) => {
  try {
    const { pin } = req.body;
    const ip = req.ip || req.connection.remoteAddress;
    const valid = await verifyReauthentication(req.user.id, pin);
    if (valid) {
      await logAudit(req.user.venueId, req.user.id, 'REAUTH_SUCCESS', 'USER', req.user.id, {}, ip);
      res.json({ success: true, verified: true, message: 'تم التحقق بنجاح وإلغاء القفل' });
    } else {
      res.status(401).json({ success: false, error: 'الرمز السري غير صحيح', code: 'INVALID_PIN' });
    }
  } catch (e) {
    const code = e.message.includes('LOCKED') ? 'ACCOUNT_LOCKED' : (e.message.includes('INVALID_PIN') ? 'INVALID_PIN' : 'AUTH_FAILED');
    res.status(401).json({ success: false, error: e.message, code });
  }
});

router.post('/unlock', requireAuth, authLimiter, async (req, res) => {
  try {
    const { pin } = req.body;
    const ip = req.ip || req.connection.remoteAddress;
    const valid = await verifyReauthentication(req.user.id, pin);
    if (valid) {
      await logAudit(req.user.venueId, req.user.id, 'UNLOCK_SUCCESS', 'USER', req.user.id, {}, ip);
      res.json({ success: true, verified: true, message: 'تم إلغاء القفل بنجاح' });
    } else {
      res.status(401).json({ success: false, error: 'الرمز السري غير صحيح', code: 'INVALID_PIN' });
    }
  } catch (e) {
    const code = e.message.includes('LOCKED') ? 'ACCOUNT_LOCKED' : (e.message.includes('INVALID_PIN') ? 'INVALID_PIN' : 'AUTH_FAILED');
    res.status(401).json({ success: false, error: e.message, code });
  }
});

router.post('/revoke-all', requireAuth, async (req, res) => {
  try {
    const count = await revokeAllUserSessions(req.user.id);
    res.clearCookie('session_token', {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax'
    });
    res.json({ success: true, count, message: 'تم إبطال جميع الجلسات بنجاح' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/rotate-pin', requireAuth, authLimiter, async (req, res) => {
  try {
    const { oldPin, newPin } = req.body;
    const ip = req.ip || req.connection.remoteAddress;
    await rotateUserPin(req.user.id, oldPin, newPin, req.user.id, ip);
    
    res.clearCookie('session_token', {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax'
    });
    
    res.json({ success: true, message: 'تم تغيير رمز PIN بنجاح. يرجى إعادة تسجيل الدخول.' });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// POST /api/auth/change-pin
// Changes user PIN without logging out current device, but invalidates all other terminal sessions
router.post('/change-pin', requireAuth, authLimiter, async (req, res) => {
  try {
    const { getQuery, runQuery } = require('../../db/connection');
    const { hashPin, verifyPin } = require('../../domain/auth/service');

    const old_pin = req.body.old_pin || req.body.oldPin;
    const new_pin = req.body.new_pin || req.body.newPin;
    const ip = req.ip || req.connection.remoteAddress;
    const deviceId = req.headers['x-device-id'] || req.user.deviceId || null;
    const currentSessionId = req.user.sessionId || req.user.id;

    if (!old_pin || !new_pin) {
      return res.status(400).json({
        success: false,
        error: 'يرجى إدخال رمز المرور الحالي والرمز الجديد'
      });
    }

    const cleanNewPin = String(new_pin).trim();
    if (cleanNewPin.length < 4) {
      return res.status(400).json({
        success: false,
        error: 'رمز PIN الجديد يجب أن يتكون من 4 أرقام على الأقل'
      });
    }

    // 1. Fetch user & verify old PIN via bcrypt
    const user = await getQuery(`SELECT id, venue_id, pin_hash FROM v3_users WHERE id = ?`, [req.user.id]);
    if (!user) {
      return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
    }

    const valid = await verifyPin(old_pin, user.pin_hash);
    if (!valid) {
      return res.status(400).json({ success: false, error: 'رمز PIN الحالي غير صحيح' });
    }

    // 2. Hash & save new PIN
    const newHash = await hashPin(cleanNewPin);
    await runQuery(
      `UPDATE v3_users SET pin_hash = ?, failed_attempts = 0, locked_until = NULL, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [newHash, req.user.id]
    );

    // 3. Security Lockout: Immediately execute database query to DELETE FROM v3_user_sessions WHERE user_id = ? AND device_id != ?
    let deleteResult;
    if (deviceId) {
      deleteResult = await runQuery(
        `DELETE FROM v3_user_sessions WHERE user_id = ? AND (device_id != ? OR device_id IS NULL)`,
        [req.user.id, deviceId]
      );
    } else if (currentSessionId) {
      deleteResult = await runQuery(
        `DELETE FROM v3_user_sessions WHERE user_id = ? AND id != ?`,
        [req.user.id, currentSessionId]
      );
    } else {
      deleteResult = await runQuery(
        `DELETE FROM v3_user_sessions WHERE user_id = ? AND id != (SELECT id FROM v3_user_sessions WHERE user_id = ? ORDER BY last_seen_at DESC LIMIT 1)`,
        [req.user.id, req.user.id]
      );
    }

    // Close WebSocket connections for other terminated devices
    try {
      const { closeUserSocketsExcept } = require('../../realtime/websocket');
      if (typeof closeUserSocketsExcept === 'function') {
        closeUserSocketsExcept(req.user.id, currentSessionId);
      }
    } catch (wsErr) {}

    await logAudit(user.venue_id, req.user.id, 'PIN_CHANGE', 'USER', req.user.id, { deviceId }, ip);

    res.json({
      success: true,
      message: 'تم تغيير رمز PIN بنجاح وتأمين الجلسات على الأجهزة الأخرى',
      sessions_revoked: deleteResult.changes || 0
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Ping endpoint to manually extend inactivity timeout (e.g. while actively interacting)
router.post('/ping', requireAuth, (req, res) => {
  res.json({ success: true });
});

// --- Caffeine Keep-Alive Mode Routes ---
const { 
  enableCaffeineMode, 
  disableCaffeineMode, 
  getCaffeineModeStatus, 
  saveActivityCheckpoint, 
  getValidActivityCheckpoint, 
  clearActivityCheckpoint 
} = require('../../domain/auth/checkpointService');

router.post('/caffeine', requireAuth, async (req, res) => {
  try {
    const { duration_minutes, reason, manager_pin } = req.body;
    const ip = req.ip || req.connection.remoteAddress;
    const sessionId = req.user.sessionId;

    const result = await enableCaffeineMode(
      sessionId, 
      req.user.id, 
      req.user.venueId, 
      duration_minutes, 
      reason, 
      manager_pin, 
      ip
    );

    res.json({ success: true, ...result, message: 'تم تفعيل وضع الكافيين بنجاح' });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

router.delete('/caffeine', requireAuth, async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const sessionId = req.user.sessionId;
    const result = await disableCaffeineMode(sessionId, req.user.id, req.user.venueId, ip);
    res.json({ success: true, ...result, message: 'تم إلغاء تفعيل وضع الكافيين' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/caffeine', requireAuth, async (req, res) => {
  try {
    const sessionId = req.user.sessionId;
    const result = await getCaffeineModeStatus(sessionId);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// --- Activity Checkpoint Routes ---
router.post('/checkpoint', requireAuth, async (req, res) => {
  try {
    const { route, draft_type, draft_payload } = req.body;
    const deviceId = req.headers['x-device-id'] || null;
    const contextId = req.headers['x-context-id'] || null;
    const ip = req.ip || req.connection.remoteAddress;

    const result = await saveActivityCheckpoint(
      req.user.id,
      req.user.venueId,
      req.user.role,
      deviceId,
      contextId,
      route,
      draft_type,
      draft_payload,
      ip
    );

    res.json({ success: true, ...result });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

router.get('/checkpoint', requireAuth, async (req, res) => {
  try {
    const deviceId = req.headers['x-device-id'] || null;
    const contextId = req.headers['x-context-id'] || null;

    const result = await getValidActivityCheckpoint(
      req.user.id,
      req.user.venueId,
      req.user.role,
      deviceId,
      contextId
    );

    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/checkpoint', requireAuth, async (req, res) => {
  try {
    await clearActivityCheckpoint(req.user.id);
    res.json({ success: true, message: 'تم مسح نقطة الاستعادة بنجاح' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// --- Active Device Sessions & Remote Revocation ---
const { listActiveSessions, revokeSessionById } = require('../../domain/admin/sessionAdminService');

router.get('/sessions', requireAuth, async (req, res, next) => {
  try {
    if (!['SUPER_ADMIN', 'OWNER', 'ADMIN', 'OP_MANAGER'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'غير مصرح: استعراض الجلسات النشطة مقتصر على الإدارة والمالك' });
    }
    const sessions = await listActiveSessions(req.user.venueId || 'V_DEFAULT');
    const formatted = sessions.map(s => ({
      id: s.sessionId,
      session_id: s.sessionId,
      device_id: s.deviceId,
      device_name: s.deviceName,
      device_class: s.deviceClass,
      user_id: s.userId,
      user_name: s.userName,
      role: s.role,
      last_seen: s.lastSeenAt,
      last_seen_at: s.lastSeenAt,
      issued_at: s.issuedAt,
      created_at: s.issuedAt,
      ip_address: s.ipAddress,
      user_agent: s.userAgent,
      is_emergency: s.isEmergency
    }));

    res.json({
      success: true,
      sessions: formatted,
      data: formatted
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/sessions/:id', requireAuth, async (req, res, next) => {
  try {
    if (!['SUPER_ADMIN', 'OWNER', 'ADMIN', 'OP_MANAGER'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'غير مصرح: إلغاء الجلسات مقتصر على الإدارة والمالك' });
    }
    const sessionId = req.params.id;
    const result = await revokeSessionById(sessionId, req.user.id, req.user.venueId || 'V_DEFAULT', 'REMOTE_REVOCATION_BY_ADMIN');
    res.json({
      success: true,
      message: 'تم إلغاء الجلسة بنجاح وفصل الجهاز فورياً 🔒',
      ...result
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

