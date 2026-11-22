const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { canWorkInstallments, canRecordInstallmentPayment } = require('../middleware/installmentAccess');
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

// POST /api/installment-payments/:id/pay - Record a payment.
// Accountants may read the lists above; only sellers and store admins may collect.
router.post('/:id/pay', canRecordInstallmentPayment, recordPayment);

module.exports = router;
