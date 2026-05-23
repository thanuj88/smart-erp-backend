const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const saleController = require('../controllers/saleController');
const { authenticate, requireAdmin, requireTeller, requireReportsAccess } = require('../middleware/auth');
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

// Get top selling products
router.get('/top', requireTeller, saleController.getTopProducts);

// Get today's sales
router.get('/today', requireTeller, saleController.getTodaySales);

// Generic timeframe summary
router.get('/summary', requireTeller, saleController.getSummaryByRange);

// Trend data for sales / purchase chart
router.get('/summary/trend', requireTeller, saleController.getSalesTrend);

// Get daily summary
router.get('/summary/daily', requireReportsAccess, saleController.getDailySummary);

// Get weekly summary
router.get('/summary/weekly', requireReportsAccess, saleController.getWeeklySummary);

// Get monthly summary
router.get('/summary/monthly', requireReportsAccess, saleController.getMonthlySummary);

// Sales report routes (admin, teller, or reports:view)
router.get('/', requireReportsAccess, saleController.getAllSales);

router.get('/date-range', requireReportsAccess, saleController.getSalesByDateRange);

router.get('/summary/overall', requireReportsAccess, saleController.getOverallSummary);

module.exports = router;
