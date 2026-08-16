const express = require('express');
const router = express.Router();
const promotionController = require('../controllers/promotionController');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.use(authenticate);

router.get('/', promotionController.getPromotions);
router.get('/active', promotionController.getActivePromotions);
router.get('/:id', promotionController.getPromotionById);
router.post('/', requireAdmin, promotionController.createPromotion);
router.put('/:id', requireAdmin, promotionController.updatePromotion);
router.delete('/:id', requireAdmin, promotionController.deletePromotion);

module.exports = router;
