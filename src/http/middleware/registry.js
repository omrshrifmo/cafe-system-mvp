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
  { method: 'ALL', pathRegex: /^\/api\/setup/, permission: 'public' },
  { method: 'ALL', pathRegex: /^\/api\/demo(\/.*)?$/, permission: 'public' },
  { method: 'GET', pathRegex: /^\/api\/build-info$/, permission: 'public' },
  { method: 'GET', pathRegex: /^\/api\/health\//, permission: 'public' },
  { method: 'POST', pathRegex: /^\/api\/health\/alerts\/acknowledge$/, permission: 'system:settings' },
  { method: 'GET', pathRegex: /^\/api\/metrics$/, permission: 'public' },
  { method: 'ALL', pathRegex: /^\/api\/public\//, permission: 'public' },

  // Basic Authenticated User Endpoints
  { method: 'GET', pathRegex: /^\/api\/auth\/me$/, permission: 'authenticated' },
  { method: 'POST', pathRegex: /^\/api\/auth\/(unlock|verify-pin|rotate-pin|change-pin|revoke-all|ping)$/, permission: 'authenticated' },
  { method: 'ALL', pathRegex: /^\/api\/auth\/(caffeine|checkpoint)$/, permission: 'authenticated' },
  { method: 'ALL', pathRegex: /^\/api\/auth\/sessions(\/.*)?$/, permission: 'authenticated' },
  { method: 'POST', pathRegex: /^\/api\/(system|setup)\/initialize$/, permission: 'public' },
  { method: 'ALL', pathRegex: /^\/api\/system\/(backup|restore|factory-reset|initialize)$/, permission: 'authenticated' },
  { method: 'ALL', pathRegex: /^\/api\/(backup|restore)$/, permission: 'authenticated' },
  { method: 'GET', pathRegex: /^\/api\/(notifications|inventory)\/low-stock$/, permission: 'authenticated' },
  { method: 'GET', pathRegex: /^\/api\/export\/(sales|inventory|orders|templates?\/.*)$/, permission: 'authenticated' },
  { method: 'POST', pathRegex: /^\/api\/import\/(menu|master)$/, permission: 'menu:write' },
  
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
  { method: 'ALL', pathRegex: /^\/api\/reversals/, permission: 'authenticated' },
  
  // Shifts
  { method: 'POST', pathRegex: /^\/api\/shifts\/clock-/, permission: 'authenticated' },
  { method: 'GET', pathRegex: /^\/api\/shifts\/me$/, permission: 'authenticated' },
  { method: 'POST', pathRegex: /^\/api\/shifts\/declare-/, permission: 'authenticated' },
  { method: 'ALL', pathRegex: /^\/api\/shifts/, permission: 'authenticated' },
  
  // Reports & Financial
  { method: 'GET', pathRegex: /^\/api\/reports\/bom-reconciliation$/, permission: 'reports:inventory' },
  { method: 'ALL', pathRegex: /^\/api\/reports/, permission: 'reports:financial' },
  { method: 'ALL', pathRegex: /^\/api\/shareholders/, permission: 'reports:financial' },
  { method: 'ALL', pathRegex: /^\/api\/expenses/, permission: 'reports:financial' },
  { method: 'ALL', pathRegex: /^\/api\/advances/, permission: 'reports:financial' },
  
  // Inventory & Purchasing & Suppliers & Stocktakes
  { method: 'ALL', pathRegex: /^\/api\/inventory/, permission: 'inventory:read' },
  { method: 'ALL', pathRegex: /^\/api\/purchases?/, permission: 'inventory:purchase' },
  { method: 'ALL', pathRegex: /^\/api\/stocktakes/, permission: 'inventory:adjust' },
  { method: 'ALL', pathRegex: /^\/api\/suppliers/, permission: 'inventory:read' },
  
  // HR / Payroll / Staff / Attendance / Penalties / Tips / Allowances
  { method: 'ALL', pathRegex: /^\/api\/hr(\/.*)?$/, permission: 'authenticated' },
  { method: 'ALL', pathRegex: /^\/api\/payroll(\/.*)?$/, permission: 'authenticated' },
  { method: 'ALL', pathRegex: /^\/api\/users(\/.*)?$/, permission: 'users:read' },
  { method: 'ALL', pathRegex: /^\/api\/attendance(\/.*)?$/, permission: 'authenticated' },
  { method: 'ALL', pathRegex: /^\/api\/staff(\/.*)?$/, permission: 'authenticated' },
  { method: 'ALL', pathRegex: /^\/api\/penalties(\/.*)?$/, permission: 'authenticated' },
  { method: 'ALL', pathRegex: /^\/api\/(tips|tips-pools)(\/.*)?$/, permission: 'authenticated' },
  { method: 'ALL', pathRegex: /^\/api\/(allowances|staff-allowances)(\/.*)?$/, permission: 'authenticated' },
  { method: 'ALL', pathRegex: /^\/api\/adjustments(\/.*)?$/, permission: 'authenticated' },
  
  // CRM / Hospitality / Quality / Complaints / Audit / Activity Ledger / HACCP
  { method: 'ALL', pathRegex: /^\/api\/(crm|customers)(\/.*)?$/, permission: 'crm:read' },
  { method: 'ALL', pathRegex: /^\/api\/reservations(\/.*)?$/, permission: 'reservations:read' },
  { method: 'ALL', pathRegex: /^\/api\/(quality|qa|complaints|haccp)(\/.*)?$/, permission: 'authenticated' },
  { method: 'ALL', pathRegex: /^\/api\/(audit|activity-ledger)(\/.*)?$/, permission: 'authenticated' },
  
  // Realtime & Sync & Stations
  { method: 'GET', pathRegex: /^\/api\/realtime\/health$/, permission: 'public' },
  { method: 'ALL', pathRegex: /^\/api\/realtime/, permission: 'authenticated' },
  { method: 'ALL', pathRegex: /^\/api\/sync/, permission: 'authenticated' },
  { method: 'ALL', pathRegex: /^\/api\/(kds|runner|floor)/, permission: 'authenticated' },
  
  // Entertainment, Gaming & WiFi Vouchers & Promotions & Menu Engineering
  { method: 'ALL', pathRegex: /^\/api\/(entertainment|wifi)(\/.*)?$/, permission: 'authenticated' },
  { method: 'ALL', pathRegex: /^\/api\/promotions(\/.*)?$/, permission: 'authenticated' },
  { method: 'ALL', pathRegex: /^\/api\/menu-engineering(\/.*)?$/, permission: 'authenticated' },
  
  // Settings & Admin & Hardware & Devices & Emergency
  { method: 'POST', pathRegex: /^\/api\/devices\/register$/, permission: 'public' },
  { method: 'ALL', pathRegex: /^\/api\/devices(\/.*)?$/, permission: 'system:settings' },
  { method: 'POST', pathRegex: /^\/api\/admin\/emergency\/request$/, permission: 'authenticated' },
  { method: 'POST', pathRegex: /^\/api\/admin\/emergency\/terminate$/, permission: 'authenticated' },
  { method: 'GET', pathRegex: /^\/api\/config\/public$/, permission: 'public' },
  { method: 'ALL', pathRegex: /^\/api\/config/, permission: 'system:settings' },
  { method: 'ALL', pathRegex: /^\/api\/admin/, permission: 'system:settings' },
  { method: 'ALL', pathRegex: /^\/api\/print/, permission: 'authenticated' }
];

function enforceRegistry(req, res, next) {
  // Only apply to /api/ routes
  if (!req.path.startsWith('/api/')) return next();
  
  const match = routeRegistry.find(r => 
    (r.method === 'ALL' || r.method === req.method) && r.pathRegex.test(req.path)
  );

  if (!match) {
    logger.warn('Route not registered in API route registry', {
      method: req.method,
      path: req.path
    });
    return res.status(404).json({
      success: false,
      data: null,
      error: `NOT_FOUND: هذا المسار غير موجود [${req.method} ${req.originalUrl}]`,
      code: 'NOT_FOUND',
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
