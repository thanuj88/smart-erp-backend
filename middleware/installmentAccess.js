const requirePermission = require('./requirePermission');
const { PERMISSIONS } = require('../config/permissions');

/**
 * Installment directory: pending, overdue, plans, and recording payments.
 * Tellers work this daily (check next dues, follow up, collect), so `sales:create` is included.
 * Roles with no sales/reports/users capability (e.g. inventory clerk) are blocked.
 */
const canWorkInstallments = requirePermission(
  PERMISSIONS.SALES_CREATE,
  PERMISSIONS.REPORTS_VIEW,
  PERMISSIONS.USERS_VIEW,
  PERMISSIONS.USERS_MANAGE,
  PERMISSIONS.PLATFORM_MANAGE
);

module.exports = { canWorkInstallments };
