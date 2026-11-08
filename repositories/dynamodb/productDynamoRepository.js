const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
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
      return_quantity: Number(data.returnQuantity ?? data.return_quantity ?? 0) || 0,
      barcode: data.barcode || '',
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
      // return_quantity is deliberately not written here. Returns add to it and
      // releaseReturnQuantity moves units out of it, each as one atomic update.
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

  _key(tenantId, id) {
    return { PK: this.pk(tenantId), SK: this.sk(id) };
  }

  _positiveInt(amount) {
    const n = Number(amount);
    if (!Number.isInteger(n) || n < 1) {
      throw Object.assign(new Error('Quantity must be a whole number of at least 1'), { status: 400 });
    }
    return n;
  }

  // Stock moves are single conditional updates, never read-then-write.
  async decrementQuantity(tenantId, id, amount) {
    const qty = this._positiveInt(amount);
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: this._key(tenantId, id),
          UpdateExpression: 'SET quantity = quantity - :q, updatedAt = :now',
          ConditionExpression: 'attribute_exists(PK) AND quantity >= :q',
          ExpressionAttributeValues: { ':q': qty, ':now': new Date().toISOString() },
        })
      );
    } catch (error) {
      if (error.name !== 'ConditionalCheckFailedException') throw error;
      throw Object.assign(new Error('Insufficient stock'), { status: 400 });
    }
    return true;
  }

  async incrementQuantity(tenantId, id, amount) {
    const qty = this._positiveInt(amount);
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: this._key(tenantId, id),
          UpdateExpression: 'SET quantity = if_not_exists(quantity, :zero) + :q, updatedAt = :now',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeValues: { ':q': qty, ':zero': 0, ':now': new Date().toISOString() },
        })
      );
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') return false;
      throw error;
    }
    return true;
  }

  async incrementReturnQuantity(tenantId, id, amount) {
    const qty = this._positiveInt(amount);
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: this._key(tenantId, id),
          UpdateExpression: 'SET return_quantity = if_not_exists(return_quantity, :zero) + :q, updatedAt = :now',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeValues: { ':q': qty, ':zero': 0, ':now': new Date().toISOString() },
        })
      );
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') return false;
      throw error;
    }
    return true;
  }

  /**
   * Moves units from return stock back onto the sellable floor in one write.
   * floor += n and return_quantity -= n happen together, only if return stock holds n.
   */
  async releaseReturnQuantity(tenantId, id, amount) {
    const qty = this._positiveInt(amount);
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: this._key(tenantId, id),
          UpdateExpression:
            'SET quantity = if_not_exists(quantity, :zero) + :q, return_quantity = return_quantity - :q, updatedAt = :now',
          ConditionExpression: 'attribute_exists(PK) AND return_quantity >= :q',
          ExpressionAttributeValues: { ':q': qty, ':zero': 0, ':now': new Date().toISOString() },
        })
      );
    } catch (error) {
      if (error.name !== 'ConditionalCheckFailedException') throw error;
      const item = await super.getById(tenantId, id);
      if (!item) throw Object.assign(new Error('Item not found'), { status: 404 });
      throw Object.assign(new Error(`Only ${item.return_quantity ?? 0} in return stock`), {
        status: 400,
        available: item.return_quantity ?? 0,
      });
    }
    return this.getById(tenantId, id);
  }

  async getItemsCountByCategory(tenantId, categoryId) {
    const items = await this.getByCategory(tenantId, categoryId);
    return { count: items.length };
  }
}

module.exports = new ProductDynamoRepository();
