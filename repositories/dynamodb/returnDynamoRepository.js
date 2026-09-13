const BaseDynamoRepository = require('./baseDynamoRepository');
const ENTITY = require('../entityTypes');

class ReturnDynamoRepository extends BaseDynamoRepository {
  constructor() {
    super(ENTITY.RETURN);
  }

  async getAll(tenantId) {
    return this.queryByTenant(tenantId, {
      sort: (a, b) => new Date(b.created_at || b.createdAt) - new Date(a.created_at || a.createdAt),
    });
  }

  async getByOrderNumber(tenantId, orderNumber) {
    return this.queryByTenant(tenantId, {
      filter: (row) => String(row.order_number || '') === String(orderNumber),
      sort: (a, b) => new Date(b.created_at || b.createdAt) - new Date(a.created_at || a.createdAt),
    });
  }
}

module.exports = new ReturnDynamoRepository();
