/**
 * RBAC Permission Matrix for MENA Cafe ERP
 */

const ROLE_PERMISSIONS = {
  SUPER_ADMIN: [
    '*' // Full system authority
  ],
  OWNER: [
    '*' // Full business & financial authority
  ],
  ADMIN: [
    '*'
  ],
  OP_MANAGER: [
    'orders:create', 'orders:read', 'orders:complete', 'orders:cancel_request', 'orders:cancel_approve',
    'orders:void_unpaid', 'payments:take', 'payments:void_unpaid',
    'inventory:read', 'inventory:adjust', 'inventory:transfer', 'inventory:purchase', 'inventory:waste',
    'menu:read', 'menu:write',
    'tables:read', 'tables:write', 'tables:seat', 'tables:move', 'tables:vacate',
    'reports:financial', 'reports:operational', 'reports:inventory',
    'shifts:read', 'shifts:manage', 'payroll:read',
    'crm:read', 'crm:write', 'qa:read', 'qa:write'
  ],
  BOM_MANAGER: [
    'inventory:read', 'inventory:adjust', 'inventory:transfer', 'inventory:purchase', 'inventory:waste',
    'menu:read', 'menu:write',
    'reports:inventory', 'reports:operational',
    'qa:read', 'qa:write'
  ],
  HALL_MANAGER: [
    'orders:create', 'orders:read', 'orders:cancel_request',
    'tables:read', 'tables:write', 'tables:seat', 'tables:move', 'tables:vacate',
    'reservations:read', 'reservations:write',
    'crm:read', 'crm:write',
    'shifts:read'
  ],
  OP_ASSISTANT_CASHIER: [
    'orders:create', 'orders:read',
    'payments:take',
    'tables:read', 'tables:seat',
    'shifts:declare_cash', 'shifts:clock',
    'crm:read'
  ],
  CASHIER: [
    'orders:create', 'orders:read',
    'payments:take',
    'tables:read', 'tables:seat',
    'shifts:declare_cash', 'shifts:clock',
    'crm:read'
  ],
  WAITER: [
    'orders:create', 'orders:read', 'orders:cancel_request',
    'tables:read', 'tables:seat', 'tables:move',
    'shifts:clock'
  ],
  JOKER: [
    'orders:create', 'orders:read', 'orders:cancel_request', 'orders:complete',
    'tables:read', 'tables:seat', 'tables:move',
    'shifts:clock'
  ],
  BARISTA: [
    'orders:read:barista', 'orders:complete:barista', 'orders:cancel_approve:barista',
    'inventory:read:barista', 'inventory:waste:barista',
    'shifts:clock'
  ],
  CHEF: [
    'orders:read:kitchen', 'orders:complete:kitchen', 'orders:cancel_approve:kitchen',
    'inventory:read:kitchen', 'inventory:waste:kitchen',
    'shifts:clock'
  ],
  SHIASH: [
    'orders:read:shisha', 'orders:complete:shisha', 'orders:cancel_approve:shisha',
    'inventory:read:shisha', 'inventory:waste:shisha',
    'shifts:clock'
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
