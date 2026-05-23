const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');
const {
  loginLimiter,
  registerLimiter,
  passwordResetLimiter,
} = require('../middleware/rateLimit');

router.post(
  '/register',
  registerLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    body('fullName').notEmpty().trim(),
    body('businessName').notEmpty().trim(),
    body('username').optional().trim(),
  ],
  validate,
  authController.register
);

router.get('/verify-email', authController.verifyEmail);
router.post('/verify-email', authController.verifyEmail);

router.post(
  '/login',
  loginLimiter,
  [body('password').notEmpty()],
  validate,
  authController.login
);

router.post(
  '/login/pin',
  loginLimiter,
  [body('username').notEmpty(), body('pin').notEmpty()],
  validate,
  authController.loginPin
);

router.post('/refresh', authController.refresh);

router.post('/logout', authenticate, authController.logout);

router.post(
  '/forgot-password',
  passwordResetLimiter,
  [body('email').isEmail().normalizeEmail()],
  validate,
  authController.forgotPassword
);

router.post(
  '/reset-password',
  passwordResetLimiter,
  [body('token').notEmpty(), body('newPassword').isLength({ min: 8 })],
  validate,
  authController.resetPassword
);

router.get('/profile', authenticate, authController.getProfile);

router.post(
  '/change-password',
  authenticate,
  [body('currentPassword').notEmpty(), body('newPassword').isLength({ min: 8 })],
  validate,
  authController.changePassword
);

router.get('/sessions', authenticate, authController.listSessions);
router.delete('/sessions/:id', authenticate, authController.revokeSession);
router.get('/branches', authController.listBranches);

module.exports = router;
