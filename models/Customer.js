const db = require('../config/db');

class Customer {
  static getAll() {
    return db.prepare('SELECT * FROM customers ORDER BY name').all();
  }

  static getById(id) {
    return db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  }

  static getByIdCardNo(idCardNo) {
    return db.prepare('SELECT * FROM customers WHERE id_card_no = ?').get(idCardNo);
  }

  static create(name, phone, idCardNo, email, address, idImagePath) {
    const result = db.prepare(`
      INSERT INTO customers (name, phone, id_card_no, email, address, id_image_path) 
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, phone, idCardNo, email || null, address, idImagePath || null);
    return result.lastInsertRowid;
  }

  static update(id, name, phone, idCardNo, email, address, idImagePath) {
    return db.prepare(`
      UPDATE customers 
      SET name = ?, phone = ?, id_card_no = ?, email = ?, address = ?, id_image_path = ?
      WHERE id = ?
    `).run(name, phone, idCardNo, email || null, address, idImagePath || null, id);
  }

  static delete(id) {
    return db.prepare('DELETE FROM customers WHERE id = ?').run(id);
  }

  static search(searchTerm) {
    return db.prepare(`
      SELECT * FROM customers 
      WHERE name LIKE ? OR phone LIKE ? OR id_card_no LIKE ?
      ORDER BY name
    `).all(`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`);
  }
}

module.exports = Customer;
