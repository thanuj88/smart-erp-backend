const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const itemController = require('../controllers/itemController');
const { authenticate, requireAdmin, requireTeller } = require('../middleware/auth');
const validate = require('../middleware/validate');

// All routes require authentication
router.use(authenticate);

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

// Admin only routes
router.post('/', [
  requireAdmin,
  body('name').notEmpty().trim(),
  body('sellingPrice').isFloat({ min: 0 }),
  body('buyingPrice').optional({ values: 'falsy' }).isFloat({ min: 0 }),
  body('quantity').isInt({ min: 0 }),
  body('categoryId').optional({ values: 'falsy' }),
  body('description').optional({ values: 'falsy' }).trim(),
], validate, itemController.createItem);

router.put('/:id', requireAdmin, itemController.updateItem);

router.delete('/:id', requireAdmin, itemController.deleteItem);

module.exports = router;
