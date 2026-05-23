const BaseDynamoRepository = require('./baseDynamoRepository');
const ENTITY = require('../entityTypes');
const customerDynamoRepository = require('./customerDynamoRepository');

class InstallmentPlanDynamoRepository extends BaseDynamoRepository {
  constructor() {
    super(ENTITY.INSTALLMENT_PLAN);
  }

  async enrich(tenantId, plan) {
    if (!plan) return null;
    if (plan.customer_name) return plan;
    const customer = await customerDynamoRepository.getById(tenantId, plan.customer_id);
    if (customer) {
      plan.customer_name = customer.name;
      plan.customer_phone = customer.phone;
    }
    return plan;
  }

  async getAll(tenantId) {
    const plans = await this.queryByTenant(tenantId, {
      sort: (a, b) => new Date(b.created_at || b.createdAt) - new Date(a.created_at || a.createdAt),
    });
    return Promise.all(plans.map((p) => this.enrich(tenantId, p)));
  }

  async getById(tenantId, id) {
    return this.enrich(tenantId, await super.getById(tenantId, id));
  }

  async getActive(tenantId) {
    const plans = await this.queryByTenant(tenantId, { filter: (p) => p.status === 'active' });
    return Promise.all(plans.map((p) => this.enrich(tenantId, p)));
  }

  async getCompleted(tenantId) {
    const plans = await this.queryByTenant(tenantId, { filter: (p) => p.status === 'completed' });
    return Promise.all(plans.map((p) => this.enrich(tenantId, p)));
  }

  async create(tenantId, data) {
    const id = data.id || `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    await this.put(tenantId, id, {
      sale_id: data.sale_id ?? data.saleId,
      customer_id: data.customer_id ?? data.customerId,
      witness_id: data.witness_id ?? data.witnessId,
      total_amount: data.total_amount ?? data.totalAmount,
      down_payment: data.down_payment ?? data.downPayment,
      remaining_amount: data.remaining_amount ?? data.remainingAmount,
      interest_rate: data.interest_rate ?? data.interestRate,
      interest_amount: data.interest_amount ?? data.interestAmount,
      total_with_interest: data.total_with_interest ?? data.totalWithInterest,
      installment_months: data.installment_months ?? data.installmentMonths,
      monthly_payment: data.monthly_payment ?? data.monthlyPayment,
      paid_amount: 0,
      status: 'active',
      tenant_id: tenantId,
    });
    return this.getById(tenantId, id);
  }

  async updateStatus(tenantId, id, status) {
    await super.update(tenantId, id, { status });
    return this.getById(tenantId, id);
  }
}

module.exports = new InstallmentPlanDynamoRepository();
