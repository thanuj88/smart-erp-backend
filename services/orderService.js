const { getOrderRepository } = require('../repositories/factory');
const { isAdminUser, canViewReports } = require('../middleware/auth');

/** Store-wide sale lists. Reports viewers are not tenant admins, but these endpoints are store reports. */
function seesStoreSales(user) {
  return isAdminUser(user) || canViewReports(user);
}

class OrderService {
  constructor(repo = getOrderRepository()) {
    this.repo = repo;
  }

  getAll(tenantId) {
    return this.repo.getAll(tenantId);
  }

  getToday(tenantId, user) {
    return this.repo.getToday(tenantId, user.id, seesStoreSales(user));
  }

  getRecent(tenantId, user, days = 7) {
    return this.repo.getRecent(tenantId, user.id, seesStoreSales(user), days);
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
    return this.repo.getDailySummary(tenantId, user.id, seesStoreSales(user));
  }

  getWeeklySummary(tenantId, user) {
    return this.repo.getWeeklySummary(tenantId, user.id, seesStoreSales(user));
  }

  getMonthlySummary(tenantId, user) {
    return this.repo.getMonthlySummary(tenantId, user.id, seesStoreSales(user));
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

  getOrderByNumber(tenantId, orderNumber) {
    return this.repo.getOrderByNumber(tenantId, orderNumber);
  }

  listReturns(tenantId) {
    return this.repo.listReturns(tenantId);
  }

  processReturn(tenantId, user, payload) {
    return this.repo.processReturn(tenantId, user, payload);
  }
}

module.exports = new OrderService();
