const express = require('express');
const router = express.Router();
const planController = require('../controllers/planController');
const requireRole = require('../middleware/requireRole');
const auth = require('../middleware/auth');

// All plan routes require authentication and SUPER_ADMIN role

// Plans management
router.post('/', auth, requireRole('SUPER_ADMIN'), planController.createPlan);
router.get('/', auth, planController.getPlans);
router.get('/:id', auth, planController.getPlanById);
router.put('/:id', auth, requireRole('SUPER_ADMIN'), planController.updatePlan);
router.delete('/:id', auth, requireRole('SUPER_ADMIN'), planController.deletePlan);

// Features in plans
router.post('/:planId/features', auth, requireRole('SUPER_ADMIN'), planController.addFeatureToPlan);
router.delete('/:planId/features/:featureId', auth, requireRole('SUPER_ADMIN'), planController.removeFeatureFromPlan);

// Features management
router.get('/admin/features', auth, requireRole('SUPER_ADMIN'), planController.getFeatures);
router.post('/admin/features', auth, requireRole('SUPER_ADMIN'), planController.createFeature);

// Analytics
router.get('/admin/analytics', auth, requireRole('SUPER_ADMIN'), planController.getAnalytics);

module.exports = router;
