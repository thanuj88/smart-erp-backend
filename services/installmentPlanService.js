const {
  getInstallmentPlanRepository,
  getInstallmentPaymentRepository,
  getCustomerRepository,
} = require('../repositories/factory');

class InstallmentPlanService {
  constructor(
    repo = getInstallmentPlanRepository(),
    paymentRepo = getInstallmentPaymentRepository(),
    customerRepo = getCustomerRepository()
  ) {
    this.repo = repo;
    this.paymentRepo = paymentRepo;
    this.customerRepo = customerRepo;
  }

  getAll(tenantId) {
    return this.repo.getAll(tenantId);
  }

  getActive(tenantId) {
    return this.repo.getActive(tenantId);
  }

  getCompleted(tenantId) {
    return this.repo.getCompleted(tenantId);
  }

  async getById(tenantId, id) {
    const plan = await this.repo.getById(tenantId, id);
    if (!plan) return null;
    const payments = await this.paymentRepo.getByPlanId(tenantId, plan.id);
    const customer = await this.customerRepo.getById(tenantId, plan.customer_id);
    return { ...plan, payments, customer };
  }

  getByCustomerId(tenantId, customerId) {
    return this.repo.getAll(tenantId).then((plans) =>
      plans.filter((p) => String(p.customer_id) === String(customerId))
    );
  }

  updateStatus(tenantId, id, status) {
    return this.repo.updateStatus(tenantId, id, status);
  }
}

module.exports = new InstallmentPlanService();
