const express = require('express');
const router = express.Router();
const promotionController = require('../controllers/promotionController');
const { authenticate, requireInventoryManage } = require('../middleware/auth');

router.use(authenticate);

router.get('/', promotionController.getPromotions);
router.get('/active', promotionController.getActivePromotions);
router.get('/:id', promotionController.getPromotionById);
router.post('/', requireInventoryManage, promotionController.createPromotion);
router.put('/:id', requireInventoryManage, promotionController.updatePromotion);
router.delete('/:id', requireInventoryManage, promotionController.deletePromotion);

module.exports = router;
