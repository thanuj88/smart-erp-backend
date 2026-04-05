const db = require('../config/db');

class Item {
  static getAll() {
    return db.prepare(`
      SELECT items.*, categories.name as category_name, categories.icon as category_icon 
      FROM items 
      LEFT JOIN categories ON items.category_id = categories.id 
      ORDER BY items.name
    `).all();
  }

  static getById(id) {
    return db.prepare(`
      SELECT items.*, categories.name as category_name, categories.icon as category_icon 
      FROM items 
      LEFT JOIN categories ON items.category_id = categories.id 
      WHERE items.id = ?
    `).get(id);
  }

  static getAvailable() {
    return db.prepare(`
      SELECT items.*, categories.name as category_name, categories.icon as category_icon 
      FROM items 
      LEFT JOIN categories ON items.category_id = categories.id 
      WHERE items.quantity > 0 
      ORDER BY items.name
    `).all();
  }

  static getByCategory(categoryId) {
    return db.prepare(`
      SELECT items.*, categories.name as category_name, categories.icon as category_icon 
      FROM items 
      LEFT JOIN categories ON items.category_id = categories.id 
      WHERE items.category_id = ? AND items.quantity > 0 
      ORDER BY items.name
    `).all(categoryId);
  }

  static create(name, description, buyingPrice, sellingPrice, price, quantity, category, categoryId) {
    const result = db.prepare(`
      INSERT INTO items (name, description, buying_price, selling_price, price, quantity, category, category_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, description, buyingPrice || 0, sellingPrice, price, quantity, category, categoryId || null);
    return result.lastInsertRowid;
  }

  static update(id, name, description, buyingPrice, sellingPrice, price, quantity, category, categoryId) {
    return db.prepare(`
      UPDATE items 
      SET name = ?, description = ?, buying_price = ?, selling_price = ?, price = ?, quantity = ?, category = ?, category_id = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(name, description, buyingPrice || 0, sellingPrice, price, quantity, category, categoryId || null, id);
  }

  static updateQuantity(id, quantity) {
    return db.prepare('UPDATE items SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(quantity, id);
  }

  static decrementQuantity(id, amount) {
    return db.prepare('UPDATE items SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND quantity >= ?').run(amount, id, amount);
  }

  static delete(id) {
    return db.prepare('DELETE FROM items WHERE id = ?').run(id);
  }

  static searchByName(searchTerm) {
    return db.prepare(`
      SELECT items.*, categories.name as category_name, categories.icon as category_icon 
      FROM items 
      LEFT JOIN categories ON items.category_id = categories.id 
      WHERE items.name LIKE ? 
      ORDER BY items.name
    `).all(`%${searchTerm}%`);
  }
}

module.exports = Item;
