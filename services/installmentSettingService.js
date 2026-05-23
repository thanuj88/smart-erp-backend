const { getInstallmentSettingRepository } = require('../repositories/factory');

class InstallmentSettingService {
  constructor(repo = getInstallmentSettingRepository()) {
    this.repo = repo;
  }

  getAll(tenantId) {
    return this.repo.getAll(tenantId);
  }

  createOrUpdate(tenantId, months, interestRate) {
    return this.repo.upsert(tenantId, months, interestRate);
  }

  delete(tenantId, months) {
    return this.repo.delete(tenantId, months);
  }
}

module.exports = new InstallmentSettingService();
