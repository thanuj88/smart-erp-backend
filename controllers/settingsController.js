const tenantSettingsService = require('../services/tenantSettingsService');
const { ROLES } = require('../config/permissions');

function tenantIdFromUser(user) {
  if (!user) return null;
  const id = user.tenantId ?? user.tenant_id;
  if (id == null || id === '') return null;
  return String(id);
}

const getSettings = async (req, res) => {
  try {
    const tenantId = tenantIdFromUser(req.user);
    if (!tenantId && req.user?.role !== ROLES.SUPER_ADMIN) {
      return res.status(400).json({ error: 'No store associated with this account' });
    }
    if (!tenantId) {
      return res.json(tenantSettingsService.getForTenant(null));
    }
    const settings = await tenantSettingsService.getForTenant(tenantId);
    res.json(settings);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const updateSettings = async (req, res) => {
  try {
    const tenantId = tenantIdFromUser(req.user);
    if (!tenantId) {
      return res.status(400).json({ error: 'No store associated with this account' });
    }

    const settings = await tenantSettingsService.updateForTenant(tenantId, {
      businessName: req.body.businessName,
      currencyCode: req.body.currencyCode,
      currencyLabel: req.body.currency,
      currencySymbol: req.body.currencySymbol,
      countryCode: req.body.countryCode,
      taxRate: req.body.taxRate,
      lowStockThreshold: req.body.lowStockThreshold,
      receiptFooter: req.body.receiptFooter,
      receipt: req.body.receipt,
      removeReceiptLogo: req.body.removeReceiptLogo,
    });

    res.json(settings);
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
};

module.exports = { getSettings, updateSettings };
