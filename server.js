require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { port } = require('./config/config');
const databaseConfig = require('./config/dataStore');

const app = express();

async function initializeDataStores() {
  const initDynamoTable = require('./scripts/initDynamoTable');
  const seedDynamo = require('./scripts/seedDynamo');
  await initDynamoTable();
  await seedDynamo();
  console.log(`DynamoDB ready: table ${databaseConfig.dynamodb.tableName}`);
}

initializeDataStores().catch((err) => {
  console.error('Database init failed:', err.message);
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/items', require('./routes/items'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/users', require('./routes/users'));
app.use('/api/installment-settings', require('./routes/installmentSettings'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/installment-plans', require('./routes/installmentPlans'));
app.use('/api/installment-payments', require('./routes/installmentPayments'));
app.use('/api/platform', require('./routes/platform'));

app.use('/uploads', express.static('uploads'));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: databaseConfig.dbType,
    readSource: databaseConfig.readSource,
  });
});

app.get('/', (req, res) => {
  res.json({
    message: 'Shop Inventory API',
    version: '2.0.0',
    database: databaseConfig.dbType,
    endpoints: {
      auth: '/api/auth',
      items: '/api/items',
      sales: '/api/sales',
      users: '/api/users',
      platform: '/api/platform',
    },
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
  console.log(`\n🚀 Server running on port ${port}`);
  console.log(`📡 API available at http://localhost:${port}/api`);
  console.log(`\n📝 Default credentials (after seed):`);
  console.log(`   Tenant Admin - username: admin, password: admin123`);
  console.log(`   Teller - username: teller, password: teller123`);
  console.log(`   Super Admin - username: superadmin, password: superadmin123\n`);
});

module.exports = app;
