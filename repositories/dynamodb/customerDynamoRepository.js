const BaseDynamoRepository = require('./baseDynamoRepository');
const ENTITY = require('../entityTypes');
const { memberPhoneKey, DEFAULT_COUNTRY_CODE } = require('../../utils/phone');

const normalizeIdCard = (value) => String(value || '').trim().toUpperCase();
const normalizePhoneDisplay = (value) => String(value || '').trim();

class CustomerDynamoRepository extends BaseDynamoRepository {
  constructor() {
    super(ENTITY.CUSTOMER);
  }

  async getAll(tenantId) {
    return this.queryByTenant(tenantId, {
      sort: (a, b) => (a.name || '').localeCompare(b.name || ''),
    });
  }

  async getByIdCardNo(tenantId, idCardNo, exceptId = null) {
    const normalized = normalizeIdCard(idCardNo);
    if (!normalized) return null;
    const all = await this.queryByTenant(tenantId);
    return (
      all.find(
        (c) =>
          normalizeIdCard(c.id_card_no) === normalized &&
          (exceptId == null || String(c.id) !== String(exceptId))
      ) || null
    );
  }

  async getByPhone(tenantId, phone, exceptId = null, countryCode = DEFAULT_COUNTRY_CODE) {
    const key = memberPhoneKey(phone, countryCode);
    if (!key) return null;
    const all = await this.queryByTenant(tenantId);
    return (
      all.find(
        (c) =>
          memberPhoneKey(c.phone, countryCode) === key &&
          (exceptId == null || String(c.id) !== String(exceptId))
      ) || null
    );
  }

  async search(tenantId, term, countryCode = DEFAULT_COUNTRY_CODE) {
    const raw = String(term || '').trim();
    const lower = raw.toLowerCase();
    const phoneKey = memberPhoneKey(raw, countryCode);
    return this.queryByTenant(tenantId, {
      filter: (c) =>
        (c.name || '').toLowerCase().includes(lower) ||
        (c.phone || '').includes(raw) ||
        (phoneKey && memberPhoneKey(c.phone, countryCode) === phoneKey) ||
        (c.email || '').toLowerCase().includes(lower) ||
        (c.id_card_no || '').toLowerCase().includes(lower),
      sort: (a, b) => (a.name || '').localeCompare(b.name || ''),
    });
  }

  async create(tenantId, data) {
    const id = data.id || `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    await this.put(tenantId, id, {
      name: String(data.name || '').trim(),
      phone: normalizePhoneDisplay(data.phone),
      id_card_no: normalizeIdCard(data.idCardNo ?? data.id_card_no) || '',
      email: data.email ? String(data.email).trim() : null,
      address: data.address ? String(data.address).trim() : '',
      id_image_path: data.idImagePath ?? data.id_image_path ?? null,
      tenant_id: tenantId,
    });
    return this.getById(tenantId, id);
  }

  async update(tenantId, id, data) {
    const existing = await this.getById(tenantId, id);
    if (!existing) return null;
    return super.update(tenantId, id, {
      name: data.name != null ? String(data.name).trim() : existing.name,
      phone: data.phone != null ? normalizePhoneDisplay(data.phone) : existing.phone,
      id_card_no:
        data.idCardNo != null || data.id_card_no != null
          ? normalizeIdCard(data.idCardNo ?? data.id_card_no)
          : existing.id_card_no,
      email: data.email !== undefined ? (data.email ? String(data.email).trim() : null) : existing.email,
      address: data.address != null ? String(data.address).trim() : existing.address,
    });
  }
}

module.exports = new CustomerDynamoRepository();
