const { getCustomerRepository } = require('../repositories/factory');
const installmentPlanService = require('./installmentPlanService');
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
    return this.repo.getByPhone(tenantId, phone, null, countryCode);
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
    return this.repo.create(tenantId, { ...data, phone });
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
    return this.repo.update(tenantId, id, data);
  }
}

module.exports = new CustomerService();
