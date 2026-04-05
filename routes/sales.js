const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const saleController = require('../controllers/saleController');
const { authenticate, requireAdmin, requireTeller } = require('../middleware/auth');
const validate = require('../middleware/validate');

// All routes require authentication
router.use(authenticate);

// Process a cash sale (Teller and Admin)
router.post('/cash', [
  requireTeller,
  body('itemId').isInt(),
  body('quantity').isInt({ min: 1 })
], validate, saleController.processCashSale);

// Process an installment sale (Teller and Admin)
router.post('/installment', [
  requireTeller,
  body('itemId').isInt(),
  body('quantity').isInt({ min: 1 }),
  body('customer').isObject(),
  body('witness').isObject(),
  body('downPayment').isFloat({ min: 0 }),
  body('installmentMonths').isInt().isIn([3, 6, 12])
], validate, saleController.processInstallmentSale);

// Get today's sales
router.get('/today', requireTeller, saleController.getTodaySales);

// Get daily summary
router.get('/summary/daily', requireTeller, saleController.getDailySummary);

// Get weekly summary
router.get('/summary/weekly', requireTeller, saleController.getWeeklySummary);

// Get monthly summary
router.get('/summary/monthly', requireTeller, saleController.getMonthlySummary);

// Admin only routes
router.get('/', requireAdmin, saleController.getAllSales);

router.get('/date-range', requireAdmin, saleController.getSalesByDateRange);

router.get('/summary/overall', requireAdmin, saleController.getOverallSummary);

module.exports = router;
