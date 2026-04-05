const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const userController = require('../controllers/userController');
const { authenticate, requireAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');

// All routes require admin authentication
router.use(authenticate, requireAdmin);

// Get all users
router.get('/', userController.getAllUsers);

// Create new user
router.post('/', [
  body('username').notEmpty().trim(),
  body('password').isLength({ min: 6 }),
  body('role').isIn(['admin', 'teller'])
], validate, userController.createUser);

// Update user
router.put('/:id', userController.updateUser);

// Delete user
router.delete('/:id', userController.deleteUser);

module.exports = router;
