const { canSeeCost, canSeeProfit, redactMoneyFields } = require('../utils/costVisibility');

/**
 * Strips cost and profit fields from every JSON response unless the caller may see them.
 * Mount after `authenticate` on routers that return products or sales, so a new endpoint
 * or field cannot leak margin to tellers by accident.
 */
function redactCost(req, res, next) {
  const allowed = { cost: canSeeCost(req.user), profit: canSeeProfit(req.user) };
  if (allowed.cost && allowed.profit) return next();

  const originalJson = res.json.bind(res);
  res.json = (body) => originalJson(redactMoneyFields(body, allowed));
  next();
}

module.exports = redactCost;
