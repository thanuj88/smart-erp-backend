const BaseDynamoRepository = require('./baseDynamoRepository');
const ENTITY = require('../entityTypes');

class InstallmentPaymentDynamoRepository extends BaseDynamoRepository {
  constructor() {
    super(ENTITY.INSTALLMENT_PAYMENT);
  }

  async getByPlanId(tenantId, planId) {
    return this.queryByTenant(tenantId, {
      filter: (p) => String(p.installment_plan_id) === String(planId),
      sort: (a, b) => (a.payment_number || 0) - (b.payment_number || 0),
    });
  }

  async getAll(tenantId) {
    return this.queryByTenant(tenantId);
  }

  async getPending(tenantId) {
    return this.queryByTenant(tenantId, { filter: (p) => p.status === 'pending' });
  }

  async getOverdue(tenantId) {
    const today = new Date().toISOString().split('T')[0];
    return this.queryByTenant(tenantId, {
      filter: (p) => p.status === 'pending' && p.due_date < today,
    });
  }

  async create(tenantId, data) {
    const id = data.id || `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    await this.put(tenantId, id, {
      installment_plan_id: data.installment_plan_id ?? data.installmentPlanId,
      payment_number: data.payment_number ?? data.paymentNumber,
      amount_due: data.amount_due ?? data.amountDue,
      amount_paid: data.amount_paid ?? data.amountPaid ?? 0,
      due_date: data.due_date ?? data.dueDate,
      status: data.status || 'pending',
      tenant_id: tenantId,
    });
    return this.getById(tenantId, id);
  }

  async getById(tenantId, id) {
    return super.getById(tenantId, id);
  }

  async recordPayment(tenantId, id, amountPaid, notes) {
    const payment = await super.getById(tenantId, id);
    if (!payment) return null;
    await super.update(tenantId, id, {
      amount_paid: amountPaid,
      paid_date: new Date().toISOString(),
      status: 'paid',
      notes: notes || null,
    });
    const installmentPlanDynamo = require('./installmentPlanDynamoRepository');
    const plan = await installmentPlanDynamo.getById(tenantId, payment.installment_plan_id);
    if (plan) {
      await installmentPlanDynamo.update(tenantId, plan.id, {
        paid_amount: (plan.paid_amount || 0) + amountPaid,
      });
    }
    return this.getById(tenantId, id);
  }
}

module.exports = new InstallmentPaymentDynamoRepository();
