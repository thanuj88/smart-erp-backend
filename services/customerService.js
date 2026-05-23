const { getCustomerRepository } = require('../repositories/factory');

class CustomerService {
  constructor(repo = getCustomerRepository()) {
    this.repo = repo;
  }

  getAll(tenantId) {
    return this.repo.getAll(tenantId);
  }

  getById(tenantId, id) {
    return this.repo.getById(tenantId, id);
  }

  search(tenantId, term) {
    return this.repo.search(tenantId, term);
  }
}

module.exports = new CustomerService();
