const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const userController = require('../controllers/userController');
const { authenticate, requireTenantAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { ROLES } = require('../config/permissions');

router.use(authenticate, requireTenantAdmin);

router.get('/', userController.getAllUsers);

router.post(
  '/',
  [
    body('username').notEmpty().trim(),
    body('password').isLength({ min: 8 }),
    body('role').isIn([
      ROLES.MANAGER,
      ROLES.TELLER,
      ROLES.INVENTORY,
      ROLES.ACCOUNTANT,
      'manager',
      'teller',
      'inventory',
      'accountant',
    ]),
    body('email').optional().isEmail(),
    body('pin').optional().isLength({ min: 4, max: 8 }),
  ],
  validate,
  userController.createUser
);

router.put('/:id', userController.updateUser);
router.delete('/:id', userController.deleteUser);

module.exports = router;
