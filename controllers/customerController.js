const Customer = require('../models/Customer');

// Get all customers
const getAllCustomers = (req, res) => {
  try {
    const customers = Customer.getAll();
    res.json(customers);
  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get customer by ID
const getCustomerById = (req, res) => {
  try {
    const customer = Customer.getById(req.params.id);
    
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json(customer);
  } catch (error) {
    console.error('Get customer error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Search customers
const searchCustomers = (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const customers = Customer.search(q);
    res.json(customers);
  } catch (error) {
    console.error('Search customers error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getAllCustomers,
  getCustomerById,
  searchCustomers
};
