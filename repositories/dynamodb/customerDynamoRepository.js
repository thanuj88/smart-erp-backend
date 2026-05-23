const BaseDynamoRepository = require('./baseDynamoRepository');
const ENTITY = require('../entityTypes');

class CustomerDynamoRepository extends BaseDynamoRepository {
  constructor() {
    super(ENTITY.CUSTOMER);
  }

  async getAll(tenantId) {
    return this.queryByTenant(tenantId, {
      sort: (a, b) => (a.name || '').localeCompare(b.name || ''),
    });
  }

  async getByIdCardNo(tenantId, idCardNo) {
    const all = await this.queryByTenant(tenantId);
    return all.find((c) => c.id_card_no === idCardNo) || null;
  }

  async search(tenantId, term) {
    const lower = term.toLowerCase();
    return this.queryByTenant(tenantId, {
      filter: (c) =>
        (c.name || '').toLowerCase().includes(lower) ||
        (c.phone || '').includes(term) ||
        (c.id_card_no || '').includes(term),
    });
  }

  async create(tenantId, data) {
    const id = data.id || `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    await this.put(tenantId, id, {
      name: data.name,
      phone: data.phone,
      id_card_no: data.idCardNo ?? data.id_card_no,
      email: data.email || null,
      address: data.address,
      id_image_path: data.idImagePath ?? data.id_image_path ?? null,
      tenant_id: tenantId,
    });
    return this.getById(tenantId, id);
  }
}

module.exports = new CustomerDynamoRepository();
