const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const userController = require('../controllers/userController');
const { authenticate, requireTenantAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { isStaffRole, STAFF_ROLE_ERROR } = require('../config/staffRoles');

router.use(authenticate, requireTenantAdmin);

router.get('/', userController.getAllUsers);

router.post(
  '/',
  [
    body('email').isEmail().normalizeEmail(),
    body('username').optional().trim(),
    body('password').isLength({ min: 8 }),
    body('role').custom((value) => isStaffRole(value)).withMessage(STAFF_ROLE_ERROR),
    body('pin').optional().isLength({ min: 4, max: 8 }),
  ],
  validate,
  userController.createUser
);

router.put(
  '/:id',
  [
    body('role')
      .optional({ values: 'falsy' })
      .custom((value) => isStaffRole(value))
      .withMessage(STAFF_ROLE_ERROR),
  ],
  validate,
  userController.updateUser
);
router.delete('/:id', userController.deleteUser);

module.exports = router;
