const BaseDynamoRepository = require('./baseDynamoRepository');
const ENTITY = require('../entityTypes');

class WitnessDynamoRepository extends BaseDynamoRepository {
  constructor() {
    super(ENTITY.WITNESS);
  }

  async create(tenantId, data) {
    const id = data.id || `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    await this.put(tenantId, id, {
      name: data.name,
      phone: data.phone,
      id_card_no: data.idCardNo ?? data.id_card_no,
      address: data.address,
      id_image_path: data.idImagePath ?? data.id_image_path ?? null,
      tenant_id: tenantId,
    });
    return this.getById(tenantId, id);
  }
}

module.exports = new WitnessDynamoRepository();
