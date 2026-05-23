const customerService = require('../services/customerService');
const { resolveTenantId } = require('../utils/tenant');

const getAllCustomers = async (req, res) => {
  try {
    const customers = await customerService.getAll(resolveTenantId(req));
    res.json(customers);
  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const getCustomerById = async (req, res) => {
  try {
    const customer = await customerService.getById(resolveTenantId(req), req.params.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    res.json(customer);
  } catch (error) {
    console.error('Get customer error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const searchCustomers = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Search query is required' });
    const customers = await customerService.search(resolveTenantId(req), q);
    res.json(customers);
  } catch (error) {
    console.error('Search customers error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getAllCustomers,
  getCustomerById,
  searchCustomers,
};
