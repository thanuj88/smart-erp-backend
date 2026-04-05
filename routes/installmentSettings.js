const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
  getAllSettings,
  updateSettings,
  deleteSettings
} = require('../controllers/installmentSettingsController');

// All routes require authentication
router.use(authenticate);

// GET /api/installment-settings - Get all installment settings (all users)
router.get('/', getAllSettings);

// PUT /api/installment-settings - Update installment settings (admin only)
router.put('/', requireAdmin, updateSettings);

// DELETE /api/installment-settings/:months - Delete installment settings (admin only)
router.delete('/:months', requireAdmin, deleteSettings);

module.exports = router;
