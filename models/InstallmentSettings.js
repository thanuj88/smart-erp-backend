const db = require('../config/db');

class InstallmentSettings {
  static getAll() {
    return db.prepare('SELECT * FROM installment_settings ORDER BY months').all();
  }

  static getByMonths(months) {
    return db.prepare('SELECT * FROM installment_settings WHERE months = ?').get(months);
  }

  static update(months, interestRate) {
    return db.prepare(`
      UPDATE installment_settings 
      SET interest_rate = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE months = ?
    `).run(interestRate, months);
  }

  static createOrUpdate(months, interestRate) {
    const existing = this.getByMonths(months);
    if (existing) {
      return this.update(months, interestRate);
    } else {
      return db.prepare(`
        INSERT INTO installment_settings (months, interest_rate) 
        VALUES (?, ?)
      `).run(months, interestRate);
    }
  }

  static delete(months) {
    return db.prepare('DELETE FROM installment_settings WHERE months = ?').run(months);
  }
}

module.exports = InstallmentSettings;
