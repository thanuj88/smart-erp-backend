const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const { PERMISSIONS } = require('../config/permissions');
const {
  recordPayment,
  getPendingPayments,
  getOverduePayments
} = require('../controllers/installmentPaymentController');

// Collecting at the till (POS "Payment" mode) and from the back office.
const canCollect = requirePermission(
  PERMISSIONS.SALES_CREATE,
  PERMISSIONS.REPORTS_VIEW,
  PERMISSIONS.USERS_MANAGE,
  PERMISSIONS.PLATFORM_MANAGE
);

// Store-wide collections view (overdue list): owner / manager / accountant only, not tellers.
const canViewCollections = requirePermission(
  PERMISSIONS.REPORTS_VIEW,
  PERMISSIONS.USERS_VIEW,
  PERMISSIONS.USERS_MANAGE,
  PERMISSIONS.PLATFORM_MANAGE
);

// All routes require authentication
router.use(authenticate);

// GET /api/installment-payments/pending - Get pending payments (POS payment mode needs this)
router.get('/pending', canCollect, getPendingPayments);

// GET /api/installment-payments/overdue - Get overdue payments (back office only)
router.get('/overdue', canViewCollections, getOverduePayments);

// POST /api/installment-payments/:id/pay - Record a payment
router.post('/:id/pay', canCollect, recordPayment);

module.exports = router;
