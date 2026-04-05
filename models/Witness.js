const db = require('../config/db');

class Witness {
  static getAll() {
    return db.prepare('SELECT * FROM witnesses ORDER BY name').all();
  }

  static getById(id) {
    return db.prepare('SELECT * FROM witnesses WHERE id = ?').get(id);
  }

  static create(name, phone, idCardNo, address, idImagePath) {
    const result = db.prepare(`
      INSERT INTO witnesses (name, phone, id_card_no, address, id_image_path) 
      VALUES (?, ?, ?, ?, ?)
    `).run(name, phone, idCardNo, address, idImagePath || null);
    return result.lastInsertRowid;
  }

  static update(id, name, phone, idCardNo, address, idImagePath) {
    return db.prepare(`
      UPDATE witnesses 
      SET name = ?, phone = ?, id_card_no = ?, address = ?, id_image_path = ?
      WHERE id = ?
    `).run(name, phone, idCardNo, address, idImagePath || null, id);
  }

  static delete(id) {
    return db.prepare('DELETE FROM witnesses WHERE id = ?').run(id);
  }
}

module.exports = Witness;
