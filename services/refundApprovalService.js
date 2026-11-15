const bcrypt = require('bcryptjs');
const tenantSettingsService = require('./tenantSettingsService');
const orderService = require('./orderService');
const { previewReturn, approvePreview } = require('../utils/refundPolicy');

async function comparePin(pin, pinHash) {
  if (!pinHash) return false;
  return bcrypt.compare(String(pin), String(pinHash));
}

/**
 * Loaded lazily. Requiring the auth repository from a module the order
 * repository imports would cycle through the repository factory at startup.
 */
async function listTenantUsers(tenantId) {
  const { getAuthRepository } = require('../repositories/factory');
  return getAuthRepository().users.queryByTenant(tenantId);
}

/**
 * Server authority for a return. Throws status 400 or 404.
 * The manager PIN is checked here and is never written onto the return.
 */
async function authorizeReturn({
  tenantId,
  user,
  orderNumber,
  lines,
  reason,
  returnType,
  managerPin,
  salesReceiptId,
  warrantyMonths,
}) {
  const settings = await tenantSettingsService.getForTenant(tenantId);
  const order = await orderService.getOrderByNumber(tenantId, orderNumber);
  if (!order) {
    throw Object.assign(new Error('Order not found'), { status: 404 });
  }

  const draft = previewReturn({
    order,
    lines,
    reason,
    returnType,
    salesReceiptId,
    warrantyMonths,
    currencyCode: settings.currencyCode,
    refundWindowDays: settings.refundWindowDays,
    cashRefundApprovalThreshold: settings.cashRefundApprovalThreshold,
  });
  const users = draft.needsManager ? await listTenantUsers(tenantId) : [];
  return approvePreview(draft, {
    managerPin,
    users,
    sellerId: user?.id,
    comparePin,
  });
}

module.exports = { authorizeReturn };
