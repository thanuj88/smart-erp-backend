const db = require('../config/db');

class Sale {
  static getAll() {
    return db.prepare('SELECT * FROM sales ORDER BY sale_date DESC').all();
  }

  static getById(id) {
    return db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
  }

  static getByDateRange(startDate, endDate) {
    return db.prepare('SELECT * FROM sales WHERE DATE(sale_date) BETWEEN DATE(?) AND DATE(?) ORDER BY sale_date DESC').all(startDate, endDate);
  }

  static getToday() {
    return db.prepare('SELECT * FROM sales WHERE DATE(sale_date) = DATE("now") ORDER BY sale_date DESC').all();
  }

  static getByTeller(tellerId) {
    return db.prepare('SELECT * FROM sales WHERE teller_id = ? ORDER BY sale_date DESC').all(tellerId);
  }

  static getTellerToday(tellerId) {
    return db.prepare('SELECT * FROM sales WHERE teller_id = ? AND DATE(sale_date) = DATE("now") ORDER BY sale_date DESC').all(tellerId);
  }

  static create(itemId, itemName, quantity, price, total, tellerId, tellerName) {
    const result = db.prepare(`
      INSERT INTO sales (item_id, item_name, quantity, price, total, teller_id, teller_name) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(itemId, itemName, quantity, price, total, tellerId, tellerName);
    return result.lastInsertRowid;
  }

  static getDailySummary() {
    // Get cash sales revenue
    const cashSales = db.prepare(`
      SELECT 
        DATE(sale_date) as date,
        COUNT(*) as total_sales,
        SUM(total) as total_revenue,
        SUM(quantity) as total_items_sold,
        SUM(profit) as total_profit
      FROM sales 
      WHERE DATE(sale_date) = DATE("now")
      GROUP BY DATE(sale_date)
    `).get() || { total_sales: 0, total_revenue: 0, total_items_sold: 0, total_profit: 0 };

    // Get installment down payments for today
    const downPayments = db.prepare(`
      SELECT 
        SUM(down_payment) as down_payment_income
      FROM installment_plans
      WHERE DATE(created_at) = DATE("now")
    `).get() || { down_payment_income: 0 };

    // Get installment payments collected today
    const installmentPayments = db.prepare(`
      SELECT 
        COUNT(*) as payment_count,
        SUM(amount_paid) as installment_income
      FROM installment_payments
      WHERE DATE(paid_date) = DATE("now") AND status = 'paid'
    `).get() || { payment_count: 0, installment_income: 0 };

    return {
      ...cashSales,
      down_payment_income: downPayments.down_payment_income || 0,
      installment_income: installmentPayments.installment_income || 0,
      installment_payment_count: installmentPayments.payment_count || 0,
      total_actual_income: (cashSales.total_revenue || 0) + (downPayments.down_payment_income || 0) + (installmentPayments.installment_income || 0)
    };
  }

  static getTellerDailySummary(tellerId) {
    return db.prepare(`
      SELECT 
        DATE(sale_date) as date,
        COUNT(*) as total_sales,
        SUM(total) as total_revenue,
        SUM(quantity) as total_items_sold,
        SUM(profit) as total_profit
      FROM sales 
      WHERE teller_id = ? AND DATE(sale_date) = DATE("now")
      GROUP BY DATE(sale_date)
    `).get(tellerId);
  }

  static getWeeklySummary() {
    // Get cash sales revenue
    const cashSales = db.prepare(`
      SELECT 
        COUNT(*) as total_sales,
        SUM(total) as total_revenue,
        SUM(quantity) as total_items_sold,
        SUM(profit) as total_profit
      FROM sales 
      WHERE DATE(sale_date) >= DATE('now', '-7 days')
    `).get() || { total_sales: 0, total_revenue: 0, total_items_sold: 0, total_profit: 0 };

    // Get installment down payments for this week
    const downPayments = db.prepare(`
      SELECT 
        SUM(down_payment) as down_payment_income
      FROM installment_plans
      WHERE DATE(created_at) >= DATE('now', '-7 days')
    `).get() || { down_payment_income: 0 };

    // Get installment payments collected this week
    const installmentPayments = db.prepare(`
      SELECT 
        COUNT(*) as payment_count,
        SUM(amount_paid) as installment_income
      FROM installment_payments
      WHERE DATE(paid_date) >= DATE('now', '-7 days') AND status = 'paid'
    `).get() || { payment_count: 0, installment_income: 0 };

    return {
      ...cashSales,
      down_payment_income: downPayments.down_payment_income || 0,
      installment_income: installmentPayments.installment_income || 0,
      installment_payment_count: installmentPayments.payment_count || 0,
      total_actual_income: (cashSales.total_revenue || 0) + (downPayments.down_payment_income || 0) + (installmentPayments.installment_income || 0)
    };
  }

  static getTellerWeeklySummary(tellerId) {
    return db.prepare(`
      SELECT 
        COUNT(*) as total_sales,
        SUM(total) as total_revenue,
        SUM(quantity) as total_items_sold,
        SUM(profit) as total_profit
      FROM sales 
      WHERE teller_id = ? AND DATE(sale_date) >= DATE('now', '-7 days')
    `).get(tellerId);
  }

  static getMonthlySummary() {
    // Get cash sales revenue
    const cashSales = db.prepare(`
      SELECT 
        COUNT(*) as total_sales,
        SUM(total) as total_revenue,
        SUM(quantity) as total_items_sold,
        SUM(profit) as total_profit
      FROM sales 
      WHERE DATE(sale_date) >= DATE('now', 'start of month')
    `).get() || { total_sales: 0, total_revenue: 0, total_items_sold: 0, total_profit: 0 };

    // Get installment down payments for this month
    const downPayments = db.prepare(`
      SELECT 
        SUM(down_payment) as down_payment_income
      FROM installment_plans
      WHERE DATE(created_at) >= DATE('now', 'start of month')
    `).get() || { down_payment_income: 0 };

    // Get installment payments collected this month
    const installmentPayments = db.prepare(`
      SELECT 
        COUNT(*) as payment_count,
        SUM(amount_paid) as installment_income
      FROM installment_payments
      WHERE DATE(paid_date) >= DATE('now', 'start of month') AND status = 'paid'
    `).get() || { payment_count: 0, installment_income: 0 };

    return {
      ...cashSales,
      down_payment_income: downPayments.down_payment_income || 0,
      installment_income: installmentPayments.installment_income || 0,
      installment_payment_count: installmentPayments.payment_count || 0,
      total_actual_income: (cashSales.total_revenue || 0) + (downPayments.down_payment_income || 0) + (installmentPayments.installment_income || 0)
    };
  }

  static getTellerMonthlySummary(tellerId) {
    return db.prepare(`
      SELECT 
        COUNT(*) as total_sales,
        SUM(total) as total_revenue,
        SUM(quantity) as total_items_sold,
        SUM(profit) as total_profit
      FROM sales 
      WHERE teller_id = ? AND DATE(sale_date) >= DATE('now', 'start of month')
    `).get(tellerId);
  }

  static getOverallSummary() {
    return db.prepare(`
      SELECT 
        COUNT(*) as total_sales,
        SUM(total) as total_revenue,
        SUM(quantity) as total_items_sold,
        SUM(profit) as total_profit
      FROM sales
    `).get();
  }
}

module.exports = Sale;
