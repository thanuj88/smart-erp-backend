/**
 * Who may see what money fields in API responses.
 *
 * - Profit (profit, total_profit): owner-level and reporting roles only.
 * - Cost (buying_price, purchase totals): the same people, plus stock managers who set buying prices.
 * Tellers (sales:create only) never receive either, even from endpoints they must call to sell.
 */
const { userHasAnyPermission, PERMISSIONS } = require('../config/permissions');

const COST_KEYS = new Set(['buying_price', 'buyingPrice', 'total_purchase', 'purchase']);
const PROFIT_KEYS = new Set(['profit', 'total_profit']);

function canSeeProfit(user) {
  return userHasAnyPermission(user?.permissions, [
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.USERS_MANAGE,
    PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.PLATFORM_MANAGE,
  ]);
}

function canSeeCost(user) {
  return canSeeProfit(user) || userHasAnyPermission(user?.permissions, [PERMISSIONS.INVENTORY_MANAGE]);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

/** Returns a copy of `body` without the fields the user may not see. */
function redactMoneyFields(body, { cost, profit }) {
  if (Array.isArray(body)) return body.map((entry) => redactMoneyFields(entry, { cost, profit }));
  if (!isPlainObject(body)) return body;

  const out = {};
  for (const [key, value] of Object.entries(body)) {
    if (!cost && COST_KEYS.has(key)) continue;
    if (!profit && PROFIT_KEYS.has(key)) continue;
    out[key] = redactMoneyFields(value, { cost, profit });
  }
  return out;
}

module.exports = { canSeeProfit, canSeeCost, redactMoneyFields };
