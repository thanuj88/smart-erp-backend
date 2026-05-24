const BaseDynamoRepository = require('./baseDynamoRepository');
const ENTITY = require('../entityTypes');
const categoryDynamoRepository = require('./categoryDynamoRepository');

class ProductDynamoRepository extends BaseDynamoRepository {
  constructor() {
    super(ENTITY.PRODUCT);
  }

  async enrichWithCategory(tenantId, product) {
    if (!product) return null;
    if (product.category_name) return product;
    if (product.category_id || product.categoryId) {
      const cat = await categoryDynamoRepository.getById(
        tenantId,
        product.category_id || product.categoryId
      );
      if (cat) {
        product.category_name = cat.name;
        product.category_icon = cat.icon;
      }
    }
    return product;
  }

  async getAll(tenantId) {
    const items = await this.queryByTenant(tenantId);
    return Promise.all(items.map((p) => this.enrichWithCategory(tenantId, p)));
  }

  async getById(tenantId, id) {
    const item = await super.getById(tenantId, id);
    return this.enrichWithCategory(tenantId, item);
  }

  async getAvailable(tenantId) {
    const items = await this.queryByTenant(tenantId, {
      filter: (p) => (p.quantity ?? 0) > 0,
      sort: (a, b) => (a.name || '').localeCompare(b.name || ''),
    });
    return Promise.all(items.map((p) => this.enrichWithCategory(tenantId, p)));
  }

  async getByCategory(tenantId, categoryId) {
    const items = await this.queryByTenant(tenantId, {
      filter: (p) =>
        String(p.category_id || p.categoryId) === String(categoryId) && (p.quantity ?? 0) > 0,
    });
    return Promise.all(items.map((p) => this.enrichWithCategory(tenantId, p)));
  }

  async search(tenantId, term) {
    const lower = term.toLowerCase();
    const items = await this.queryByTenant(tenantId, {
      filter: (p) => (p.name || '').toLowerCase().includes(lower),
    });
    return Promise.all(items.map((p) => this.enrichWithCategory(tenantId, p)));
  }

  _sellingPrice(data, existing) {
    const raw =
      data.sellingPrice ??
      data.selling_price ??
      existing?.selling_price ??
      existing?.price;
    return raw != null && raw !== '' ? Number(raw) : 0;
  }

  async create(tenantId, data) {
    const id = data.id || `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const sellingPrice = this._sellingPrice(data);
    const record = {
      name: data.name,
      description: data.description || '',
      buying_price: data.buyingPrice ?? data.buying_price ?? 0,
      selling_price: sellingPrice,
      price: sellingPrice,
      quantity: data.quantity,
      category: data.category || '',
      category_id: data.categoryId ?? data.category_id ?? null,
      tenant_id: tenantId,
    };
    const imagePath = data.imagePath ?? data.image_path;
    if (imagePath) {
      record.image_path = imagePath;
    }
    await this.put(tenantId, id, record);
    return this.getById(tenantId, id);
  }

  async update(tenantId, id, data) {
    const existing = await super.getById(tenantId, id);
    if (!existing) return null;
    const sellingPrice = this._sellingPrice(data, existing);
    const merged = {
      name: data.name ?? existing.name,
      description: data.description ?? existing.description,
      buying_price: data.buyingPrice ?? data.buying_price ?? existing.buying_price,
      selling_price: sellingPrice,
      price: sellingPrice,
      quantity: data.quantity ?? existing.quantity,
      category: data.category ?? existing.category,
      category_id: data.categoryId ?? data.category_id ?? existing.category_id,
    };
    if (data.imagePath !== undefined || data.image_path !== undefined) {
      merged.image_path = data.imagePath ?? data.image_path ?? null;
    }
    await super.update(tenantId, id, merged);
    return this.getById(tenantId, id);
  }

  async delete(tenantId, id) {
    return super.delete(tenantId, id);
  }

  async decrementQuantity(tenantId, id, amount) {
    const item = await super.getById(tenantId, id);
    if (!item || (item.quantity ?? 0) < amount) {
      throw new Error('Insufficient stock');
    }
    await super.update(tenantId, id, { quantity: item.quantity - amount });
    return true;
  }

  async getItemsCountByCategory(tenantId, categoryId) {
    const items = await this.getByCategory(tenantId, categoryId);
    return { count: items.length };
  }
}

module.exports = new ProductDynamoRepository();
