/**
 * Authentication HTTP Routes
 */
const express = require('express');
const router = express.Router();
const { authenticateWithPin, revokeSession, verifyReauthentication } = require('../../domain/auth/service');
const { authLimiter } = require('../middleware/rate-limit');
const { requireAuth } = require('../middleware/auth');
const env = require('../../config/env');

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const pin = req.body.pin || req.body.pin_code;
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await authenticateWithPin(pin, ip, userAgent);

    // Set secure cookie
    res.cookie('session_token', result.sessionId, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: env.SESSION_TTL_HOURS * 3600 * 1000
    });

    res.json({
      success: true,
      token: result.sessionId,
      user: result.user,
      permissions: result.permissions
    });
  } catch (err) {
    res.status(401).json({
      success: false,
      error: err.message,
      code: 'AUTH_FAILED',
      requestId: req.id
    });
  }
});

router.post('/logout', async (req, res) => {
  const token = (req.cookies && req.cookies.session_token) || req.headers['x-session-token'];
  if (token) {
    await revokeSession(token);
  }
  res.clearCookie('session_token');
  res.json({ success: true, message: 'تم تسجيل الخروج بنجاح' });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

router.post('/verify-pin', requireAuth, async (req, res) => {
  const { pin } = req.body;
  const valid = await verifyReauthentication(req.user.id, pin);
  res.json({ success: valid, verified: valid });
});

module.exports = router;
