require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { port } = require('./config/config');
const initDatabase = require('./scripts/initDb');

// Initialize database
initDatabase();

const app = express();

// Middleware
app.use(cors());
// Increase payload limit for image uploads (base64 encoded images)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/items', require('./routes/items'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/users', require('./routes/users'));
app.use('/api/installment-settings', require('./routes/installmentSettings'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/installment-plans', require('./routes/installmentPlans'));
app.use('/api/installment-payments', require('./routes/installmentPayments'));

// Serve uploaded files
app.use('/uploads', express.static('uploads'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Shop Inventory API',
    version: '2.0.0',
    endpoints: {
      auth: '/api/auth',
      items: '/api/items',
      sales: '/api/sales',
      users: '/api/users',
      installmentSettings: '/api/installment-settings',
      customers: '/api/customers',
      installmentPlans: '/api/installment-plans',
      installmentPayments: '/api/installment-payments'
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(port, () => {
  console.log(`\n🚀 Server running on port ${port}`);
  console.log(`📡 API available at http://localhost:${port}/api`);
  console.log(`\n📝 Default credentials:`);
  console.log(`   Admin - username: admin, password: admin123`);
  console.log(`   Teller - username: teller, password: teller123\n`);
});

module.exports = app;
