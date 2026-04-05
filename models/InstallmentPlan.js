const db = require('../config/db');

class InstallmentPlan {
  static getAll() {
    return db.prepare(`
      SELECT ip.*, c.name as customer_name, c.phone as customer_phone,
             w.name as witness_name
      FROM installment_plans ip
      JOIN customers c ON ip.customer_id = c.id
      JOIN witnesses w ON ip.witness_id = w.id
      ORDER BY ip.created_at DESC
    `).all();
  }

  static getById(id) {
    return db.prepare(`
      SELECT ip.*, c.name as customer_name, c.phone as customer_phone, c.id_card_no as customer_id_card,
             w.name as witness_name, w.phone as witness_phone
      FROM installment_plans ip
      JOIN customers c ON ip.customer_id = c.id
      JOIN witnesses w ON ip.witness_id = w.id
      WHERE ip.id = ?
    `).get(id);
  }

  static getBySaleId(saleId) {
    return db.prepare(`
      SELECT ip.*, c.name as customer_name, c.phone as customer_phone,
             w.name as witness_name
      FROM installment_plans ip
      JOIN customers c ON ip.customer_id = c.id
      JOIN witnesses w ON ip.witness_id = w.id
      WHERE ip.sale_id = ?
    `).get(saleId);
  }

  static getByCustomerId(customerId) {
    return db.prepare(`
      SELECT ip.*, c.name as customer_name, c.phone as customer_phone
      FROM installment_plans ip
      JOIN customers c ON ip.customer_id = c.id
      WHERE ip.customer_id = ?
      ORDER BY ip.created_at DESC
    `).all(customerId);
  }

  static getActive() {
    return db.prepare(`
      SELECT ip.*, c.name as customer_name, c.phone as customer_phone
      FROM installment_plans ip
      JOIN customers c ON ip.customer_id = c.id
      WHERE ip.status = 'active'
      ORDER BY ip.created_at DESC
    `).all();
  }

  static getCompleted() {
    return db.prepare(`
      SELECT ip.*, c.name as customer_name, c.phone as customer_phone
      FROM installment_plans ip
      JOIN customers c ON ip.customer_id = c.id
      WHERE ip.status = 'completed'
      ORDER BY ip.created_at DESC
    `).all();
  }

  static create(data) {
    const result = db.prepare(`
      INSERT INTO installment_plans (
        sale_id, customer_id, witness_id, total_amount, down_payment,
        remaining_amount, interest_rate, interest_amount, total_with_interest,
        installment_months, monthly_payment
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.saleId,
      data.customerId,
      data.witnessId,
      data.totalAmount,
      data.downPayment,
      data.remainingAmount,
      data.interestRate,
      data.interestAmount,
      data.totalWithInterest,
      data.installmentMonths,
      data.monthlyPayment
    );
    return result.lastInsertRowid;
  }

  static updatePaidAmount(id, paidAmount) {
    const plan = this.getById(id);
    const newPaidAmount = plan.paid_amount + paidAmount;
    const status = newPaidAmount >= plan.total_with_interest ? 'completed' : 'active';
    
    return db.prepare(`
      UPDATE installment_plans 
      SET paid_amount = ?, status = ?
      WHERE id = ?
    `).run(newPaidAmount, status, id);
  }

  static updateStatus(id, status) {
    return db.prepare(`
      UPDATE installment_plans 
      SET status = ?
      WHERE id = ?
    `).run(status, id);
  }
}

module.exports = InstallmentPlan;
