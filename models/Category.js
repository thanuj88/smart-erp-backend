const db = require('../config/db');

class Category {
  static getAll() {
    return db.prepare('SELECT * FROM categories ORDER BY name').all();
  }

  static getById(id) {
    return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  }

  static create(name, description, icon) {
    const result = db.prepare(`
      INSERT INTO categories (name, description, icon) 
      VALUES (?, ?, ?)
    `).run(name, description || null, icon || null);
    return result.lastInsertRowid;
  }

  static update(id, name, description, icon) {
    return db.prepare(`
      UPDATE categories 
      SET name = ?, description = ?, icon = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(name, description || null, icon || null, id);
  }

  static delete(id) {
    return db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  }

  static searchByName(searchTerm) {
    return db.prepare('SELECT * FROM categories WHERE name LIKE ? ORDER BY name').all(`%${searchTerm}%`);
  }

  static getItemsCountByCategory(categoryId) {
    return db.prepare('SELECT COUNT(*) as count FROM items WHERE category_id = ?').get(categoryId);
  }
}

module.exports = Category;
