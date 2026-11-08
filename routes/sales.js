const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const saleController = require('../controllers/saleController');
const { authenticate, requireAdmin, requireTeller, requireReportsAccess } = require('../middleware/auth');
const validate = require('../middleware/validate');
const redactCost = require('../middleware/redactCost');

// All routes require authentication
router.use(authenticate);
// Cost and profit never leave the API for callers who may not see them (e.g. tellers).
router.use(redactCost);

// Process a cash sale (Teller and Admin)
router.post('/cash', [
  requireTeller,
  body('itemId').not().exists().withMessage('Use lines instead of itemId'),
  body('quantity').not().exists().withMessage('Use lines instead of quantity'),
  body('lines').isArray({ min: 1 }),
  body('lines.*.itemId').exists({ checkFalsy: true }),
  body('lines.*.quantity').isInt({ min: 1 }),
  body('idempotencyKey').isString(),
  body('orderNumber').optional().isString(),
  body('customerPhone').optional({ nullable: true }).isString(),
], validate, saleController.processCashSale);

// Process an installment sale (Teller and Admin)
router.post('/installment', [
  requireTeller,
  body('itemId').not().exists().withMessage('Use lines instead of itemId'),
  body('quantity').not().exists().withMessage('Use lines instead of quantity'),
  body('lines').isArray({ min: 1 }),
  body('lines.*.itemId').exists({ checkFalsy: true }),
  body('lines.*.quantity').isInt({ min: 1 }),
  body('customer').isObject(),
  body('includeWitness').optional().isBoolean(),
  body('witness').optional({ nullable: true }).isObject(),
  body('downPayment').isFloat({ min: 0 }),
  body('installmentMonths').isInt().isIn([3, 6, 12]),
  body('orderNumber').optional().isString(),
], validate, saleController.processInstallmentSale);

router.get('/orders/:orderNumber', requireTeller, saleController.getOrderByNumber);
router.get('/returns', requireReportsAccess, saleController.listReturns);
router.post(
  '/returns',
  [
    requireTeller,
    body('orderNumber').isString().notEmpty(),
    body('lines').isArray({ min: 1 }),
    body('reason').optional({ nullable: true }).isString(),
    body('returnType').optional().isIn(['cash', 'defect', 'warranty']),
  ],
  validate,
  saleController.processReturn
);

// Get top selling products (store-wide, so reports access)
router.get('/top', requireReportsAccess, saleController.getTopProducts);

// Today's / recent sale lists are store-wide reports, not POS lookup
router.get('/today', requireReportsAccess, saleController.getTodaySales);
router.get('/recent', requireReportsAccess, saleController.getRecentSales);

// Generic timeframe summary (store-wide totals, so reports access)
router.get('/summary', requireReportsAccess, saleController.getSummaryByRange);

// Trend data for sales / purchase chart (store-wide, so reports access)
router.get('/summary/trend', requireReportsAccess, saleController.getSalesTrend);

// Get daily summary
router.get('/summary/daily', requireReportsAccess, saleController.getDailySummary);

// Get weekly summary
router.get('/summary/weekly', requireReportsAccess, saleController.getWeeklySummary);

// Get monthly summary
router.get('/summary/monthly', requireReportsAccess, saleController.getMonthlySummary);

// Sales report routes (admin or reports:view; not tellers)
router.get('/', requireReportsAccess, saleController.getAllSales);

router.get('/date-range', requireReportsAccess, saleController.getSalesByDateRange);

router.get('/summary/overall', requireReportsAccess, saleController.getOverallSummary);

module.exports = router;
