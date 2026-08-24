/**
 * RBAC Permission Matrix for MENA Cafe ERP
 * Server-authoritative scopes for all API access.
 */

const ROLE_PERMISSIONS = {
  SUPER_ADMIN: ['*'], // Full system authority
  OWNER: ['*'],       // Full business & financial authority
  
  OP_MANAGER: [
    'orders:create', 'orders:read', 'orders:edit', 'orders:void', 'orders:refund', 'orders:reopen', 'orders:approve',
    'payments:take', 'payments:refund', 'payments:settle',
    'inventory:read', 'inventory:adjust', 'inventory:transfer', 'inventory:purchase', 'inventory:waste', 'inventory:administer',
    'menu:read', 'menu:write', 'menu:configure',
    'tables:read', 'tables:write', 'tables:seat', 'tables:move', 'tables:vacate',
    'reports:financial', 'reports:operational', 'reports:inventory', 'reports:export',
    'shifts:read', 'shifts:manage', 'shifts:approve', 'payroll:read',
    'crm:read', 'crm:write', 'crm:export',
    'qa:read', 'qa:write',
    'system:settings'
  ],
  
  OP_ASSISTANT_CASHIER: [
    'orders:create', 'orders:read', 'orders:edit',
    'payments:take', 'payments:settle',
    'tables:read', 'tables:seat', 'tables:move', 'tables:vacate',
    'shifts:declare_cash', 'shifts:clock',
    'crm:read', 'crm:write', 'reservations:read', 'reservations:write'
  ],
  
  BARISTA: [
    'orders:read:barista', 'orders:post:barista', 'orders:complete:barista',
    'inventory:read:barista', 'inventory:waste:barista',
    'shifts:clock'
  ],
  
  CHEF: [
    'orders:read:kitchen', 'orders:post:kitchen', 'orders:complete:kitchen',
    'inventory:read:kitchen', 'inventory:waste:kitchen',
    'shifts:clock'
  ],
  
  SHISHA: [
    'orders:read:shisha', 'orders:post:shisha', 'orders:complete:shisha',
    'inventory:read:shisha', 'inventory:waste:shisha',
    'shifts:clock'
  ],
  
  WAITER: [
    'orders:create', 'orders:read',
    'tables:read', 'tables:seat', 'tables:move', 'tables:vacate',
    'crm:read', 'crm:write', 'reservations:read', 'reservations:write',
    'shifts:clock'
  ],
  
  RUNNER: [
    'orders:read', 'orders:complete',
    'tables:read',
    'shifts:clock'
  ],
  
  HALL_MANAGER: [
    'orders:create', 'orders:read', 'orders:edit', 'orders:void',
    'tables:read', 'tables:write', 'tables:seat', 'tables:move', 'tables:vacate',
    'reservations:read', 'reservations:write', 'reservations:approve',
    'crm:read', 'crm:write',
    'shifts:clock', 'shifts:read'
  ],
  
  JOKER: [
    'orders:create', 'orders:read', 'orders:edit',
    'tables:read', 'tables:seat', 'tables:move',
    'shifts:clock'
  ],
  
  BOM_MANAGER: [
    'inventory:read', 'inventory:adjust', 'inventory:transfer', 'inventory:purchase', 'inventory:waste', 'inventory:configure',
    'menu:read', 'menu:write', 'menu:configure',
    'reports:inventory', 'reports:export'
  ],
  
  HR_PAYROLL: [
    'shifts:read', 'shifts:manage', 'shifts:approve',
    'payroll:read', 'payroll:write', 'payroll:export', 'payroll:administer',
    'users:read', 'users:write', 'users:configure'
  ],
  
  QA: [
    'qa:read', 'qa:write', 'qa:administer',
    'orders:read', 'tables:read', 'menu:read', 'inventory:read'
  ],
  
  READ_ONLY: [
    'orders:read', 'tables:read', 'menu:read', 'inventory:read', 'shifts:read', 'reports:operational', 'reports:financial'
  ]
};

const ROLE_DEFAULT_ROUTES = {
  SUPER_ADMIN: '/portal.html',
  OWNER: '/portal.html',
  OP_MANAGER: '/portal.html',
  OP_ASSISTANT_CASHIER: '/pos.html',
  CASHIER: '/pos.html',
  BARISTA: '/kds.html',
  CHEF: '/kitchen.html',
  SHISHA: '/shisha.html',
  WAITER: '/pos.html',
  RUNNER: '/runner.html',
  HALL_MANAGER: '/tables.html',
  JOKER: '/pos.html',
  BOM_MANAGER: '/menu-manager.html',
  HR_PAYROLL: '/hr.html',
  QA: '/qa.html',
  READ_ONLY: '/bi.html'
};

function normalizeRole(userRole) {
  if (!userRole) return 'WAITER';
  return String(userRole).toUpperCase().replace(/^ROLE_/, '');
}

function getRoleDefaultRoute(userRole) {
  const role = normalizeRole(userRole);
  return ROLE_DEFAULT_ROUTES[role] || '/portal.html';
}

function hasPermission(userRole, requiredPermission) {
  if (!userRole) return false;
  const role = normalizeRole(userRole);
  const permissions = ROLE_PERMISSIONS[role] || [];
  
  if (permissions.includes('*')) return true;
  if (permissions.includes(requiredPermission)) return true;

  // Wildcard section match (e.g. 'orders:*' matches 'orders:create')
  const [domain] = requiredPermission.split(':');
  if (permissions.includes(`${domain}:*`)) return true;

  return false;
}

function getRolePermissions(userRole) {
  if (!userRole) return [];
  const role = normalizeRole(userRole);
  return ROLE_PERMISSIONS[role] || [];
}

function getClientSafePermissions(userRole) {
  const perms = getRolePermissions(userRole);
  // Never expose raw wildcard '*' to the client
  return perms.filter(p => p !== '*');
}

module.exports = {
  ROLE_PERMISSIONS,
  ROLE_DEFAULT_ROUTES,
  normalizeRole,
  getRoleDefaultRoute,
  hasPermission,
  getRolePermissions,
  getClientSafePermissions
};

