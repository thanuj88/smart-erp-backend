const Sale = require('../models/Sale');
const Item = require('../models/Item');
const Customer = require('../models/Customer');
const Witness = require('../models/Witness');
const InstallmentPlan = require('../models/InstallmentPlan');
const InstallmentPayment = require('../models/InstallmentPayment');
const InstallmentSettings = require('../models/InstallmentSettings');
const db = require('../config/db');
const path = require('path');
const fs = require('fs');

// Save uploaded image
const saveImage = (base64Data, folder, filename) => {
  if (!base64Data) return null;
  
  const uploadsDir = path.join(__dirname, '../uploads', folder);
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const base64Image = base64Data.split(';base64,').pop();
  const filePath = path.join(uploadsDir, filename);
  fs.writeFileSync(filePath, base64Image, { encoding: 'base64' });
  
  return `/uploads/${folder}/${filename}`;
};

// Process a cash sale
const processCashSale = (req, res) => {
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
      // Calculate total and profit
      const total = item.selling_price * quantity;
      const profit = (item.selling_price - item.buying_price) * quantity;

      // Create sale record
      const saleId = db.prepare(`
        INSERT INTO sales (item_id, item_name, quantity, buying_price, selling_price, price, 
                          total, profit, payment_type, teller_id, teller_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        item.id,
        item.name,
        quantity,
        item.buying_price,
        item.selling_price,
        item.price,
        total,
        profit,
        'cash',
        req.user.id,
        req.user.username
      ).lastInsertRowid;

      // Deduct quantity from item
      Item.decrementQuantity(item.id, quantity);

      return db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
    });

    const sale = transaction();

    res.status(201).json(sale);
  } catch (error) {
    console.error('Process cash sale error:', error);
    res.status(500).json({ error: 'Server error during sale processing' });
  }
};

// Process an installment sale
const processInstallmentSale = (req, res) => {
  try {
    const { 
      itemId, 
      quantity, 
      customer,
      witness,
      downPayment,
      installmentMonths
    } = req.body;

    // Validate required fields
    if (!itemId || !quantity || !customer || !witness || !downPayment || !installmentMonths) {
      return res.status(400).json({ error: 'All fields are required for installment sale' });
    }

    if (!customer.name || !customer.phone || !customer.idCardNo || !customer.address) {
      return res.status(400).json({ error: 'Complete customer details are required' });
    }

    if (!witness.name || !witness.phone || !witness.idCardNo || !witness.address) {
      return res.status(400).json({ error: 'Complete witness details are required' });
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

    const totalAmount = item.selling_price * quantity;

    if (downPayment >= totalAmount) {
      return res.status(400).json({ error: 'Down payment must be less than total amount' });
    }

    // Get interest rate
    const settings = InstallmentSettings.getByMonths(installmentMonths);
    if (!settings) {
      return res.status(400).json({ error: 'Invalid installment months' });
    }

    // Calculate installment details
    const remainingAmount = totalAmount - downPayment;
    const interestAmount = (remainingAmount * settings.interest_rate) / 100;
    const totalWithInterest = remainingAmount + interestAmount;
    const monthlyPayment = totalWithInterest / installmentMonths;
    const profit = (item.selling_price - item.buying_price) * quantity;

    // Use transaction for all operations
    const transaction = db.transaction(() => {
      // Save customer images
      let customerIdImage = null;
      if (customer.idImage) {
        const customerFilename = `customer_${Date.now()}_${customer.idCardNo}.jpg`;
        customerIdImage = saveImage(customer.idImage, 'customers', customerFilename);
      }

      // Create or get customer
      let existingCustomer = Customer.getByIdCardNo(customer.idCardNo);
      let customerId;
      
      if (existingCustomer) {
        customerId = existingCustomer.id;
      } else {
        customerId = Customer.create(
          customer.name,
          customer.phone,
          customer.idCardNo,
          customer.email,
          customer.address,
          customerIdImage
        );
      }

      // Save witness images
      let witnessIdImage = null;
      if (witness.idImage) {
        const witnessFilename = `witness_${Date.now()}_${witness.idCardNo}.jpg`;
        witnessIdImage = saveImage(witness.idImage, 'witnesses', witnessFilename);
      }

      // Create witness
      const witnessId = Witness.create(
        witness.name,
        witness.phone,
        witness.idCardNo,
        witness.address,
        witnessIdImage
      );

      // Create sale record
      const saleId = db.prepare(`
        INSERT INTO sales (item_id, item_name, quantity, buying_price, selling_price, price,
                          total, profit, payment_type, customer_id, teller_id, teller_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        item.id,
        item.name,
        quantity,
        item.buying_price,
        item.selling_price,
        item.price,
        totalAmount,
        profit,
        'installment',
        customerId,
        req.user.id,
        req.user.username
      ).lastInsertRowid;

      // Create installment plan
      const planId = InstallmentPlan.create({
        saleId,
        customerId,
        witnessId,
        totalAmount,
        downPayment,
        remainingAmount,
        interestRate: settings.interest_rate,
        interestAmount,
        totalWithInterest,
        installmentMonths,
        monthlyPayment
      });

      // Create installment payments schedule
      const startDate = new Date();
      for (let i = 1; i <= installmentMonths; i++) {
        const dueDate = new Date(startDate);
        dueDate.setMonth(dueDate.getMonth() + i);
        const dueDateStr = dueDate.toISOString().split('T')[0];
        
        InstallmentPayment.create(planId, i, monthlyPayment, dueDateStr);
      }

      // Deduct quantity from item
      Item.decrementQuantity(item.id, quantity);

      return {
        sale: db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId),
        plan: InstallmentPlan.getById(planId),
        payments: InstallmentPayment.getByPlanId(planId)
      };
    });

    const result = transaction();

    res.status(201).json(result);
  } catch (error) {
    console.error('Process installment sale error:', error);
    res.status(500).json({ error: 'Server error during installment sale processing' });
  }
};

// Get all sales (Admin only)
const getAllSales = (req, res) => {
  try {
    const sales = db.prepare('SELECT * FROM sales ORDER BY sale_date DESC').all();
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
      sales = db.prepare('SELECT * FROM sales WHERE DATE(sale_date) = DATE(\'now\') ORDER BY sale_date DESC').all();
    } else {
      sales = db.prepare('SELECT * FROM sales WHERE teller_id = ? AND DATE(sale_date) = DATE(\'now\') ORDER BY sale_date DESC').all(req.user.id);
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

    const sales = db.prepare('SELECT * FROM sales WHERE DATE(sale_date) BETWEEN DATE(?) AND DATE(?) ORDER BY sale_date DESC').all(startDate, endDate);
    res.json(sales);
  } catch (error) {
    console.error('Get sales by date range error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get daily summary with profit
const getDailySummary = (req, res) => {
  try {
    let summary;

    if (req.user.role === 'admin') {
      summary = db.prepare(`
        SELECT 
          DATE(sale_date) as date,
          COUNT(*) as total_sales,
          SUM(total) as total_revenue,
          SUM(profit) as total_profit,
          SUM(quantity) as total_items_sold
        FROM sales 
        WHERE DATE(sale_date) = DATE('now')
        GROUP BY DATE(sale_date)
      `).get();
    } else {
      summary = db.prepare(`
        SELECT 
          DATE(sale_date) as date,
          COUNT(*) as total_sales,
          SUM(total) as total_revenue,
          SUM(profit) as total_profit,
          SUM(quantity) as total_items_sold
        FROM sales 
        WHERE teller_id = ? AND DATE(sale_date) = DATE('now')
        GROUP BY DATE(sale_date)
      `).get(req.user.id);
    }

    res.json(summary || {
      date: new Date().toISOString().split('T')[0],
      total_sales: 0,
      total_revenue: 0,
      total_profit: 0,
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
      summary = db.prepare(`
        SELECT 
          COUNT(*) as total_sales,
          SUM(total) as total_revenue,
          SUM(profit) as total_profit,
          SUM(quantity) as total_items_sold
        FROM sales 
        WHERE DATE(sale_date) >= DATE('now', '-7 days')
      `).get();
    } else {
      summary = db.prepare(`
        SELECT 
          COUNT(*) as total_sales,
          SUM(total) as total_revenue,
          SUM(profit) as total_profit,
          SUM(quantity) as total_items_sold
        FROM sales 
        WHERE teller_id = ? AND DATE(sale_date) >= DATE('now', '-7 days')
      `).get(req.user.id);
    }

    res.json(summary || {
      total_sales: 0,
      total_revenue: 0,
      total_profit: 0,
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
      summary = db.prepare(`
        SELECT 
          COUNT(*) as total_sales,
          SUM(total) as total_revenue,
          SUM(profit) as total_profit,
          SUM(quantity) as total_items_sold
        FROM sales 
        WHERE DATE(sale_date) >= DATE('now', 'start of month')
      `).get();
    } else {
      summary = db.prepare(`
        SELECT 
          COUNT(*) as total_sales,
          SUM(total) as total_revenue,
          SUM(profit) as total_profit,
          SUM(quantity) as total_items_sold
        FROM sales 
        WHERE teller_id = ? AND DATE(sale_date) >= DATE('now', 'start of month')
      `).get(req.user.id);
    }

    res.json(summary || {
      total_sales: 0,
      total_revenue: 0,
      total_profit: 0,
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
    const summary = db.prepare(`
      SELECT 
        COUNT(*) as total_sales,
        SUM(total) as total_revenue,
        SUM(profit) as total_profit,
        SUM(quantity) as total_items_sold
      FROM sales
    `).get();
    
    res.json(summary || {
      total_sales: 0,
      total_revenue: 0,
      total_profit: 0,
      total_items_sold: 0
    });
  } catch (error) {
    console.error('Get overall summary error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  processCashSale,
  processInstallmentSale,
  getAllSales,
  getTodaySales,
  getSalesByDateRange,
  getDailySummary,
  getWeeklySummary,
  getMonthlySummary,
  getOverallSummary
};
