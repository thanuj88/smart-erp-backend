const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const { PERMISSIONS } = require('../config/permissions');
const {
  getAllCustomers,
  getCustomerById,
  searchCustomers,
  lookupCustomerByPhone,
  createCustomer,
  updateCustomer,
} = require('../controllers/customerController');

router.use(authenticate);

const canView = requirePermission(
  PERMISSIONS.REPORTS_VIEW,
  PERMISSIONS.USERS_VIEW,
  PERMISSIONS.USERS_MANAGE,
  PERMISSIONS.PLATFORM_MANAGE
);
const canLookup = requirePermission(
  PERMISSIONS.SALES_CREATE,
  PERMISSIONS.REPORTS_VIEW,
  PERMISSIONS.USERS_VIEW,
  PERMISSIONS.USERS_MANAGE,
  PERMISSIONS.PLATFORM_MANAGE
);
const canManage = requirePermission(PERMISSIONS.USERS_MANAGE, PERMISSIONS.PLATFORM_MANAGE);

router.get('/', canView, getAllCustomers);
router.get('/search', canView, searchCustomers);
router.get('/lookup', canLookup, lookupCustomerByPhone);
router.post('/', canManage, createCustomer);
router.get('/:id', canView, getCustomerById);
router.put('/:id', canManage, updateCustomer);

module.exports = router;
