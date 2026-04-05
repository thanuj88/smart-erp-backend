const InstallmentPayment = require('../models/InstallmentPayment');
const InstallmentPlan = require('../models/InstallmentPlan');

// Get all payments
const getAllPayments = (req, res) => {
  try {
    const payments = InstallmentPayment.getAll();
    res.json(payments);
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get pending payments
const getPendingPayments = (req, res) => {
  try {
    const payments = InstallmentPayment.getPending();
    res.json(payments);
  } catch (error) {
    console.error('Get pending payments error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get overdue payments
const getOverduePayments = (req, res) => {
  try {
    // First mark overdue
    InstallmentPayment.markOverdue();
    const payments = InstallmentPayment.getOverdue();
    res.json(payments);
  } catch (error) {
    console.error('Get overdue payments error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get payments by plan
const getPaymentsByPlan = (req, res) => {
  try {
    const payments = InstallmentPayment.getByPlanId(req.params.planId);
    res.json(payments);
  } catch (error) {
    console.error('Get plan payments error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Record a payment
const recordPayment = (req, res) => {
  try {
    const { id } = req.params;
    const { amountPaid, notes } = req.body;

    if (!amountPaid || amountPaid <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const payment = InstallmentPayment.getById(id);
    
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    if (payment.status === 'paid') {
      return res.status(400).json({ error: 'Payment already completed' });
    }

    // Record the payment
    InstallmentPayment.recordPayment(id, amountPaid, notes);

    // Update plan paid amount
    InstallmentPlan.updatePaidAmount(payment.installment_plan_id, amountPaid);

    const updatedPayment = InstallmentPayment.getById(id);

    res.json(updatedPayment);
  } catch (error) {
    console.error('Record payment error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getAllPayments,
  getPendingPayments,
  getOverduePayments,
  getPaymentsByPlan,
  recordPayment
};
