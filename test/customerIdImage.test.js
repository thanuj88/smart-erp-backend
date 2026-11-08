const harness = require('./helpers/dynamoTestTable');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs');

let ready = false;
let admin;
let server;
let baseUrl;
let products;
let orders;
let plans;
let settings;
let tokenService;
let resolveFile;
const T = 9400;
const OTHER = 9401;
const user = { id: 'teller-1', username: 'ada' };
const written = [];

// 1x1 transparent PNG as a data URL, the shape the POS camera control produces.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

before(async () => {
  ready = await harness.isReachable();
  if (!ready) return;
  admin = await harness.createTable();
  products = require('../repositories/dynamodb/productDynamoRepository');
  orders = require('../repositories/dynamodb/orderDynamoRepository');
  plans = require('../repositories/dynamodb/installmentPlanDynamoRepository');
  settings = require('../repositories/dynamodb/installmentSettingDynamoRepository');
  tokenService = require('../services/tokenService');
  resolveFile = require('../utils/privateUpload').resolveWitnessImageFile;
  await settings.upsert(T, 3, 0);
  await products.create(T, { id: 'p1', name: 'Fan', sellingPrice: 100, buyingPrice: 60, quantity: 50, returnQuantity: 0 });

  const app = express();
  app.use(express.json());
  // authenticate reloads permissions from RBAC, so the role table has to exist.
  await require('../services/permissionService').ensureSeeded();
  app.use('/api/installment-plans', require('../routes/installmentPlans'));
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/installment-plans`;
});

after(async () => {
  if (!ready) return;
  await new Promise((resolve) => server.close(resolve));
  await harness.dropTable(admin);
  orders.client.destroy();
  for (const f of written) fs.rmSync(f, { force: true });
});

const it = (name, fn) =>
  test(name, async (t) => {
    if (!ready) return t.skip('DynamoDB Local is not running');
    return fn(t);
  });

const token = (tenantId, permissions = ['sales:create'], role = 'TELLER') =>
  tokenService.signAccessToken({ id: 'u', username: 'u', role, tenant_id: tenantId }, null, permissions);
const get = (path, tenantId = T, perms, role) =>
  fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token(tenantId, perms, role)}` } });

const sell = async (name, idImage) => {
  await orders.processInstallmentSale(T, user, {
    lines: [{ itemId: 'p1', quantity: 1 }],
    customer: { name, phone: `07${Math.floor(Math.random() * 1e8)}`, idImage },
    includeWitness: false,
    downPayment: 10,
    installmentMonths: 3,
  });
  const plan = (await plans.getActive(T)).find((p) => p.customer_name === name);
  if (plan.customer_id_image_path) written.push(resolveFile(plan.customer_id_image_path));
  return plan;
};

it('the customer ID photo is saved privately and the plan remembers it', async () => {
  const plan = await sell('With Photo', PNG);
  assert.match(plan.customer_id_image_path, /^private\/witnesses\/[0-9a-f]{32}\.jpg$/);
  assert.ok(fs.existsSync(resolveFile(plan.customer_id_image_path)));
});

it('no photo captured means nothing is stored', async () => {
  const plan = await sell('No Photo');
  assert.equal(plan.customer_id_image_path, null);
});

it('the photo can be fetched through the authenticated endpoint', async () => {
  const plan = await sell('Fetch Me', PNG);
  const res = await get(`/${plan.id}/customer-id-image`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const expected = Buffer.from(PNG.split(',')[1], 'base64');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), expected);
});

it('the endpoint needs a token, the installment permission and the right shop', async () => {
  const plan = await sell('Private One', PNG);
  assert.equal((await fetch(`${baseUrl}/${plan.id}/customer-id-image`)).status, 401);
  assert.equal((await get(`/${plan.id}/customer-id-image`, T, ['inventory:manage'], 'NO_SUCH_ROLE')).status, 403);
  assert.equal((await get(`/${plan.id}/customer-id-image`, OTHER)).status, 404);
});

it('a plan without a photo, or an unknown plan, is a 404', async () => {
  const plan = await sell('Bare Plan');
  assert.equal((await get(`/${plan.id}/customer-id-image`)).status, 404);
  assert.equal((await get('/does-not-exist/customer-id-image')).status, 404);
});

it('plan responses never expose the stored file path, only whether a photo exists', async () => {
  const plan = await sell('Flagged', PNG);
  const list = await (await get('/active')).json();
  const row = list.find((p) => p.id === plan.id);
  assert.equal(row.has_customer_id_image, true);
  assert.equal('customer_id_image_path' in row, false);
  const one = await (await get(`/${plan.id}`)).json();
  assert.equal(one.has_customer_id_image, true);
  assert.equal('customer_id_image_path' in one, false);
  assert.equal(JSON.stringify(list).includes('private/witnesses'), false);
});
