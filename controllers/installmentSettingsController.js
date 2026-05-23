const installmentSettingService = require('../services/installmentSettingService');
const { resolveTenantId } = require('../utils/tenant');

const getAllSettings = async (req, res) => {
  try {
    const settings = await installmentSettingService.getAll(resolveTenantId(req));
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const updateSettings = async (req, res) => {
  try {
    const { months, interest_rate } = req.body;
    if (!months || interest_rate === undefined) {
      return res.status(400).json({ error: 'Months and interest rate are required' });
    }
    const monthsInt = parseInt(months, 10);
    if (Number.isNaN(monthsInt) || monthsInt <= 0) {
      return res.status(400).json({ error: 'Months must be a positive integer' });
    }
    const rateFloat = parseFloat(interest_rate);
    if (Number.isNaN(rateFloat) || rateFloat < 0) {
      return res.status(400).json({ error: 'Interest rate must be a non-negative number' });
    }

    const updated = await installmentSettingService.createOrUpdate(
      resolveTenantId(req),
      monthsInt,
      rateFloat
    );
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const deleteSettings = async (req, res) => {
  try {
    const monthsInt = parseInt(req.params.months, 10);
    const result = await installmentSettingService.delete(resolveTenantId(req), monthsInt);
    if (result?.changes === 0) return res.status(404).json({ error: 'Setting not found' });
    res.json({ message: 'Setting deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getAllSettings,
  updateSettings,
  deleteSettings,
};
