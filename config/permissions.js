const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  TENANT_ADMIN: 'TENANT_ADMIN',
  MANAGER: 'MANAGER',
  TELLER: 'TELLER',
  INVENTORY: 'INVENTORY',
  ACCOUNTANT: 'ACCOUNTANT',
};

const PERMISSIONS = {
  SALES_CREATE: 'sales:create',
  SALES_VIEW: 'sales:view',
  INVENTORY_MANAGE: 'inventory:manage',
  INVENTORY_VIEW: 'inventory:view',
  REPORTS_VIEW: 'reports:view',
  USERS_VIEW: 'users:view',
  USERS_MANAGE: 'users:manage',
  SETTINGS_MANAGE: 'settings:manage',
  SUBSCRIPTION_MANAGE: 'subscription:manage',
  PLATFORM_MANAGE: 'platform:manage',
  TENANTS_VIEW: 'tenants:view',
  TENANTS_MANAGE: 'tenants:manage',
  ROLES_MANAGE: 'roles:manage',
};

const LEGACY_ROLE_MAP = {
  admin: ROLES.TENANT_ADMIN,
  teller: ROLES.TELLER,
  manager: ROLES.MANAGER,
  inventory: ROLES.INVENTORY,
  accountant: ROLES.ACCOUNTANT,
};

function normalizeRole(role) {
  if (!role) return null;
  const upper = String(role).toUpperCase();
  if (ROLES[upper]) return ROLES[upper];
  return LEGACY_ROLE_MAP[role] || role;
}

/** Check effective permissions array (from JWT / profile) */
function userHasPermission(permissions, permission) {
  if (!Array.isArray(permissions)) return false;
  return permissions.includes(permission);
}

function userHasAnyPermission(permissions, required) {
  const list = Array.isArray(required) ? required : [required];
  return list.some((p) => userHasPermission(permissions, p));
}

module.exports = {
  ROLES,
  PERMISSIONS,
  LEGACY_ROLE_MAP,
  normalizeRole,
  userHasPermission,
  userHasAnyPermission,
};
