const { getOrderRepository } = require('../repositories/factory');
const { isAdminRole } = require('../middleware/auth');

class OrderService {
  constructor(repo = getOrderRepository()) {
    this.repo = repo;
  }

  getAll(tenantId) {
    return this.repo.getAll(tenantId);
  }

  getToday(tenantId, user) {
    const isAdmin =
      isAdminRole(user.role) ||
      ['TENANT_ADMIN', 'SUPER_ADMIN', 'MANAGER'].includes(String(user.role).toUpperCase());
    return this.repo.getToday(tenantId, user.id, isAdmin);
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
    const isAdmin = isAdminRole(user.role) || user.role === 'admin';
    return this.repo.getDailySummary(tenantId, user.id, isAdmin);
  }

  getWeeklySummary(tenantId, user) {
    const isAdmin = isAdminRole(user.role) || user.role === 'admin';
    return this.repo.getWeeklySummary(tenantId, user.id, isAdmin);
  }

  getMonthlySummary(tenantId, user) {
    const isAdmin = isAdminRole(user.role) || user.role === 'admin';
    return this.repo.getMonthlySummary(tenantId, user.id, isAdmin);
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
