const express = require('express');
const { query } = require('express-validator');
const { authenticate, requireTenantAdmin } = require('../middleware/auth');
const validate = require('../middleware/validate');
const activityLogController = require('../controllers/activityLogController');
const { ACTIONS } = require('../services/activityLogService');

const router = express.Router();

router.use(authenticate, requireTenantAdmin);

router.get(
  '/',
  [
    query('from').optional({ values: 'falsy' }).isISO8601().withMessage('from must be a date'),
    query('to').optional({ values: 'falsy' }).isISO8601().withMessage('to must be a date'),
    query('action').optional({ values: 'falsy' }).isIn(Object.values(ACTIONS)).withMessage('Unknown action'),
    query('userId').optional({ values: 'falsy' }).isString().isLength({ max: 80 }),
    query('email').optional({ values: 'falsy' }).isString().isLength({ max: 120 }),
    query('limit').optional({ values: 'falsy' }).isInt({ min: 1, max: 100 }).withMessage('limit must be from 1 to 100'),
    query('cursor').optional({ values: 'falsy' }).isString().isLength({ max: 500 }),
  ],
  validate,
  activityLogController.list
);

module.exports = router;
