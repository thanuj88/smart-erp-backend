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
  const userRoutes = require('../routes/users');

  for (const [tenant, name] of [[1, 'shopone'], [2, 'shoptwo']]) {
    await authRepo.users.put(tenant, `u-${name}`, {
      tenant_id: tenant,
      branch_id: null,
      username: name,
      email: `${name}@shop.test`,
      role: 'TELLER',
      full_name: name,
      is_active: 1,
    });
  }

  const app = express();
  app.use(express.json());
  app.use('/api/users', userRoutes);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/users`;
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

const tenantAdminToken = (tenantId) =>
  tokenService.signAccessToken(
    { id: `owner${tenantId}`, username: 'owner', role: 'TENANT_ADMIN', tenant_id: tenantId },
    null,
    ['users:manage']
  );
const superAdminToken = () =>
  tokenService.signAccessToken(
    { id: 'root', username: 'root', role: 'SUPER_ADMIN', tenant_id: 0 },
    null,
    ['platform:manage']
  );

const get = (token, query = '') =>
  fetch(`${baseUrl}${query}`, { headers: { Authorization: `Bearer ${token}` } });

const names = async (res) => (await res.json()).map((u) => u.username).sort();

it('a tenant admin sees only their own shop', async () => {
  assert.deepEqual(await names(await get(tenantAdminToken(2))), ['shoptwo']);
  assert.deepEqual(await names(await get(tenantAdminToken(1))), ['shopone']);
});

it('a tenant admin cannot widen the list with a tenantId query', async () => {
  assert.deepEqual(await names(await get(tenantAdminToken(2), '?tenantId=1')), ['shoptwo']);
});

it('super admin without a tenantId no longer falls through to tenant 1', async () => {
  const res = await get(superAdminToken());
  assert.equal(res.status, 400);
  assert.ok(!JSON.stringify(await res.json()).includes('shopone'));
});

it('super admin rejects a malformed tenantId', async () => {
  for (const q of ['?tenantId=0', '?tenantId=abc', '?tenantId=1;2', '?tenantId[]=1', '?tenantId=-1']) {
    assert.equal((await get(superAdminToken(), q)).status, 400, q);
  }
});

it('super admin can list one named shop', async () => {
  assert.deepEqual(await names(await get(superAdminToken(), '?tenantId=2')), ['shoptwo']);
});

it('the response carries no credential fields', async () => {
  const [row] = await (await get(superAdminToken(), '?tenantId=1')).json();
  for (const k of ['password', 'pin_hash', 'pinHash']) assert.equal(k in row, false, k);
});
