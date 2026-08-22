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
    'crm:read'
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
    'tables:read', 'tables:seat', 'tables:move',
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

function hasPermission(userRole, requiredPermission) {
  if (!userRole) return false;
  const role = String(userRole).toUpperCase();
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
  const role = String(userRole).toUpperCase();
  return ROLE_PERMISSIONS[role] || [];
}

module.exports = {
  ROLE_PERMISSIONS,
  hasPermission,
  getRolePermissions
};
