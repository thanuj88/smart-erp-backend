const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const { authenticate } = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const { PERMISSIONS } = require('../config/permissions');

router.get('/', authenticate, settingsController.getSettings);

router.put(
  '/',
  authenticate,
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  settingsController.updateSettings
);

module.exports = router;
