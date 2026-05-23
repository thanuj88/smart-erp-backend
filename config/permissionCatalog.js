/**
 * Canonical capability catalog (stable codes the app enforces).
 * Role → capability mappings are stored in the database and seeded from DEFAULT_ROLE_PERMISSIONS.
 */
const { ROLES, PERMISSIONS } = require('./permissions');

const PERMISSION_CATALOG = [
  { code: PERMISSIONS.SALES_CREATE, name: 'Create sales', category: 'sales' },
  { code: PERMISSIONS.SALES_VIEW, name: 'View sales', category: 'sales' },
  { code: PERMISSIONS.INVENTORY_MANAGE, name: 'Manage inventory', category: 'inventory' },
  { code: PERMISSIONS.INVENTORY_VIEW, name: 'View inventory', category: 'inventory' },
  { code: PERMISSIONS.REPORTS_VIEW, name: 'View reports', category: 'reports' },
  { code: PERMISSIONS.USERS_VIEW, name: 'View users', category: 'users' },
  { code: PERMISSIONS.USERS_MANAGE, name: 'Manage users', category: 'users' },
  { code: PERMISSIONS.SETTINGS_MANAGE, name: 'Manage settings', category: 'settings' },
  { code: PERMISSIONS.SUBSCRIPTION_MANAGE, name: 'Manage subscription', category: 'subscription' },
  { code: PERMISSIONS.PLATFORM_MANAGE, name: 'Platform administration', category: 'platform' },
  { code: PERMISSIONS.TENANTS_VIEW, name: 'View tenants', category: 'platform' },
  { code: PERMISSIONS.TENANTS_MANAGE, name: 'Manage tenants', category: 'platform' },
  { code: PERMISSIONS.ROLES_MANAGE, name: 'Manage roles and capabilities', category: 'platform' },
];

/** Default mappings used only when seeding an empty database */
const DEFAULT_ROLE_PERMISSIONS = {
  [ROLES.SUPER_ADMIN]: PERMISSION_CATALOG.map((p) => p.code),
  [ROLES.TENANT_ADMIN]: [
    PERMISSIONS.SALES_CREATE,
    PERMISSIONS.SALES_VIEW,
    PERMISSIONS.INVENTORY_MANAGE,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.USERS_VIEW,
    PERMISSIONS.USERS_MANAGE,
    PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.SUBSCRIPTION_MANAGE,
  ],
  [ROLES.MANAGER]: [
    PERMISSIONS.SALES_CREATE,
    PERMISSIONS.SALES_VIEW,
    PERMISSIONS.INVENTORY_MANAGE,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.USERS_VIEW,
  ],
  [ROLES.TELLER]: [PERMISSIONS.SALES_CREATE, PERMISSIONS.SALES_VIEW],
  [ROLES.INVENTORY]: [
    PERMISSIONS.INVENTORY_MANAGE,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.SALES_VIEW,
  ],
  [ROLES.ACCOUNTANT]: [
    PERMISSIONS.SALES_VIEW,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.INVENTORY_VIEW,
  ],
};

const ROLE_CATALOG = Object.values(ROLES).map((code) => ({
  code,
  name: code.replace(/_/g, ' '),
  description: `${code} role`,
  system: code === ROLES.SUPER_ADMIN,
}));

module.exports = {
  PERMISSION_CATALOG,
  DEFAULT_ROLE_PERMISSIONS,
  ROLE_CATALOG,
};
