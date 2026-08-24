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
  const token = (req.cookies && req.cookies.session_token) || req.headers['x-session-token'];
  const ip = req.ip || req.connection.remoteAddress;

  if (token) {
    await revokeSession(token);
    if (req.user) {
      await logAudit(req.user.venueId, req.user.id, 'LOGOUT', 'SESSION', null, {}, ip);
    }
  }

  res.clearCookie('session_token', {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax'
  });
  
  res.json({ success: true, message: 'تم تسجيل الخروج بنجاح' });
};

router.post('/logout', handleLogout);

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

// Ping endpoint to manually extend inactivity timeout (e.g. while actively interacting)
router.post('/ping', requireAuth, (req, res) => {
  res.json({ success: true });
});

module.exports = router;

