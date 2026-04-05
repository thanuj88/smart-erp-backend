const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const {
  getAllCustomers,
  getCustomerById,
  searchCustomers
} = require('../controllers/customerController');

// All routes require authentication
router.use(authenticate);

// GET /api/customers - Get all customers
router.get('/', getAllCustomers);

// GET /api/customers/search?q=term - Search customers
router.get('/search', searchCustomers);

// GET /api/customers/:id - Get customer by ID
router.get('/:id', getCustomerById);

module.exports = router;
