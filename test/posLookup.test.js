const harness = require('./helpers/dynamoTestTable');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

let ready = false;
let admin;
let server;
let baseUrl;
let customerService;
let tokenService;

const TENANT = 5;
const PHONE = '+94771234567';

before(async () => {
  ready = await harness.isReachable();
  if (!ready) return;
  admin = await harness.createTable();
  customerService = require('../services/customerService');
  tokenService = require('../services/tokenService');
  const customerRoutes = require('../routes/customers');
  // authenticate reloads permissions from RBAC, so the role table has to exist.
  await require('../services/permissionService').ensureSeeded();

  await customerService.create(TENANT, {
    name: 'Ada Perera',
    phone: PHONE,
    email: 'ada@example.com',
    address: '12 Temple Road, Colombo',
    id_card_no: '901234567V',
  });

  const app = express();
  app.use(express.json());
  app.use('/api/customers', customerRoutes);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/customers`;
});

after(async () => {
  if (!ready) return;
  await new Promise((resolve) => server.close(resolve));
  await harness.dropTable(admin);
  require('../repositories/dynamodb/customerDynamoRepository').client.destroy();
});

const it = (name, fn) =>
  test(name, async (t) => {
    if (!ready) return t.skip('DynamoDB Local is not running');
    return fn(t);
  });

const tokenFor = (id, permissions, role = 'TELLER') =>
  tokenService.signAccessToken({ id, username: id, role, tenant_id: TENANT }, null, permissions);

const lookup = (token, phone = PHONE) =>
  fetch(`${baseUrl}/lookup?phone=${encodeURIComponent(phone)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

it('a teller gets name, member id, phone and the overdue summary only', async () => {
  const res = await lookup(tokenFor('teller-a', ['sales:create']));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['id', 'name', 'overdue', 'phone']);
  assert.equal(body.name, 'Ada Perera');
  assert.ok(body.id);
  assert.deepEqual(body.overdue, { count: 0, plans: 0, amount: 0 });
  const raw = JSON.stringify(body);
  assert.doesNotMatch(raw, /901234567V|Temple Road|ada@example\.com/);
});

it('an unknown number is still a 404 so the till can fall back to walk-in', async () => {
  const res = await lookup(tokenFor('teller-b', ['sales:create']), '+94770000000');
  assert.equal(res.status, 404);
});

it('lookups are rate limited per user, and one user does not slow another', async () => {
  const noisy = tokenFor('scraper', ['sales:create']);
  const statuses = [];
  for (let i = 0; i < 32; i += 1) {
    statuses.push((await lookup(noisy, '+94770000001')).status);
  }
  assert.equal(statuses.filter((status) => status === 404).length, 30);
  assert.equal(statuses.filter((status) => status === 429).length, 2);

  const calm = await lookup(tokenFor('teller-c', ['sales:create']));
  assert.equal(calm.status, 200);
});

it('the full customer record is still there for people allowed to manage customers', async () => {
  const res = await fetch(`${baseUrl}/search?q=Ada`, {
    headers: { Authorization: `Bearer ${tokenFor('manager', ['reports:view'], 'MANAGER')}` },
  });
  assert.equal(res.status, 200);
  const [customer] = await res.json();
  assert.equal(customer.id_card_no, '901234567V');
  assert.equal(customer.address, '12 Temple Road, Colombo');
});

it('a teller still cannot list or search the CRM', async () => {
  const token = tokenFor('teller-d', ['sales:create']);
  const list = await fetch(baseUrl, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(list.status, 403);
  const search = await fetch(`${baseUrl}/search?q=Ada`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(search.status, 403);
});
