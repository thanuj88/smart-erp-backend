const orderService = require('../services/orderService');
const customerService = require('../services/customerService');
const { resolveTenantId } = require('../utils/tenant');
const { parseMineRange } = require('../utils/tellerSales');
const { validateDistinctCustomerAndWitness, validateNicNumbers, normalizeNic } = require('../utils/installmentValidation');
const { parseInstallmentLines } = require('../utils/installmentLines');
const { parseCashSaleBody } = require('../utils/cashSaleLines');
const { buildDiscountReport } = require('../utils/discountPolicy');
const { buildRefundReport } = require('../utils/refundPolicy');
const { authorizeReturn } = require('../services/refundApprovalService');

const handleSaleError = (res, error) => {
  if (error.status) {
    return res.status(error.status).json({
      error: error.message,
      ...(error.available !== undefined ? { available: error.available } : {}),
    });
  }
  console.error('Sale error:', error);
  return res.status(500).json({ error: 'Server error' });
};

const processCashSale = async (req, res) => {
  try {
    const { orderNumber, customerPhone } = req.body;
    const { lines, idempotencyKey } = parseCashSaleBody(req.body);
    const tenantId = resolveTenantId(req);
    const member = customerPhone
      ? await customerService.lookupByPhone(tenantId, customerPhone)
      : null;
    const sale = await orderService.processCashSale(tenantId, req.user, {
      lines,
      orderNumber,
      idempotencyKey,
      customerId: member?.id || null,
      customerName: member?.name || null,
      customerPhone: member?.phone || null,
      shipping: req.body.shipping,
      shippingPercent: req.body.shippingPercent,
      discount: req.body.discount,
      discountPercent: req.body.discountPercent,
      discountReason: req.body.discountReason,
      managerPin: req.body.managerPin,
    });
    res.status(sale.replayed ? 200 : 201).json(sale);
  } catch (error) {
    return handleSaleError(res, error);
  }
};

const processInstallmentSale = async (req, res) => {
  try {
    const { customer, witness, downPayment, installmentMonths, orderNumber } = req.body;
    const includeWitness = req.body.includeWitness !== false;
    const lines = parseInstallmentLines(req.body);
    if (!customer || downPayment === undefined || !installmentMonths) {
      return res.status(400).json({ error: 'All fields are required for installment sale' });
    }
    if (!String(customer.phone || '').trim()) {
      return res.status(400).json({ error: 'Customer phone number is required' });
    }
    if (includeWitness && (!witness || typeof witness !== 'object')) {
      return res.status(400).json({ error: 'Witness details are required' });
    }
    const nicError = validateNicNumbers(customer, witness, { requireWitness: includeWitness });
    if (nicError) {
      return res.status(400).json({ error: nicError });
    }
    if (includeWitness) {
      const witnessError = validateDistinctCustomerAndWitness(customer, witness);
      if (witnessError) {
        return res.status(400).json({ error: witnessError });
      }
    }
    const tenantId = resolveTenantId(req);
    const member = await customerService.lookupByPhone(tenantId, customer.phone);
    const result = await orderService.processInstallmentSale(
      tenantId,
      req.user,
      {
        lines,
        customer: {
          ...customer,
          idCardNo: normalizeNic(customer.idCardNo ?? customer.id_card_no),
          memberId: member?.id || null,
        },
        witness: includeWitness
          ? { ...witness, idCardNo: normalizeNic(witness.idCardNo ?? witness.id_card_no) }
          : null,
        includeWitness,
        downPayment,
        installmentMonths,
        orderNumber,
        shipping: req.body.shipping,
        shippingPercent: req.body.shippingPercent,
        discount: req.body.discount,
        discountPercent: req.body.discountPercent,
        discountReason: req.body.discountReason,
        managerPin: req.body.managerPin,
      }
    );
    res.status(201).json(result);
  } catch (error) {
    return handleSaleError(res, error);
  }
};

const getDiscountReport = async (req, res) => {
  try {
    const sales = await orderService.getAll(resolveTenantId(req));
    const report = buildDiscountReport(sales, { from: req.query.from, to: req.query.to });
    if (report.error) return res.status(400).json({ error: report.error });
    res.json(report);
  } catch (error) {
    console.error('Discount report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const getTopProducts = async (req, res) => {
  try {
    const range = req.query.range || 'week';
    const limit = Number(req.query.limit) || 6;
    const top = await orderService.getTopProducts(resolveTenantId(req), range, limit);
    res.json(top);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const getAllSales = async (req, res) => {
  try {
    const sales = await orderService.getAll(resolveTenantId(req));
    res.json(sales);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const getTodaySales = async (req, res) => {
  try {
    const sales = await orderService.getToday(resolveTenantId(req), req.user);
    res.json(sales);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const getRecentSales = async (req, res) => {
  try {
    const days = Number(req.query.days) || 7;
    const sales = await orderService.getRecent(resolveTenantId(req), req.user, days);
    res.json(sales);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const getMySales = async (req, res) => {
  try {
    const range = parseMineRange(req.query.from, req.query.to);
    if (!range.ok) return res.status(400).json({ error: range.error });
    const sales = await orderService.getMine(resolveTenantId(req), req.user.id, range);
    res.json(sales);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const getSalesByDateRange = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start and end dates are required' });
    }
    const sales = await orderService.getByDateRange(resolveTenantId(req), startDate, endDate);
    res.json(sales);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const getDailySummary = async (req, res) => {
  try {
    const summary = await orderService.getDailySummary(resolveTenantId(req), req.user);
    res.json(
      summary || {
        date: new Date().toISOString().split('T')[0],
        total_sales: 0,
        total_revenue: 0,
        total_profit: 0,
        total_items_sold: 0,
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const getWeeklySummary = async (req, res) => {
  try {
    const summary = await orderService.getWeeklySummary(resolveTenantId(req), req.user);
    res.json(summary || { total_sales: 0, total_revenue: 0, total_profit: 0, total_items_sold: 0 });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const getMonthlySummary = async (req, res) => {
  try {
    const summary = await orderService.getMonthlySummary(resolveTenantId(req), req.user);
    res.json(summary || { total_sales: 0, total_revenue: 0, total_profit: 0, total_items_sold: 0 });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const getOverallSummary = async (req, res) => {
  try {
    const summary = await orderService.getOverallSummary(resolveTenantId(req));
    res.json(summary || { total_sales: 0, total_revenue: 0, total_profit: 0, total_items_sold: 0 });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const getSummaryByRange = async (req, res) => {
  try {
    const range = (req.query.range || '1Y').toUpperCase();
    const summary = await orderService.getSummaryByRange(resolveTenantId(req), range);
    res.json(
      summary || {
        total_sales: 0,
        total_revenue: 0,
        total_purchase: 0,
        total_profit: 0,
        total_items_sold: 0,
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const getSalesTrend = async (req, res) => {
  try {
    const range = (req.query.range || '1Y').toUpperCase();
    const trend = await orderService.getSalesTrend(resolveTenantId(req), range);
    res.json(trend);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const getOrderByNumber = async (req, res) => {
  try {
    const order = await orderService.getOrderByNumber(resolveTenantId(req), req.params.orderNumber);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (error) {
    return handleSaleError(res, error);
  }
};

const listReturns = async (req, res) => {
  try {
    const returns = await orderService.listReturns(resolveTenantId(req));
    res.json(returns);
  } catch (error) {
    return handleSaleError(res, error);
  }
};

const getRefundReport = async (req, res) => {
  try {
    const returns = await orderService.listReturns(resolveTenantId(req));
    const report = buildRefundReport(returns, { from: req.query.from, to: req.query.to });
    if (report.error) return res.status(400).json({ error: report.error });
    res.json(report);
  } catch (error) {
    console.error('Refund report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const processReturn = async (req, res) => {
  try {
    const { orderNumber, lines, reason, returnType, managerPin, salesReceiptId, warrantyMonths } = req.body;
    if (!orderNumber || !Array.isArray(lines) || !lines.length) {
      return res.status(400).json({ error: 'orderNumber and at least one return line are required' });
    }
    const tenantId = resolveTenantId(req);
    const decision = await authorizeReturn({
      tenantId,
      user: req.user,
      orderNumber,
      lines,
      reason,
      returnType,
      managerPin,
      salesReceiptId,
      warrantyMonths,
    });
    const result = await orderService.processReturn(tenantId, req.user, {
      orderNumber,
      lines,
      reason: decision.reason,
      returnType: decision.returnType,
      approval: {
        approvedBy: decision.approverId,
        approverName: decision.approverName,
        warrantyMonths: decision.warrantyMonths,
        salesReceiptId: decision.salesReceiptId,
      },
    });
    res.status(201).json(result);
  } catch (error) {
    return handleSaleError(res, error);
  }
};

module.exports = {
  processCashSale,
  processInstallmentSale,
  getDiscountReport,
  getTopProducts,
  getAllSales,
  getTodaySales,
  getRecentSales,
  getMySales,
  getSalesByDateRange,
  getDailySummary,
  getWeeklySummary,
  getMonthlySummary,
  getOverallSummary,
  getSummaryByRange,
  getSalesTrend,
  getOrderByNumber,
  listReturns,
  getRefundReport,
  processReturn,
};
