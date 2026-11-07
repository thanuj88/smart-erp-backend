const {
  getInstallmentPaymentRepository,
  getInstallmentPlanRepository,
} = require('../repositories/factory');
const { memberPhoneKey, DEFAULT_COUNTRY_CODE } = require('../utils/phone');

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
        customer_id: payment.customer_id || plan?.customer_id || null,
        customer_name: payment.customer_name || plan?.customer_name || null,
        customer_phone: payment.customer_phone || plan?.customer_phone || null,
        order_number: payment.order_number || plan?.order_number || null,
        sale_id: payment.sale_id || plan?.sale_id || null,
      });
    }
    return enriched;
  }

  async getOverdueSummaryForCustomer(tenantId, customer, countryCode = DEFAULT_COUNTRY_CODE) {
    if (!customer) return { count: 0, plans: 0, amount: 0 };
    const payments = await this.getOverdue(tenantId);
    const customerId = customer.id != null ? String(customer.id) : '';
    const phoneKey = memberPhoneKey(customer.phone, countryCode);
    const mine = payments.filter((payment) => {
      if (customerId && payment.customer_id && String(payment.customer_id) === customerId) {
        return true;
      }
      return Boolean(phoneKey && memberPhoneKey(payment.customer_phone, countryCode) === phoneKey);
    });
    const planIds = new Set(mine.map((payment) => String(payment.installment_plan_id)));
    const amount = mine.reduce((sum, payment) => {
      const due = Number(payment.amount_due) || 0;
      const paid = Number(payment.amount_paid) || 0;
      return sum + Math.max(0, due - paid);
    }, 0);
    return { count: mine.length, plans: planIds.size, amount };
  }

  recordPayment(tenantId, id, amountPaid, notes) {
    return this.repo.recordPayment(tenantId, id, amountPaid, notes);
  }
}

module.exports = new InstallmentPaymentService();
