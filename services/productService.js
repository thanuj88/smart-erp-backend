const { getProductRepository } = require('../repositories/factory');

class ProductService {
  constructor(repo = getProductRepository()) {
    this.repo = repo;
  }

  getAll(tenantId) {
    return this.repo.getAll(tenantId);
  }

  getById(tenantId, id) {
    return this.repo.getById(tenantId, id);
  }

  getAvailable(tenantId) {
    return this.repo.getAvailable(tenantId);
  }

  getByCategory(tenantId, categoryId) {
    return this.repo.getByCategory(tenantId, categoryId);
  }

  search(tenantId, term) {
    return this.repo.search(tenantId, term);
  }

  create(tenantId, data) {
    return this.repo.create(tenantId, data);
  }

  update(tenantId, id, data) {
    return this.repo.update(tenantId, id, data);
  }

  delete(tenantId, id) {
    return this.repo.delete(tenantId, id);
  }
}

module.exports = new ProductService();
