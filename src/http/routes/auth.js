/**
 * Authentication HTTP Routes
 */
const express = require('express');
const router = express.Router();
const { authenticateWithPin, revokeSession, verifyReauthentication, logAudit } = require('../../domain/auth/service');
const { authLimiter } = require('../middleware/rate-limit');
const { requireAuth } = require('../middleware/auth');
const env = require('../../config/env');
const logger = require('../../observability/logger');

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const pin = req.body.pin || req.body.pin_code;
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const deviceId = req.headers['x-device-id'] || null;

    const result = await authenticateWithPin(pin, ip, userAgent, deviceId);

    // Set secure cookie
    res.cookie('session_token', result.sessionId, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: env.SESSION_TTL_HOURS * 3600 * 1000
    });

    res.json({
      success: true,
      token: result.sessionId, // Provided for non-browser clients (if any)
      user: result.user,
      permissions: result.permissions
    });
  } catch (err) {
    res.status(401).json({
      success: false,
      error: err.message,
      code: err.message.includes('LOCKED') ? 'ACCOUNT_LOCKED' : 'AUTH_FAILED',
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
  res.json({
    success: true,
    user: req.user
  });
});

router.post('/verify-pin', requireAuth, authLimiter, async (req, res) => {
  try {
    const { pin } = req.body;
    const valid = await verifyReauthentication(req.user.id, pin);
    if (valid) {
      res.json({ success: true, verified: true });
    } else {
      res.status(401).json({ success: false, error: 'الرمز السري غير صحيح', code: 'INVALID_PIN' });
    }
  } catch (e) {
    res.status(401).json({ success: false, error: e.message, code: 'AUTH_FAILED' });
  }
});

// Ping endpoint to manually extend inactivity timeout (e.g. while actively interacting)
router.post('/ping', requireAuth, (req, res) => {
  // authMiddleware already validates and touches the session
  res.json({ success: true });
});

module.exports = router;
