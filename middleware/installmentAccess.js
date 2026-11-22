const requirePermission = require('./requirePermission');
const { canSellUser, isAdminUser } = require('./auth');
const { PERMISSIONS } = require('../config/permissions');

/**
 * Installment directory: pending, overdue, and plans.
 * Tellers work this daily, so `sales:create` is included.
 * Accountants (`reports:view`) may look up plans. They may not collect.
 * Roles with no sales/reports/users capability (e.g. inventory clerk) are blocked.
 */
const canWorkInstallments = requirePermission(
  PERMISSIONS.SALES_CREATE,
  PERMISSIONS.REPORTS_VIEW,
  PERMISSIONS.USERS_VIEW,
  PERMISSIONS.USERS_MANAGE,
  PERMISSIONS.PLATFORM_MANAGE
);

/**
 * Recording a payment. View access is not enough: an accountant can open the
 * directory and still be refused here. Tellers (`sales:create`) and store admins may collect.
 */
function canRecordInstallmentPayment(req, res, next) {
  if (canSellUser(req.user) || isAdminUser(req.user)) return next();
  return res.status(403).json({
    error: 'Access denied. Recording installment payments requires sales permission.',
  });
}

module.exports = { canWorkInstallments, canRecordInstallmentPayment };
