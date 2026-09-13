const { getOrderRepository } = require('../repositories/factory');
const { isAdminUser } = require('../middleware/auth');

class OrderService {
  constructor(repo = getOrderRepository()) {
    this.repo = repo;
  }

  getAll(tenantId) {
    return this.repo.getAll(tenantId);
  }

  getToday(tenantId, user) {
    return this.repo.getToday(tenantId, user.id, isAdminUser(user));
  }

  getByDateRange(tenantId, startDate, endDate) {
    return this.repo.getByDateRange(tenantId, startDate, endDate);
  }

  processCashSale(tenantId, user, payload) {
    return this.repo.processCashSale(tenantId, user, payload);
  }

  processInstallmentSale(tenantId, user, payload, saveImage) {
    return this.repo.processInstallmentSale(tenantId, user, payload, saveImage);
  }

  getTopProducts(tenantId, range, limit) {
    return this.repo.getTopProducts(tenantId, range, limit);
  }

  getDailySummary(tenantId, user) {
    return this.repo.getDailySummary(tenantId, user.id, isAdminUser(user));
  }

  getWeeklySummary(tenantId, user) {
    return this.repo.getWeeklySummary(tenantId, user.id, isAdminUser(user));
  }

  getMonthlySummary(tenantId, user) {
    return this.repo.getMonthlySummary(tenantId, user.id, isAdminUser(user));
  }

  getOverallSummary(tenantId) {
    return this.repo.getOverallSummary(tenantId);
  }

  getSummaryByRange(tenantId, range) {
    return this.repo.getSummaryByRange(tenantId, range);
  }

  getSalesTrend(tenantId, range) {
    return this.repo.getSalesTrend(tenantId, range);
  }
}

module.exports = new OrderService();
