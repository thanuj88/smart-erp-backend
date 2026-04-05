const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const {
  recordPayment,
  getPendingPayments,
  getOverduePayments
} = require('../controllers/installmentPaymentController');

// All routes require authentication
router.use(authenticate);

// GET /api/installment-payments/pending - Get pending payments
router.get('/pending', getPendingPayments);

// GET /api/installment-payments/overdue - Get overdue payments
router.get('/overdue', getOverduePayments);

// POST /api/installment-payments/:id/pay - Record a payment
router.post('/:id/pay', recordPayment);

module.exports = router;
