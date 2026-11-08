require('dotenv').config();
const express = require('express');
const { applyHttpMiddleware, allowedOrigins } = require('./config/http');
const { authenticate } = require('./middleware/auth');
const { port } = require('./config/config');
const databaseConfig = require('./config/dataStore');
const { resolveTrustProxy } = require('./config/proxy');
const { assertSecureConfig } = require('./config/secrets');

// Before anything listens or seeds: a deployment on placeholder secrets must not come up.
assertSecureConfig();

const app = express();

const trustProxy = resolveTrustProxy(process.env);
if (trustProxy.warning) console.warn(trustProxy.warning);
app.set('trust proxy', trustProxy.value);

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

applyHttpMiddleware(app, { authenticate });

if (process.env.NODE_ENV === 'production' && allowedOrigins().length === 0) {
  console.warn('CORS: set APP_URL (or CORS_ORIGINS) or browsers will be unable to call this API.');
}

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/items', require('./routes/items'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/promotions', require('./routes/promotions'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/users', require('./routes/users'));
app.use('/api/installment-settings', require('./routes/installmentSettings'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/installment-plans', require('./routes/installmentPlans'));
app.use('/api/installment-payments', require('./routes/installmentPayments'));
app.use('/api/platform', require('./routes/platform'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/witnesses', require('./routes/witnesses'));

const { isBlockedUploadPath } = require('./utils/privateUpload');

app.use(
  '/uploads',
  (req, res, next) => {
    if (isBlockedUploadPath(req.path)) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  },
  express.static('uploads')
);

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
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
  console.log(`\n🚀 Server running on port ${port}`);
  console.log(`📡 API available at http://localhost:${port}/api`);
});

module.exports = app;
