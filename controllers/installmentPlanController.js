const installmentPlanService = require('../services/installmentPlanService');
const { resolveTenantId } = require('../utils/tenant');

const getAllPlans = async (req, res) => {
  try {
    const plans = await installmentPlanService.getAll(resolveTenantId(req));
    res.json(plans);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const getActivePlans = async (req, res) => {
  try {
    const plans = await installmentPlanService.getActive(resolveTenantId(req));
    res.json(plans);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const getCompletedPlans = async (req, res) => {
  try {
    const plans = await installmentPlanService.getCompleted(resolveTenantId(req));
    res.json(plans);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const getPlanById = async (req, res) => {
  try {
    const plan = await installmentPlanService.getById(resolveTenantId(req), req.params.id);
    if (!plan) return res.status(404).json({ error: 'Installment plan not found' });
    res.json(plan);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const getPlansByCustomer = async (req, res) => {
  try {
    const plans = await installmentPlanService.getByCustomerId(
      resolveTenantId(req),
      req.params.customerId
    );
    res.json(plans);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const updatePlanStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'completed', 'defaulted'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const plan = await installmentPlanService.updateStatus(
      resolveTenantId(req),
      req.params.id,
      status
    );
    if (!plan) return res.status(404).json({ error: 'Installment plan not found' });
    res.json(plan);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getAllPlans,
  getActivePlans,
  getCompletedPlans,
  getPlanById,
  getPlansByCustomer,
  updatePlanStatus,
};
