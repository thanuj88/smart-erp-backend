const path = require('path');
const fs = require('fs');
const orderService = require('../services/orderService');
const { resolveTenantId } = require('../utils/tenant');

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
    const { itemId, quantity } = req.body;
    if (!itemId || !quantity || quantity <= 0) {
      return res.status(400).json({ error: 'Valid itemId and quantity are required' });
    }
    const sale = await orderService.processCashSale(resolveTenantId(req), req.user, { itemId, quantity });
    res.status(201).json(sale);
  } catch (error) {
    return handleSaleError(res, error);
  }
};

const processInstallmentSale = async (req, res) => {
  try {
    const { itemId, quantity, customer, witness, downPayment, installmentMonths } = req.body;
    if (!itemId || !quantity || !customer || !witness || downPayment === undefined || !installmentMonths) {
      return res.status(400).json({ error: 'All fields are required for installment sale' });
    }
    const result = await orderService.processInstallmentSale(
      resolveTenantId(req),
      req.user,
      { itemId, quantity, customer, witness, downPayment, installmentMonths },
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

module.exports = {
  processCashSale,
  processInstallmentSale,
  getTopProducts,
  getAllSales,
  getTodaySales,
  getSalesByDateRange,
  getDailySummary,
  getWeeklySummary,
  getMonthlySummary,
  getOverallSummary,
  getSummaryByRange,
  getSalesTrend,
};
