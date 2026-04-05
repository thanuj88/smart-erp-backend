const InstallmentPlan = require('../models/InstallmentPlan');
const InstallmentPayment = require('../models/InstallmentPayment');
const Customer = require('../models/Customer');

// Get all installment plans
const getAllPlans = (req, res) => {
  try {
    const plans = InstallmentPlan.getAll();
    res.json(plans);
  } catch (error) {
    console.error('Get installment plans error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get active installment plans
const getActivePlans = (req, res) => {
  try {
    const plans = InstallmentPlan.getActive();
    res.json(plans);
  } catch (error) {
    console.error('Get active plans error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get completed installment plans
const getCompletedPlans = (req, res) => {
  try {
    const plans = InstallmentPlan.getCompleted();
    res.json(plans);
  } catch (error) {
    console.error('Get completed plans error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get plan by ID with payments
const getPlanById = (req, res) => {
  try {
    const plan = InstallmentPlan.getById(req.params.id);
    
    if (!plan) {
      return res.status(404).json({ error: 'Installment plan not found' });
    }

    const payments = InstallmentPayment.getByPlanId(plan.id);
    const customer = Customer.getById(plan.customer_id);

    res.json({
      ...plan,
      payments,
      customer
    });
  } catch (error) {
    console.error('Get plan error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get plans by customer
const getPlansByCustomer = (req, res) => {
  try {
    const plans = InstallmentPlan.getByCustomerId(req.params.customerId);
    res.json(plans);
  } catch (error) {
    console.error('Get customer plans error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Update plan status
const updatePlanStatus = (req, res) => {
  try {
    const { status } = req.body;
    const planId = req.params.id;

    if (!['active', 'completed', 'defaulted'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    InstallmentPlan.updateStatus(planId, status);
    const updated = InstallmentPlan.getById(planId);

    res.json(updated);
  } catch (error) {
    console.error('Update plan status error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getAllPlans,
  getActivePlans,
  getCompletedPlans,
  getPlanById,
  getPlansByCustomer,
  updatePlanStatus
};
