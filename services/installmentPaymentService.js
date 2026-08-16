const {
  getInstallmentPaymentRepository,
  getInstallmentPlanRepository,
} = require('../repositories/factory');

class InstallmentPaymentService {
  constructor(
    repo = getInstallmentPaymentRepository(),
    planRepo = getInstallmentPlanRepository()
  ) {
    this.repo = repo;
    this.planRepo = planRepo;
  }

  getAll(tenantId) {
    return this.repo.getAll(tenantId);
  }

  async getPending(tenantId) {
    const payments = await this.repo.getPending(tenantId);
    return this.enrichWithPlan(tenantId, payments);
  }

  async getOverdue(tenantId) {
    const payments = await this.repo.getOverdue(tenantId);
    return this.enrichWithPlan(tenantId, payments);
  }

  async enrichWithPlan(tenantId, payments) {
    const planCache = new Map();
    const enriched = [];
    for (const payment of payments) {
      const planId = payment.installment_plan_id;
      let plan = planCache.get(String(planId));
      if (plan === undefined && planId) {
        plan = await this.planRepo.getById(tenantId, planId);
        planCache.set(String(planId), plan || null);
      }
      enriched.push({
        ...payment,
        customer_name: payment.customer_name || plan?.customer_name || null,
        customer_phone: payment.customer_phone || plan?.customer_phone || null,
        order_number: payment.order_number || plan?.order_number || null,
        sale_id: payment.sale_id || plan?.sale_id || null,
      });
    }
    return enriched;
  }

  recordPayment(tenantId, id, amountPaid, notes) {
    return this.repo.recordPayment(tenantId, id, amountPaid, notes);
  }
}

module.exports = new InstallmentPaymentService();
