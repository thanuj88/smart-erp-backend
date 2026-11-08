const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { canWorkInstallments } = require('../middleware/installmentAccess');
const {
  getAllPlans,
  getPlanById,
  getActivePlans,
  getCompletedPlans,
  getCustomerIdImage,
  updatePlanStatus
} = require('../controllers/installmentPlanController');

// All routes require authentication and an installment-capable role
router.use(authenticate);
router.use(canWorkInstallments);

// GET /api/installment-plans - Get all installment plans
router.get('/', getAllPlans);

// GET /api/installment-plans/active - Get active plans
router.get('/active', getActivePlans);

// GET /api/installment-plans/completed - Get completed plans
router.get('/completed', getCompletedPlans);

// GET /api/installment-plans/:id/customer-id-image - Customer ID photo (private)
router.get('/:id/customer-id-image', getCustomerIdImage);

// GET /api/installment-plans/:id - Get plan by ID with payments
router.get('/:id', getPlanById);

// PUT /api/installment-plans/:id/status - Update plan status (Admin only)
router.put('/:id/status', requireAdmin, updatePlanStatus);

module.exports = router;
