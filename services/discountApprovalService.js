const bcrypt = require('bcryptjs');
const tenantSettingsService = require('./tenantSettingsService');
const { assessDiscount, decideDiscount } = require('../utils/discountPolicy');

async function comparePin(pin, pinHash) {
  if (!pinHash) return false;
  return bcrypt.compare(String(pin), String(pinHash));
}

/**
 * Loaded lazily. Requiring the auth repository from a module that the order
 * repository imports would cycle through the repository factory at startup.
 */
async function listTenantUsers(tenantId) {
  const { getAuthRepository } = require('../repositories/factory');
  return getAuthRepository().users.queryByTenant(tenantId);
}

/**
 * Server authority for a cash or installment discount.
 * Returns the audit fields to store. Throws status 400 when the discount is not allowed.
 * The manager PIN is checked here and is never written onto the sale.
 */
async function authorizeSaleDiscount({ tenantId, user, itemsTotal, input, managerPin, discountReason }) {
  const settings = await tenantSettingsService.getForTenant(tenantId);
  const limits = settings.discountLimits;
  const preliminary = assessDiscount({
    role: user?.role,
    limits,
    itemsTotal,
    input,
  });
  const users = preliminary.needsApproval ? await listTenantUsers(tenantId) : [];

  return decideDiscount({
    role: user?.role,
    sellerId: user?.id,
    limits,
    itemsTotal,
    input,
    managerPin,
    discountReason,
    users,
    comparePin,
  });
}

module.exports = { authorizeSaleDiscount };
