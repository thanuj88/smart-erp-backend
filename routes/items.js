const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const itemController = require('../controllers/itemController');
const { authenticate, requireInventoryManage } = require('../middleware/auth');
const validate = require('../middleware/validate');
const redactCost = require('../middleware/redactCost');

// All routes require authentication
router.use(authenticate);
// Buying price is only for people who manage stock or read reports; tellers get selling data only.
router.use(redactCost);

// Get all items
router.get('/', itemController.getAllItems);

// Get available items
router.get('/available', itemController.getAvailableItems);

// Search items
router.get('/search', itemController.searchItems);

// Get items by category
router.get('/category/:categoryId', itemController.getItemsByCategory);

// Get item by ID
router.get('/:id', itemController.getItemById);

// Inventory clerks and tenant admins. requireAdmin is tenant admin only.
router.post('/', [
  requireInventoryManage,
  body('name').notEmpty().trim(),
  body('sellingPrice').isFloat({ min: 0 }),
  body('buyingPrice').optional({ values: 'falsy' }).isFloat({ min: 0 }),
  body('quantity').isInt({ min: 0 }),
  body('categoryId').optional({ values: 'falsy' }),
  body('description').optional({ values: 'falsy' }).trim(),
  body('image').optional({ values: 'falsy' }).isString(),
  body('removeImage').optional().isBoolean(),
], validate, itemController.createItem);

router.put(
  '/:id',
  [
    requireInventoryManage,
    body('returnQuantity').optional({ values: 'falsy' }).isInt({ min: 0 }),
  ],
  validate,
  itemController.updateItem
);

// Move units from return stock back to sellable stock in one atomic update.
router.post(
  '/:id/release-returns',
  [requireInventoryManage, body('quantity').isInt({ min: 1 })],
  validate,
  itemController.releaseReturns
);

router.delete('/:id', requireInventoryManage, itemController.deleteItem);

module.exports = router;
