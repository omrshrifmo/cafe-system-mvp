const { hasPermission } = require('../../domain/auth/permissions');
const logger = require('../../observability/logger');

// Centralized API Route Permission Registry (Default Deny)
// Format: { method: 'GET|POST|ALL', pathRegex: /.../, permission: 'public|authenticated|role:...' }
const routeRegistry = [
  // Public Auth endpoints
  { method: 'POST', pathRegex: /^\/api\/auth\/login$/, permission: 'public' },
  { method: 'GET', pathRegex: /^\/api\/auth\/logout$/, permission: 'public' },
  { method: 'POST', pathRegex: /^\/api\/auth\/logout$/, permission: 'public' },
  
  // Public APIs
  { method: 'GET', pathRegex: /^\/api\/build-info$/, permission: 'public' },
  { method: 'GET', pathRegex: /^\/api\/health\//, permission: 'public' },
  { method: 'GET', pathRegex: /^\/api\/metrics$/, permission: 'public' },
  { method: 'ALL', pathRegex: /^\/api\/public\//, permission: 'public' },
  
  // Basic Authenticated User Endpoints
  { method: 'GET', pathRegex: /^\/api\/auth\/me$/, permission: 'authenticated' },
  
  // Menu & Catalog (Public Read, Write requires menu:write)
  { method: 'GET', pathRegex: /^\/api\/(menu|catalog)(\/.*)?$/, permission: 'public' },
  { method: 'POST', pathRegex: /^\/api\/(menu|catalog)(\/.*)?$/, permission: 'menu:write' },
  { method: 'PUT', pathRegex: /^\/api\/(menu|catalog)(\/.*)?$/, permission: 'menu:write' },
  { method: 'DELETE', pathRegex: /^\/api\/(menu|catalog)(\/.*)?$/, permission: 'menu:write' },

  // Orders & POS (Granular permissions checked in route handlers)
  { method: 'ALL', pathRegex: /^\/api\/orders/, permission: 'authenticated' },
  { method: 'ALL', pathRegex: /^\/api\/tables/, permission: 'authenticated' },
  { method: 'ALL', pathRegex: /^\/api\/payments/, permission: 'authenticated' },
  { method: 'ALL', pathRegex: /^\/api\/quotes?/, permission: 'authenticated' },
  { method: 'ALL', pathRegex: /^\/api\/checkout/, permission: 'authenticated' },
  { method: 'ALL', pathRegex: /^\/api\/receipts/, permission: 'authenticated' },
  
  // Shifts
  { method: 'POST', pathRegex: /^\/api\/shifts\/clock-/, permission: 'authenticated' },
  { method: 'GET', pathRegex: /^\/api\/shifts\/me$/, permission: 'authenticated' },
  { method: 'POST', pathRegex: /^\/api\/shifts\/declare-/, permission: 'authenticated' },
  { method: 'ALL', pathRegex: /^\/api\/shifts/, permission: 'shifts:read' },
  
  // Reports & Financial
  { method: 'GET', pathRegex: /^\/api\/reports\/bom-reconciliation$/, permission: 'reports:inventory' },
  { method: 'ALL', pathRegex: /^\/api\/reports/, permission: 'reports:financial' },
  { method: 'ALL', pathRegex: /^\/api\/expenses/, permission: 'reports:financial' },
  { method: 'ALL', pathRegex: /^\/api\/advances/, permission: 'reports:financial' },
  
  // Inventory & Purchasing & Suppliers
  { method: 'ALL', pathRegex: /^\/api\/inventory/, permission: 'inventory:read' },
  { method: 'ALL', pathRegex: /^\/api\/purchases?/, permission: 'inventory:purchase' },
  { method: 'ALL', pathRegex: /^\/api\/suppliers/, permission: 'inventory:read' },
  
  // HR / Payroll / Users
  { method: 'ALL', pathRegex: /^\/api\/hr/, permission: 'shifts:manage' },
  { method: 'ALL', pathRegex: /^\/api\/payroll/, permission: 'payroll:read' },
  { method: 'ALL', pathRegex: /^\/api\/users/, permission: 'shifts:manage' },
  
  // CRM / Hospitality / Quality / Audit
  { method: 'ALL', pathRegex: /^\/api\/crm/, permission: 'crm:read' },
  { method: 'ALL', pathRegex: /^\/api\/reservations/, permission: 'reservations:read' },
  { method: 'ALL', pathRegex: /^\/api\/quality/, permission: 'qa:read' },
  { method: 'ALL', pathRegex: /^\/api\/audit/, permission: 'system:settings' },
  
  // Realtime & Sync
  { method: 'ALL', pathRegex: /^\/api\/realtime/, permission: 'authenticated' },
  { method: 'ALL', pathRegex: /^\/api\/sync/, permission: 'authenticated' },
  
  // Settings & Admin & Hardware
  { method: 'ALL', pathRegex: /^\/api\/config/, permission: 'system:settings' },
  { method: 'ALL', pathRegex: /^\/api\/admin/, permission: 'system:settings' },
  { method: 'ALL', pathRegex: /^\/api\/print/, permission: 'authenticated' }
];

function enforceRegistry(req, res, next) {
  // Only apply to /api/ routes
  if (!req.path.startsWith('/api/')) return next();
  
  console.log('enforceRegistry req.path:', req.path, 'req.originalUrl:', req.originalUrl);
  
  const match = routeRegistry.find(r => 
    (r.method === 'ALL' || r.method === req.method) && r.pathRegex.test(req.path)
  );

  if (!match) {
    logger.warn('Default Deny: Route not registered in API permission matrix', {
      method: req.method,
      path: req.path
    });
    return res.status(403).json({
      success: false,
      error: 'FORBIDDEN: هذا المسار غير مسجل في مصفوفة الصلاحيات (Default Deny)',
      code: 'DEFAULT_DENY',
      requestId: req.id
    });
  }

  // Check required permission
  if (match.permission === 'public') {
    return next();
  }

  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'AUTH_REQUIRED: يلزم تسجيل الدخول بالرمز السري أولاً',
      code: 'AUTH_REQUIRED',
      requestId: req.id
    });
  }

  if (match.permission === 'authenticated') {
    return next();
  }

  if (!hasPermission(req.user.role, match.permission)) {
    logger.warn('Access denied by Registry', {
      userId: req.user.id,
      role: req.user.role,
      required: match.permission,
      path: req.path
    });
    return res.status(403).json({
      success: false,
      error: `FORBIDDEN: غير مصرح لدورك (${req.user.role})`,
      code: 'FORBIDDEN',
      requestId: req.id
    });
  }

  next();
}

module.exports = { enforceRegistry };
