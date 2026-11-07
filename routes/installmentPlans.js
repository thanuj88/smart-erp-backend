const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const { PERMISSIONS } = require('../config/permissions');
const {
  getAllPlans,
  getPlanById,
  getActivePlans,
  getCompletedPlans,
  updatePlanStatus
} = require('../controllers/installmentPlanController');

// Collecting at the till (POS "Payment" mode needs active plans + plan detail for the receipt).
const canCollect = requirePermission(
  PERMISSIONS.SALES_CREATE,
  PERMISSIONS.REPORTS_VIEW,
  PERMISSIONS.USERS_MANAGE,
  PERMISSIONS.PLATFORM_MANAGE
);

// Store-wide plan history (all / completed): owner / manager / accountant only, not tellers.
const canViewAllPlans = requirePermission(
  PERMISSIONS.REPORTS_VIEW,
  PERMISSIONS.USERS_VIEW,
  PERMISSIONS.USERS_MANAGE,
  PERMISSIONS.PLATFORM_MANAGE
);

// All routes require authentication
router.use(authenticate);

// GET /api/installment-plans - Get all installment plans (back office only)
router.get('/', canViewAllPlans, getAllPlans);

// GET /api/installment-plans/active - Get active plans (POS payment mode needs this)
router.get('/active', canCollect, getActivePlans);

// GET /api/installment-plans/completed - Get completed plans (back office only)
router.get('/completed', canViewAllPlans, getCompletedPlans);

// GET /api/installment-plans/:id - Get plan by ID with payments
router.get('/:id', canCollect, getPlanById);

// PUT /api/installment-plans/:id/status - Update plan status (Admin only)
router.put('/:id/status', requireAdmin, updatePlanStatus);

module.exports = router;
