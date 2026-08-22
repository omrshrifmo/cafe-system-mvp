/**
 * Server-Side Session Authentication Middleware
 */
const { validateSession } = require('../../domain/auth/service');

async function authMiddleware(req, res, next) {
  // Extract token from Cookie, Authorization Bearer, or x-session-token header
  let token = null;

  if (req.cookies && req.cookies.session_token) {
    token = req.cookies.session_token;
  } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.substring(7);
  } else if (req.headers['x-session-token']) {
    token = req.headers['x-session-token'];
  }

  console.log('authMiddleware: cookies =', req.cookies, 'token =', token);

  if (!token) {
    console.log('authMiddleware: no token, user = null');
    req.user = null;
    return next();
  }

  try {
    const user = await validateSession(token);
    console.log('authMiddleware: validateSession returned', user);
    req.user = user;
  } catch (err) {
    console.log('authMiddleware: validateSession threw', err);
    req.user = null;
  }

  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'AUTH_REQUIRED: يلزم تسجيل الدخول بالرمز السري أولاً للوصول إلى هذا المورد',
      code: 'AUTH_REQUIRED',
      requestId: req.id
    });
  }
  next();
}

module.exports = {
  authMiddleware,
  requireAuth
};
