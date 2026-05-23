const BaseDynamoRepository = require('./baseDynamoRepository');
const ENTITY = require('../entityTypes');

class InstallmentSettingDynamoRepository extends BaseDynamoRepository {
  constructor() {
    super(ENTITY.INSTALLMENT_SETTING);
  }

  async getAll(tenantId) {
    return this.queryByTenant(tenantId, {
      sort: (a, b) => (a.months || 0) - (b.months || 0),
    });
  }

  async getByMonths(tenantId, months) {
    const all = await this.getAll(tenantId);
    return all.find((s) => Number(s.months) === Number(months)) || null;
  }

  async upsert(tenantId, months, interestRate) {
    const existing = await this.getByMonths(tenantId, months);
    if (existing) {
      await super.update(tenantId, existing.id, { interest_rate: interestRate });
      return this.getById(tenantId, existing.id);
    }
    const id = `months-${months}`;
    await this.put(tenantId, id, { months, interest_rate: interestRate, tenant_id: tenantId });
    return this.getById(tenantId, id);
  }
}

module.exports = new InstallmentSettingDynamoRepository();
