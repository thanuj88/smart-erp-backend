const BaseDynamoRepository = require('./baseDynamoRepository');
const ENTITY = require('../entityTypes');

const APPLIES_TO = new Set(['all', 'categories', 'items']);

const toIdList = (value) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => String(id).trim()).filter(Boolean))];
};

const normalizePayload = (data = {}, existing = {}) => {
  const appliesTo = APPLIES_TO.has(data.applies_to) ? data.applies_to : existing.applies_to || 'all';
  const percent = Number(data.percent ?? existing.percent ?? 0);
  return {
    name: String(data.name ?? existing.name ?? '').trim(),
    percent,
    start_date: data.start_date ?? existing.start_date ?? null,
    end_date: data.end_date ?? existing.end_date ?? null,
    applies_to: appliesTo,
    category_ids: appliesTo === 'categories' ? toIdList(data.category_ids ?? existing.category_ids) : [],
    item_ids: appliesTo === 'items' ? toIdList(data.item_ids ?? existing.item_ids) : [],
    active: data.active != null ? Boolean(data.active) : existing.active !== false,
    tenant_id: data.tenant_id ?? existing.tenant_id,
  };
};

class PromotionDynamoRepository extends BaseDynamoRepository {
  constructor() {
    super(ENTITY.PROMOTION);
  }

  async getAll(tenantId) {
    return this.queryByTenant(tenantId, {
      sort: (a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')),
    });
  }

  async getActive(tenantId, today) {
    return this.queryByTenant(tenantId, {
      filter: (promo) => isPromotionCurrent(promo, today),
      sort: (a, b) => Number(b.percent || 0) - Number(a.percent || 0),
    });
  }

  async create(tenantId, data) {
    const id = data.id || `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    await this.put(tenantId, id, normalizePayload({ ...data, tenant_id: tenantId }));
    return this.getById(tenantId, id);
  }

  async update(tenantId, id, data) {
    const existing = await super.getById(tenantId, id);
    if (!existing) return null;
    await super.update(tenantId, id, normalizePayload(data, existing));
    return this.getById(tenantId, id);
  }
}

function localToday() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function isPromotionCurrent(promo, today = localToday()) {
  if (!promo || promo.active === false) return false;
  const start = String(promo.start_date || '');
  const end = String(promo.end_date || '');
  if (!start || !end) return false;
  return today >= start && today <= end;
}

module.exports = new PromotionDynamoRepository();
module.exports.isPromotionCurrent = isPromotionCurrent;
module.exports.localToday = localToday;
module.exports.APPLIES_TO = APPLIES_TO;
