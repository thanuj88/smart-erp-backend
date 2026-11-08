const { ROLES, normalizeRole } = require('./permissions');

/**
 * Roles a tenant admin may hand out to staff, on create and on update.
 * It is an allowlist on purpose: a blocklist of admin roles lets any other role name through,
 * including a custom role that carries platform:manage.
 */
const STAFF_ROLES = [ROLES.MANAGER, ROLES.TELLER, ROLES.INVENTORY, ROLES.ACCOUNTANT];

const STAFF_ROLE_ERROR = 'Staff role must be MANAGER, TELLER, INVENTORY, or ACCOUNTANT';

function isStaffRole(role) {
  if (typeof role !== 'string') return false;
  return STAFF_ROLES.includes(normalizeRole(role));
}

module.exports = { STAFF_ROLES, STAFF_ROLE_ERROR, isStaffRole };
