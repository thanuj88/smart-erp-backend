const path = require('path');
const fs = require('fs');
const orderService = require('../services/orderService');
const customerService = require('../services/customerService');
const { resolveTenantId } = require('../utils/tenant');
const { validateDistinctCustomerAndWitness, validateNicNumbers, normalizeNic } = require('../utils/installmentValidation');

const saveImage = (base64Data, folder, filename) => {
  if (!base64Data) return null;
  const uploadsDir = path.join(__dirname, '../uploads', folder);
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const base64Image = base64Data.split(';base64,').pop();
  const filePath = path.join(uploadsDir, filename);
  fs.writeFileSync(filePath, base64Image, { encoding: 'base64' });
  return `/uploads/${folder}/${filename}`;
};

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
    const { itemId, quantity, orderNumber, customerPhone } = req.body;
    if (!itemId || !quantity || quantity <= 0) {
      return res.status(400).json({ error: 'Valid itemId and quantity are required' });
    }
    const tenantId = resolveTenantId(req);
    const member = customerPhone
      ? await customerService.lookupByPhone(tenantId, customerPhone)
      : null;
    const sale = await orderService.processCashSale(tenantId, req.user, {
      itemId,
      quantity,
      orderNumber,
      customerId: member?.id || null,
      customerName: member?.name || null,
      customerPhone: member?.phone || null,
    });
    res.status(201).json(sale);
  } catch (error) {
    return handleSaleError(res, error);
  }
};

const processInstallmentSale = async (req, res) => {
  try {
    const { itemId, quantity, customer, witness, downPayment, installmentMonths, orderNumber } = req.body;
    const includeWitness = req.body.includeWitness !== false;
    if (!itemId || !quantity || !customer || downPayment === undefined || !installmentMonths) {
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
        itemId,
        quantity,
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
      },
      saveImage
    );
    res.status(201).json(result);
  } catch (error) {
    return handleSaleError(res, error);
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

const processReturn = async (req, res) => {
  try {
    const { orderNumber, lines, reason, returnType } = req.body;
    if (!orderNumber || !Array.isArray(lines) || !lines.length) {
      return res.status(400).json({ error: 'orderNumber and at least one return line are required' });
    }
    const result = await orderService.processReturn(resolveTenantId(req), req.user, {
      orderNumber,
      lines,
      reason,
      returnType,
    });
    res.status(201).json(result);
  } catch (error) {
    return handleSaleError(res, error);
  }
};

module.exports = {
  processCashSale,
  processInstallmentSale,
  getTopProducts,
  getAllSales,
  getTodaySales,
  getRecentSales,
  getSalesByDateRange,
  getDailySummary,
  getWeeklySummary,
  getMonthlySummary,
  getOverallSummary,
  getSummaryByRange,
  getSalesTrend,
  getOrderByNumber,
  listReturns,
  processReturn,
};
