const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const { authenticate, requireInventoryManage } = require('../middleware/auth');

// All category routes require authentication
router.use(authenticate);

// Get all categories
router.get('/', categoryController.getCategories);

// Search categories
router.get('/search', categoryController.searchCategories);

// Get category by ID
router.get('/:id', categoryController.getCategoryById);

// Create new category (inventory:manage or tenant admin)
router.post('/', requireInventoryManage, categoryController.createCategory);

// Update category (inventory:manage or tenant admin)
router.put('/:id', requireInventoryManage, categoryController.updateCategory);

// Delete category (inventory:manage or tenant admin)
router.delete('/:id', requireInventoryManage, categoryController.deleteCategory);

module.exports = router;
