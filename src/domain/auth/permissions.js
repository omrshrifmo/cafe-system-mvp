/**
 * RBAC Permission Matrix for MENA Cafe ERP
 * Server-authoritative scopes for all API access and UI capabilities.
 */

const PERMISSION_VERSION = '2.1.0';

const ALL_SYSTEM_PERMISSIONS = [
  // Orders & Sales Lifecycle
  'orders:create', 'orders:read', 'orders:view', 'orders:edit', 'orders:submit', 'orders:approve',
  'orders:post', 'orders:settle', 'orders:refund', 'orders:void', 'orders:reopen', 'orders:export',
  // Station Specific Order Scopes
  'orders:read:barista', 'orders:post:barista', 'orders:complete:barista',
  'orders:read:kitchen', 'orders:post:kitchen', 'orders:complete:kitchen',
  'orders:read:shisha', 'orders:post:shisha', 'orders:complete:shisha',
  'orders:complete',
  // Payments & Financials
  'payments:take', 'payments:settle', 'payments:refund', 'payments:void', 'payments:export',
  // Inventory & BOM
  'inventory:read', 'inventory:view', 'inventory:adjust', 'inventory:transfer', 'inventory:purchase',
  'inventory:waste', 'inventory:configure', 'inventory:administer',
  'inventory:read:barista', 'inventory:waste:barista',
  'inventory:read:kitchen', 'inventory:waste:kitchen',
  'inventory:read:shisha', 'inventory:waste:shisha',
  // Menu & Catalog
  'menu:read', 'menu:view', 'menu:write', 'menu:configure', 'menu:export',
  // Tables & Hospitality Floor
  'tables:read', 'tables:view', 'tables:write', 'tables:seat', 'tables:move', 'tables:vacate',
  'reservations:read', 'reservations:write', 'reservations:approve',
  // Reporting & BI
  'reports:financial', 'reports:operational', 'reports:inventory', 'reports:export',
  // Shifts, Cash Float & HR
  'shifts:read', 'shifts:manage', 'shifts:approve', 'shifts:declare_cash', 'shifts:clock',
  'payroll:read', 'payroll:write', 'payroll:export', 'payroll:administer',
  'users:read', 'users:write', 'users:configure',
  // CRM & Loyalty
  'crm:read', 'crm:write', 'crm:export',
  // QA & System Settings
  'qa:read', 'qa:write', 'qa:administer',
  'system:settings', 'system:configure', 'devices:administer', 'sessions:revoke', 'emergency:access'
];

const ROLE_PERMISSIONS = {
  SUPER_ADMIN: ['*'], // Full system authority
  OWNER: ['*'],       // Full business & financial authority
  
  OP_MANAGER: [
    'orders:create', 'orders:read', 'orders:view', 'orders:edit', 'orders:submit', 'orders:approve',
    'orders:post', 'orders:settle', 'orders:refund', 'orders:void', 'orders:reopen', 'orders:export',
    'payments:take', 'payments:refund', 'payments:settle', 'payments:void', 'payments:export',
    'inventory:read', 'inventory:view', 'inventory:adjust', 'inventory:transfer', 'inventory:purchase', 'inventory:waste', 'inventory:administer',
    'menu:read', 'menu:view', 'menu:write', 'menu:configure', 'menu:export',
    'tables:read', 'tables:view', 'tables:write', 'tables:seat', 'tables:move', 'tables:vacate',
    'reservations:read', 'reservations:write', 'reservations:approve',
    'reports:financial', 'reports:operational', 'reports:inventory', 'reports:export',
    'shifts:read', 'shifts:manage', 'shifts:approve', 'shifts:declare_cash', 'shifts:clock',
    'payroll:read', 'payroll:write', 'payroll:export',
    'crm:read', 'crm:write', 'crm:export',
    'qa:read', 'qa:write',
    'system:settings', 'sessions:revoke'
  ],
  
  OP_ASSISTANT_CASHIER: [
    'orders:create', 'orders:read', 'orders:view', 'orders:edit', 'orders:submit',
    'payments:take', 'payments:settle',
    'tables:read', 'tables:view', 'tables:seat', 'tables:move', 'tables:vacate',
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
    'orders:create', 'orders:read', 'orders:view',
    'tables:read', 'tables:view', 'tables:seat', 'tables:move', 'tables:vacate',
    'crm:read', 'crm:write', 'reservations:read', 'reservations:write',
    'shifts:clock'
  ],
  
  RUNNER: [
    'orders:read', 'orders:view', 'orders:complete',
    'tables:read', 'tables:view',
    'shifts:clock'
  ],
  
  HALL_MANAGER: [
    'orders:create', 'orders:read', 'orders:view', 'orders:edit', 'orders:void',
    'tables:read', 'tables:view', 'tables:write', 'tables:seat', 'tables:move', 'tables:vacate',
    'reservations:read', 'reservations:write', 'reservations:approve',
    'crm:read', 'crm:write',
    'shifts:clock', 'shifts:read'
  ],
  
  JOKER: [
    'orders:create', 'orders:read', 'orders:view', 'orders:edit',
    'tables:read', 'tables:view', 'tables:seat', 'tables:move',
    'shifts:clock'
  ],
  
  BOM_MANAGER: [
    'inventory:read', 'inventory:view', 'inventory:adjust', 'inventory:transfer', 'inventory:purchase', 'inventory:waste', 'inventory:configure',
    'menu:read', 'menu:view', 'menu:write', 'menu:configure',
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
    'orders:read', 'orders:view', 'tables:read', 'tables:view', 'menu:read', 'menu:view', 'inventory:read', 'shifts:read', 'reports:operational', 'reports:financial'
  ]
};

ROLE_PERMISSIONS.CASHIER = ROLE_PERMISSIONS.OP_ASSISTANT_CASHIER;
ROLE_PERMISSIONS.INVENTORY_SPECIALIST = ROLE_PERMISSIONS.BOM_MANAGER;
ROLE_PERMISSIONS.QA_AUDITOR = ROLE_PERMISSIONS.QA;
ROLE_PERMISSIONS.SHAREHOLDER_INVESTOR = ROLE_PERMISSIONS.READ_ONLY;
ROLE_PERMISSIONS.ACCOUNTANT_CONTROLLER = ROLE_PERMISSIONS.OP_MANAGER;

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
  INVENTORY_SPECIALIST: '/menu-manager.html',
  HR_PAYROLL: '/hr.html',
  QA: '/qa.html',
  QA_AUDITOR: '/qa.html',
  READ_ONLY: '/bi.html',
  SHAREHOLDER_INVESTOR: '/shareholders.html',
  ACCOUNTANT_CONTROLLER: '/bi.html'
};

function normalizeRole(userRole) {
  if (!userRole) return 'WAITER';
  const r = String(userRole).toUpperCase().replace(/^ROLE_/, '').replace(/^R_/, '');
  if (r === 'CASHIER') return 'OP_ASSISTANT_CASHIER';
  if (r === 'MANAGER') return 'OP_MANAGER';
  return r;
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
  const role = normalizeRole(userRole);
  const perms = getRolePermissions(role);
  if (perms.includes('*')) {
    // Return all distinct known system permissions instead of raw wildcard
    return [...ALL_SYSTEM_PERMISSIONS];
  }
  return perms.filter(p => p !== '*');
}

module.exports = {
  PERMISSION_VERSION,
  ALL_SYSTEM_PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLE_DEFAULT_ROUTES,
  normalizeRole,
  getRoleDefaultRoute,
  hasPermission,
  getRolePermissions,
  getClientSafePermissions
};


