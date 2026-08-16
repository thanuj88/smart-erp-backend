const { getPromotionRepository } = require('../repositories/factory');
const { localToday } = require('../repositories/dynamodb/promotionDynamoRepository');

class PromotionService {
  constructor(repo = getPromotionRepository()) {
    this.repo = repo;
  }

  getAll(tenantId) {
    return this.repo.getAll(tenantId);
  }

  getActive(tenantId) {
    return this.repo.getActive(tenantId, localToday());
  }

  getById(tenantId, id) {
    return this.repo.getById(tenantId, id);
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

module.exports = new PromotionService();
