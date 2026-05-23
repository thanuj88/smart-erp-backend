const BaseDynamoRepository = require('./baseDynamoRepository');
const ENTITY = require('../entityTypes');

class CategoryDynamoRepository extends BaseDynamoRepository {
  constructor() {
    super(ENTITY.CATEGORY);
  }

  async getAll(tenantId) {
    return this.queryByTenant(tenantId, {
      sort: (a, b) => (a.name || '').localeCompare(b.name || ''),
    });
  }

  async search(tenantId, term) {
    const lower = term.toLowerCase();
    return this.queryByTenant(tenantId, {
      filter: (c) => (c.name || '').toLowerCase().includes(lower),
    });
  }

  async create(tenantId, data) {
    const id = data.id || `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    await this.put(tenantId, id, {
      name: data.name,
      description: data.description || null,
      icon: data.icon || null,
      tenant_id: tenantId,
    });
    return this.getById(tenantId, id);
  }

  async update(tenantId, id, data) {
    const existing = await super.getById(tenantId, id);
    if (!existing) return null;
    await super.update(tenantId, id, {
      name: data.name ?? existing.name,
      description: data.description ?? existing.description,
      icon: data.icon ?? existing.icon,
    });
    return this.getById(tenantId, id);
  }
}

module.exports = new CategoryDynamoRepository();
