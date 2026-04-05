const Sale = require('../models/Sale');
const Item = require('../models/Item');
const db = require('../config/db');

// Process a sale
const processSale = (req, res) => {
  try {
    const { itemId, quantity } = req.body;

    if (!itemId || !quantity || quantity <= 0) {
      return res.status(400).json({ error: 'Valid itemId and quantity are required' });
    }

    const item = Item.getById(itemId);

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    if (item.quantity < quantity) {
      return res.status(400).json({ 
        error: 'Insufficient stock', 
        available: item.quantity 
      });
    }

    // Use transaction
    const transaction = db.transaction(() => {
      // Calculate total
      const total = item.price * quantity;

      // Create sale record
      const saleId = Sale.create(
        item.id,
        item.name,
        quantity,
        item.price,
        total,
        req.user.id,
        req.user.username
      );

      // Deduct quantity from item
      Item.decrementQuantity(item.id, quantity);

      return Sale.getById(saleId);
    });

    const sale = transaction();

    res.status(201).json(sale);
  } catch (error) {
    console.error('Process sale error:', error);
    res.status(500).json({ error: 'Server error during sale processing' });
  }
};

// Get all sales (Admin only)
const getAllSales = (req, res) => {
  try {
    const sales = Sale.getAll();
    res.json(sales);
  } catch (error) {
    console.error('Get sales error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get today's sales
const getTodaySales = (req, res) => {
  try {
    let sales;
    
    if (req.user.role === 'admin') {
      sales = Sale.getToday();
    } else {
      sales = Sale.getTellerToday(req.user.id);
    }

    res.json(sales);
  } catch (error) {
    console.error('Get today sales error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get sales by date range (Admin only)
const getSalesByDateRange = (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start and end dates are required' });
    }

    const sales = Sale.getByDateRange(startDate, endDate);
    res.json(sales);
  } catch (error) {
    console.error('Get sales by date range error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get daily summary
const getDailySummary = (req, res) => {
  try {
    let summary;

    if (req.user.role === 'admin') {
      summary = Sale.getDailySummary();
    } else {
      summary = Sale.getTellerDailySummary(req.user.id);
    }

    res.json(summary || {
      date: new Date().toISOString().split('T')[0],
      total_sales: 0,
      total_revenue: 0,
      total_items_sold: 0
    });
  } catch (error) {
    console.error('Get daily summary error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get weekly summary
const getWeeklySummary = (req, res) => {
  try {
    let summary;

    if (req.user.role === 'admin') {
      summary = Sale.getWeeklySummary();
    } else {
      summary = Sale.getTellerWeeklySummary(req.user.id);
    }

    res.json(summary || {
      total_sales: 0,
      total_revenue: 0,
      total_items_sold: 0
    });
  } catch (error) {
    console.error('Get weekly summary error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get monthly summary
const getMonthlySummary = (req, res) => {
  try {
    let summary;

    if (req.user.role === 'admin') {
      summary = Sale.getMonthlySummary();
    } else {
      summary = Sale.getTellerMonthlySummary(req.user.id);
    }

    res.json(summary || {
      total_sales: 0,
      total_revenue: 0,
      total_items_sold: 0
    });
  } catch (error) {
    console.error('Get monthly summary error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get overall summary (Admin only)
const getOverallSummary = (req, res) => {
  try {
    const summary = Sale.getOverallSummary();
    res.json(summary || {
      total_sales: 0,
      total_revenue: 0,
      total_items_sold: 0
    });
  } catch (error) {
    console.error('Get overall summary error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  processSale,
  getAllSales,
  getTodaySales,
  getSalesByDateRange,
  getDailySummary,
  getWeeklySummary,
  getMonthlySummary,
  getOverallSummary
};
