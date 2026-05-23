const installmentPaymentService = require('../services/installmentPaymentService');
const { getInstallmentPaymentRepository } = require('../repositories/factory');
const { resolveTenantId } = require('../utils/tenant');

const getAllPayments = async (req, res) => {
  try {
    const repo = getInstallmentPaymentRepository();
    const payments = await repo.getAll(resolveTenantId(req));
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const getPendingPayments = async (req, res) => {
  try {
    const payments = await installmentPaymentService.getPending(resolveTenantId(req));
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const getOverduePayments = async (req, res) => {
  try {
    const payments = await installmentPaymentService.getOverdue(resolveTenantId(req));
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const getPaymentsByPlan = async (req, res) => {
  try {
    const repo = getInstallmentPaymentRepository();
    const payments = await repo.getByPlanId(resolveTenantId(req), req.params.planId);
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const recordPayment = async (req, res) => {
  try {
    const { amountPaid, notes } = req.body;
    if (!amountPaid || amountPaid <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const tenantId = resolveTenantId(req);
    const repo = getInstallmentPaymentRepository();
    const payment = await repo.getById(tenantId, req.params.id);

    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (payment.status === 'paid') return res.status(400).json({ error: 'Payment already completed' });

    const updated = await installmentPaymentService.recordPayment(
      tenantId,
      req.params.id,
      amountPaid,
      notes
    );
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getAllPayments,
  getPendingPayments,
  getOverduePayments,
  getPaymentsByPlan,
  recordPayment,
};
