const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');

// Login route
router.post('/login', [
  body('username').notEmpty().trim(),
  body('password').notEmpty()
], validate, authController.login);

// Get current user profile
router.get('/profile', authenticate, authController.getProfile);

// Change password
router.post('/change-password', [
  authenticate,
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 6 })
], validate, authController.changePassword);

module.exports = router;
