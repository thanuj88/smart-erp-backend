const { getInstallmentPaymentRepository } = require('../repositories/factory');

class InstallmentPaymentService {
  constructor(repo = getInstallmentPaymentRepository()) {
    this.repo = repo;
  }

  getAll(tenantId) {
    return this.repo.getAll(tenantId);
  }

  getPending(tenantId) {
    return this.repo.getPending(tenantId);
  }

  getOverdue(tenantId) {
    return this.repo.getOverdue(tenantId);
  }

  recordPayment(tenantId, id, amountPaid, notes) {
    return this.repo.recordPayment(tenantId, id, amountPaid, notes);
  }
}

module.exports = new InstallmentPaymentService();
