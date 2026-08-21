/**
 * Strict RBAC Permission Enforcement Middleware
 */
const { hasPermission } = require('../../domain/auth/permissions');
const logger = require('../../observability/logger');

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'AUTH_REQUIRED: يلزم تسجيل الدخول بالرمز السري أولاً',
        code: 'AUTH_REQUIRED',
        requestId: req.id
      });
    }

    if (!hasPermission(req.user.role, permission)) {
      logger.warn('Access denied: insufficient permission', {
        userId: req.user.id,
        role: req.user.role,
        requiredPermission: permission,
        path: req.originalUrl
      });
      return res.status(403).json({
        success: false,
        error: `FORBIDDEN: غير مصرح لدورك الوظيفي (${req.user.role}) بتنفيذ هذه العملية [${permission}]`,
        code: 'FORBIDDEN',
        requestId: req.id
      });
    }

    next();
  };
}

module.exports = {
  requirePermission
};
