const db = require('../config/db');

class InstallmentPayment {
  static getAll() {
    return db.prepare('SELECT * FROM installment_payments ORDER BY due_date').all();
  }

  static getById(id) {
    return db.prepare('SELECT * FROM installment_payments WHERE id = ?').get(id);
  }

  static getByPlanId(planId) {
    return db.prepare(`
      SELECT * FROM installment_payments 
      WHERE installment_plan_id = ? 
      ORDER BY payment_number
    `).all(planId);
  }

  static getPending() {
    return db.prepare(`
      SELECT ip.*, ipl.customer_id, c.name as customer_name, c.phone as customer_phone
      FROM installment_payments ip
      JOIN installment_plans ipl ON ip.installment_plan_id = ipl.id
      JOIN customers c ON ipl.customer_id = c.id
      WHERE ip.status = 'pending'
      ORDER BY ip.due_date
    `).all();
  }

  static getOverdue() {
    return db.prepare(`
      SELECT ip.*, ipl.customer_id, c.name as customer_name, c.phone as customer_phone
      FROM installment_payments ip
      JOIN installment_plans ipl ON ip.installment_plan_id = ipl.id
      JOIN customers c ON ipl.customer_id = c.id
      WHERE ip.status = 'overdue' OR (ip.status = 'pending' AND DATE(ip.due_date) < DATE('now'))
      ORDER BY ip.due_date
    `).all();
  }

  static create(planId, paymentNumber, amountDue, dueDate) {
    const result = db.prepare(`
      INSERT INTO installment_payments (installment_plan_id, payment_number, amount_due, due_date)
      VALUES (?, ?, ?, ?)
    `).run(planId, paymentNumber, amountDue, dueDate);
    return result.lastInsertRowid;
  }

  static recordPayment(id, amountPaid, notes) {
    const payment = this.getById(id);
    const totalPaid = payment.amount_paid + amountPaid;
    const status = totalPaid >= payment.amount_due ? 'paid' : 'pending';
    
    return db.prepare(`
      UPDATE installment_payments 
      SET amount_paid = ?, status = ?, paid_date = CURRENT_TIMESTAMP, notes = ?
      WHERE id = ?
    `).run(totalPaid, status, notes || null, id);
  }

  static updateStatus(id, status) {
    return db.prepare(`
      UPDATE installment_payments 
      SET status = ?
      WHERE id = ?
    `).run(status, id);
  }

  static markOverdue() {
    return db.prepare(`
      UPDATE installment_payments 
      SET status = 'overdue'
      WHERE status = 'pending' AND DATE(due_date) < DATE('now')
    `).run();
  }
}

module.exports = InstallmentPayment;
