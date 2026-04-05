const InstallmentSettings = require('../models/InstallmentSettings');

// Get all settings
const getAllSettings = (req, res) => {
  try {
    const settings = InstallmentSettings.getAll();
    res.json(settings);
  } catch (error) {
    console.error('Get installment settings error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Update or create settings
const updateSettings = (req, res) => {
  try {
    const { months, interest_rate } = req.body;

    if (!months || interest_rate === undefined) {
      return res.status(400).json({ error: 'Months and interest rate are required' });
    }

    const monthsInt = parseInt(months);
    if (isNaN(monthsInt) || monthsInt <= 0) {
      return res.status(400).json({ error: 'Months must be a positive integer' });
    }

    const rateFloat = parseFloat(interest_rate);
    if (isNaN(rateFloat) || rateFloat < 0) {
      return res.status(400).json({ error: 'Interest rate must be a non-negative number' });
    }

    InstallmentSettings.createOrUpdate(monthsInt, rateFloat);
    const updated = InstallmentSettings.getByMonths(monthsInt);

    res.json(updated);
  } catch (error) {
    console.error('Update installment settings error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Delete settings
const deleteSettings = (req, res) => {
  try {
    const { months } = req.params;

    if (!months) {
      return res.status(400).json({ error: 'Months parameter is required' });
    }

    const monthsInt = parseInt(months);
    const result = InstallmentSettings.delete(monthsInt);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Setting not found' });
    }

    res.json({ message: 'Setting deleted successfully' });
  } catch (error) {
    console.error('Delete installment settings error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getAllSettings,
  updateSettings,
  deleteSettings
};
