const harness = require('./helpers/dynamoTestTable');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

let ready = false;
let admin;
let server;
let baseUrl;
let authRepo;
let tokenService;

before(async () => {
  ready = await harness.isReachable();
  if (!ready) return;
  admin = await harness.createTable();
  authRepo = require('../repositories/dynamodb/authDynamoRepository');
  tokenService = require('../services/tokenService');
  const authRoutes = require('../routes/auth');

  await authRepo.branches.put(7, 'b1', { name: 'Seven Main', code: 'S1', tenant_id: 7 });
  await authRepo.branches.put(8, 'b2', { name: 'Eight Main', code: 'E1', tenant_id: 8 });

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;
});

after(async () => {
  if (!ready) return;
  await new Promise((resolve) => server.close(resolve));
  await harness.dropTable(admin);
  authRepo.client.destroy();
});

const it = (name, fn) =>
  test(name, async (t) => {
    if (!ready) return t.skip('DynamoDB Local is not running');
    return fn(t);
  });

const tokenFor = (user, permissions) => tokenService.signAccessToken(user, null, permissions);

const get = (path, token) =>
  fetch(`${baseUrl}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

it('anonymous callers cannot list branches', async () => {
  const res = await get('/branches?tenantId=7');
  assert.equal(res.status, 401);
});

it('a tenant user sees only their own shop, with or without the query', async () => {
  const token = tokenFor({ id: 'u7', username: 'u7', role: 'TELLER', tenant_id: 7 }, ['sales:create']);

  const plain = await get('/branches', token);
  assert.equal(plain.status, 200);
  assert.deepEqual((await plain.json()).map((b) => b.name), ['Seven Main']);

  const same = await get('/branches?tenantId=7', token);
  assert.equal(same.status, 200);
});

it('a tenant user cannot read another shop by passing its tenantId', async () => {
  const token = tokenFor({ id: 'u7', username: 'u7', role: 'TELLER', tenant_id: 7 }, ['sales:create']);
  const res = await get('/branches?tenantId=8', token);
  assert.equal(res.status, 403);
});

it('platform operators pick the shop with tenantId and must provide it', async () => {
  const token = tokenFor(
    { id: 'root', username: 'root', role: 'SUPER_ADMIN', tenant_id: 0 },
    ['platform:manage']
  );
  const other = await get('/branches?tenantId=8', token);
  assert.equal(other.status, 200);
  assert.deepEqual((await other.json()).map((b) => b.name), ['Eight Main']);

  const missing = await get('/branches', token);
  assert.equal(missing.status, 400);
});
