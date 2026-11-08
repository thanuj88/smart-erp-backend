const { getCustomerRepository, getOrderRepository } = require('../repositories/factory');
const installmentPlanService = require('./installmentPlanService');
const installmentPaymentService = require('./installmentPaymentService');
const tenantSettingsService = require('./tenantSettingsService');
const {
  memberPhoneKey,
  isValidPhoneForCountry,
  phoneValidationMessage,
  DEFAULT_COUNTRY_CODE,
} = require('../utils/phone');

const OPEN_STATUSES = new Set(['active', 'adjusted']);

function planRemaining(plan) {
  const total = Number(plan.total_with_interest) || 0;
  const paid = Number(plan.paid_amount) || 0;
  if (plan.remaining_amount != null && Number.isFinite(Number(plan.remaining_amount))) {
    return Math.max(0, Number(plan.remaining_amount));
  }
  return Math.max(0, total - paid);
}

function summarizePlan(plan) {
  return {
    id: plan.id,
    order_number: plan.order_number || null,
    sale_id: plan.sale_id || null,
    status: plan.status,
    remaining: planRemaining(plan),
    monthly_payment: Number(plan.monthly_payment) || 0,
    installment_months: plan.installment_months || null,
    paid_amount: Number(plan.paid_amount) || 0,
    total_with_interest: Number(plan.total_with_interest) || 0,
  };
}

function withOpenPlanCount(customer, plans) {
  const openPlansCount = plans.filter(
    (plan) =>
      String(plan.customer_id) === String(customer.id) && OPEN_STATUSES.has(plan.status)
  ).length;
  return { ...customer, open_plans_count: openPlansCount };
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

class CustomerService {
  constructor(repo = getCustomerRepository()) {
    this.repo = repo;
  }

  async countryCode(tenantId) {
    try {
      const settings = await tenantSettingsService.getForTenant(tenantId);
      return settings?.countryCode || DEFAULT_COUNTRY_CODE;
    } catch {
      return DEFAULT_COUNTRY_CODE;
    }
  }

  async getAll(tenantId) {
    const [customers, plans] = await Promise.all([
      this.repo.getAll(tenantId),
      installmentPlanService.getAll(tenantId),
    ]);
    return customers.map((customer) => withOpenPlanCount(customer, plans));
  }

  async getById(tenantId, id) {
    const customer = await this.repo.getById(tenantId, id);
    if (!customer) return null;
    const plans = await installmentPlanService.getByCustomerId(tenantId, id);
    return {
      ...customer,
      open_plans_count: plans.filter((plan) => OPEN_STATUSES.has(plan.status)).length,
      plans: plans.map(summarizePlan),
    };
  }

  async search(tenantId, term) {
    const countryCode = await this.countryCode(tenantId);
    const [customers, plans] = await Promise.all([
      this.repo.search(tenantId, term, countryCode),
      installmentPlanService.getAll(tenantId),
    ]);
    return customers.map((customer) => withOpenPlanCount(customer, plans));
  }

  async lookupByPhone(tenantId, phone) {
    const countryCode = await this.countryCode(tenantId);
    if (!memberPhoneKey(phone, countryCode)) return null;
    const customer = await this.repo.getByPhone(tenantId, phone, null, countryCode);
    if (!customer) return null;
    const overdue = await installmentPaymentService.getOverdueSummaryForCustomer(
      tenantId,
      customer,
      countryCode
    );
    return { ...customer, overdue };
  }

  async create(tenantId, data) {
    const phone = String(data.phone || '').trim();
    const countryCode = await this.countryCode(tenantId);
    if (!phone) {
      throw httpError('Phone number is required', 400);
    }
    if (!isValidPhoneForCountry(phone, countryCode)) {
      throw httpError(phoneValidationMessage(phone, countryCode), 400);
    }
    const duplicatePhone = await this.repo.getByPhone(tenantId, phone, null, countryCode);
    if (duplicatePhone) {
      throw httpError('A customer with this phone number already exists', 409);
    }
    const idCardNo = String(data.idCardNo ?? data.id_card_no ?? '').trim();
    if (idCardNo) {
      const duplicateId = await this.repo.getByIdCardNo(tenantId, idCardNo);
      if (duplicateId) {
        throw httpError('A customer with this ID card already exists', 409);
      }
    }
    const created = await this.repo.create(tenantId, { ...data, phone });
    await this.attachWalkInPlans(tenantId, created, countryCode);
    return created;
  }

  /**
   * Installments sold to a phone number before it was a CRM member have customer_id null.
   * When a member with that number exists, link those plans (and their sale rows) to it so the
   * customer page shows them. Safe to repeat: only unlinked plans are touched.
   */
  async attachWalkInPlans(tenantId, customer, countryCode) {
    try {
      const key = customer && memberPhoneKey(customer.phone, countryCode);
      if (!key) return 0;
      const plans = await installmentPlanService.getAll(tenantId);
      const matches = plans.filter(
        (plan) => !plan.customer_id && memberPhoneKey(plan.customer_phone, countryCode) === key
      );
      const orders = getOrderRepository();
      for (const plan of matches) {
        await installmentPlanService.attachCustomer(tenantId, plan.id, customer.id);
        const saleIds = plan.sale_ids?.length ? plan.sale_ids : [plan.sale_id].filter(Boolean);
        for (const saleId of saleIds) {
          await orders.update(tenantId, saleId, { customer_id: customer.id });
        }
      }
      return matches.length;
    } catch (error) {
      // The customer is already saved. A failed link is repaired the next time the phone is saved.
      console.error('Linking walk-in installment plans failed:', error.message);
      return 0;
    }
  }

  async update(tenantId, id, data) {
    const existing = await this.repo.getById(tenantId, id);
    if (!existing) return null;
    const countryCode = await this.countryCode(tenantId);
    if (data.phone !== undefined) {
      const phone = String(data.phone || '').trim();
      if (!phone) {
        throw httpError('Phone number is required', 400);
      }
      if (!isValidPhoneForCountry(phone, countryCode)) {
        throw httpError(phoneValidationMessage(phone, countryCode), 400);
      }
      const duplicatePhone = await this.repo.getByPhone(tenantId, phone, id, countryCode);
      if (duplicatePhone) {
        throw httpError('A customer with this phone number already exists', 409);
      }
    }
    const nextIdCard = data.idCardNo ?? data.id_card_no;
    if (nextIdCard) {
      const duplicate = await this.repo.getByIdCardNo(tenantId, nextIdCard, id);
      if (duplicate) {
        throw httpError('A customer with this ID card already exists', 409);
      }
    }
    const updated = await this.repo.update(tenantId, id, data);
    if (data.phone !== undefined && updated) {
      await this.attachWalkInPlans(tenantId, updated, countryCode);
    }
    return updated;
  }
}

module.exports = new CustomerService();
