const customerService = require('../services/customerService');
const { resolveTenantId } = require('../utils/tenant');

const handleServiceError = (res, error, fallback) => {
  console.error(fallback, error);
  const status = error.status || 500;
  res.status(status).json({ error: status === 500 ? 'Server error' : error.message });
};

const getAllCustomers = async (req, res) => {
  try {
    const customers = await customerService.getAll(resolveTenantId(req));
    res.json(customers);
  } catch (error) {
    handleServiceError(res, error, 'Get customers error:');
  }
};

const getCustomerById = async (req, res) => {
  try {
    const customer = await customerService.getById(resolveTenantId(req), req.params.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    res.json(customer);
  } catch (error) {
    handleServiceError(res, error, 'Get customer error:');
  }
};

const searchCustomers = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Search query is required' });
    const customers = await customerService.search(resolveTenantId(req), q);
    res.json(customers);
  } catch (error) {
    handleServiceError(res, error, 'Search customers error:');
  }
};

const lookupCustomerByPhone = async (req, res) => {
  try {
    const phone = req.query.phone;
    if (!phone || !String(phone).trim()) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    const customer = await customerService.lookupByPhone(resolveTenantId(req), phone);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    res.json({
      id: customer.id,
      name: customer.name || '',
      phone: customer.phone,
      email: customer.email || '',
      address: customer.address || '',
      id_card_no: customer.id_card_no || '',
    });
  } catch (error) {
    handleServiceError(res, error, 'Lookup customer error:');
  }
};

const createCustomer = async (req, res) => {
  try {
    const customer = await customerService.create(resolveTenantId(req), req.body);
    res.status(201).json(customer);
  } catch (error) {
    handleServiceError(res, error, 'Create customer error:');
  }
};

const updateCustomer = async (req, res) => {
  try {
    const customer = await customerService.update(resolveTenantId(req), req.params.id, req.body);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    res.json(customer);
  } catch (error) {
    handleServiceError(res, error, 'Update customer error:');
  }
};

module.exports = {
  getAllCustomers,
  getCustomerById,
  searchCustomers,
  lookupCustomerByPhone,
  createCustomer,
  updateCustomer,
};
