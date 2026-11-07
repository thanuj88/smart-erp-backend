const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { canWorkInstallments } = require('../middleware/installmentAccess');
const {
  recordPayment,
  getPendingPayments,
  getOverduePayments
} = require('../controllers/installmentPaymentController');

// All routes require authentication and an installment-capable role
router.use(authenticate);
router.use(canWorkInstallments);

// GET /api/installment-payments/pending - Get pending payments
router.get('/pending', getPendingPayments);

// GET /api/installment-payments/overdue - Get overdue payments
router.get('/overdue', getOverduePayments);

// POST /api/installment-payments/:id/pay - Record a payment
router.post('/:id/pay', recordPayment);

module.exports = router;
