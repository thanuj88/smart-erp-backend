const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
  getAllPlans,
  getPlanById,
  getActivePlans,
  getCompletedPlans,
  updatePlanStatus
} = require('../controllers/installmentPlanController');

// All routes require authentication
router.use(authenticate);

// GET /api/installment-plans - Get all installment plans
router.get('/', getAllPlans);

// GET /api/installment-plans/active - Get active plans
router.get('/active', getActivePlans);

// GET /api/installment-plans/completed - Get completed plans
router.get('/completed', getCompletedPlans);

// GET /api/installment-plans/:id - Get plan by ID with payments
router.get('/:id', getPlanById);

// PUT /api/installment-plans/:id/status - Update plan status (Admin only)
router.put('/:id/status', requireAdmin, updatePlanStatus);

module.exports = router;
