const db = require('../config/db');

class User {
  static findById(id) {
    return db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(id);
  }

  static findByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  }

  static getAll() {
    return db.prepare('SELECT id, username, role, created_at FROM users').all();
  }

  static create(username, hashedPassword, role) {
    const result = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username, hashedPassword, role);
    return result.lastInsertRowid;
  }

  static update(id, username, role) {
    return db.prepare('UPDATE users SET username = ?, role = ? WHERE id = ?').run(username, role, id);
  }

  static delete(id) {
    return db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  static updatePassword(id, hashedPassword) {
    return db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, id);
  }
}

module.exports = User;
