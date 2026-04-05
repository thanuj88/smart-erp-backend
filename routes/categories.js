const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const { authenticate, requireAdmin } = require('../middleware/auth');

// All category routes require authentication
router.use(authenticate);

// Get all categories
router.get('/', categoryController.getCategories);

// Search categories
router.get('/search', categoryController.searchCategories);

// Get category by ID
router.get('/:id', categoryController.getCategoryById);

// Create new category (admin only)
router.post('/', requireAdmin, categoryController.createCategory);

// Update category (admin only)
router.put('/:id', requireAdmin, categoryController.updateCategory);

// Delete category (admin only)
router.delete('/:id', requireAdmin, categoryController.deleteCategory);

module.exports = router;
