const { getCategoryRepository, getProductRepository } = require('../repositories/factory');

class CategoryService {
  constructor(repo = getCategoryRepository(), productRepo = getProductRepository()) {
    this.repo = repo;
    this.productRepo = productRepo;
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

  create(tenantId, data) {
    return this.repo.create(tenantId, data);
  }

  update(tenantId, id, data) {
    return this.repo.update(tenantId, id, data);
  }

  delete(tenantId, id) {
    return this.repo.delete(tenantId, id);
  }

  getItemsCount(tenantId, categoryId) {
    return this.productRepo.getItemsCountByCategory(tenantId, categoryId);
  }
}

module.exports = new CategoryService();
