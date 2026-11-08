const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const BaseDynamoRepository = require('./baseDynamoRepository');
const ENTITY = require('../entityTypes');

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Adds a collection onto one installment. Stays pending until amount_due is met. */
function applyInstallmentPayment(payment, amountPaid) {
  if (!payment) return { error: 'Payment not found', status: 404 };
  if (payment.status === 'paid') return { error: 'Payment already completed', status: 400 };
  if (payment.status && payment.status !== 'pending') {
    return { error: 'Payment is not open', status: 400 };
  }

  const incoming = roundMoney(amountPaid);
  if (incoming <= 0) return { error: 'Valid amount is required', status: 400 };

  const already = roundMoney(payment.amount_paid || 0);
  const due = roundMoney(payment.amount_due || 0);
  const remaining = roundMoney(Math.max(0, due - already));
  if (incoming > remaining) {
    return { error: `Amount exceeds the remaining ${remaining.toFixed(2)}`, status: 400 };
  }

  const nextPaid = roundMoney(already + incoming);
  const fullyPaid = due <= 0 || nextPaid + 0.009 >= due;
  return { already, incoming, nextPaid, status: fullyPaid ? 'paid' : 'pending', fullyPaid };
}

function planAfterCollection(plan, incoming) {
  if (!plan || plan.status === 'cancelled') return null;
  const paid = roundMoney((Number(plan.paid_amount) || 0) + incoming);
  const owed = roundMoney(Number(plan.total_with_interest) || 0);
  const update = { paid_amount: paid };
  if (owed > 0 && paid + 0.009 >= owed && plan.status !== 'completed') {
    update.status = 'completed';
  }
  return update;
}

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
    const applied = applyInstallmentPayment(payment, amountPaid);
    if (applied.error) {
      const err = new Error(applied.error);
      err.status = applied.status;
      throw err;
    }

    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: this.pk(tenantId), SK: this.sk(id) },
          UpdateExpression:
            'SET amount_paid = :nextPaid, paid_date = :paidDate, #status = :status, notes = :notes, updatedAt = :now',
          ConditionExpression:
            '#status = :pending AND (attribute_not_exists(amount_paid) OR amount_paid = :already)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':nextPaid': applied.nextPaid,
            ':paidDate': new Date().toISOString(),
            ':status': applied.status,
            ':pending': 'pending',
            ':already': applied.already,
            ':notes': notes || null,
            ':now': new Date().toISOString(),
          },
        })
      );
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        const err = new Error('Payment was updated by someone else. Refresh and try again.');
        err.status = 409;
        throw err;
      }
      throw error;
    }

    const installmentPlanDynamo = require('./installmentPlanDynamoRepository');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const plan = await installmentPlanDynamo.getById(tenantId, payment.installment_plan_id);
      const planUpdate = planAfterCollection(plan, applied.incoming);
      if (!planUpdate) break;
      const previous = roundMoney(Number(plan.paid_amount) || 0);
      const sets = ['paid_amount = :paid', 'updatedAt = :now'];
      const values = {
        ':paid': planUpdate.paid_amount,
        ':previous': previous,
        ':now': new Date().toISOString(),
      };
      const names = {};
      if (planUpdate.status) {
        sets.push('#planStatus = :planStatus');
        names['#planStatus'] = 'status';
        values[':planStatus'] = planUpdate.status;
      }
      try {
        await installmentPlanDynamo.client.send(
          new UpdateCommand({
            TableName: installmentPlanDynamo.tableName,
            Key: {
              PK: installmentPlanDynamo.pk(tenantId),
              SK: installmentPlanDynamo.sk(plan.id),
            },
            UpdateExpression: `SET ${sets.join(', ')}`,
            ConditionExpression: 'attribute_not_exists(paid_amount) OR paid_amount = :previous',
            ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
            ExpressionAttributeValues: values,
          })
        );
        break;
      } catch (error) {
        if (error.name !== 'ConditionalCheckFailedException' || attempt === 2) throw error;
      }
    }
    return this.getById(tenantId, id);
  }
}

module.exports = new InstallmentPaymentDynamoRepository();
module.exports.applyInstallmentPayment = applyInstallmentPayment;
module.exports.planAfterCollection = planAfterCollection;
