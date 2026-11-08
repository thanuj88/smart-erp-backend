const harness = require('./helpers/dynamoTestTable');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { isStaffRole, STAFF_ROLES } = require('../config/staffRoles');

let ready = false;
let admin;
let server;
let baseUrl;
let authRepo;
let tokenService;

// The default tenant is always scanned by findUserById, so no tenant registry rows are needed.
const TENANT = require('../config/dataStore').defaultTenantId;

before(async () => {
  ready = await harness.isReachable();
  if (!ready) return;
  admin = await harness.createTable();
  authRepo = require('../repositories/dynamodb/authDynamoRepository');
  tokenService = require('../services/tokenService');
  const userRoutes = require('../routes/users');

  await authRepo.users.put(TENANT, 'staff1', {
    tenant_id: TENANT,
    branch_id: null,
    username: 'staff1',
    email: 'staff1@shop.test',
    role: 'TELLER',
    full_name: 'Staff One',
    is_active: 1,
  });

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

const adminToken = () =>
  tokenService.signAccessToken(
    { id: 'owner', username: 'owner', role: 'TENANT_ADMIN', tenant_id: TENANT },
    null,
    ['users:manage', 'settings:manage']
  );

const put = (body) =>
  fetch(`${baseUrl}/staff1`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify(body),
  });

const currentRole = async () => (await authRepo.findUserById('staff1', TENANT)).role;

test('the shared allowlist is exactly the four staff roles', () => {
  assert.deepEqual(STAFF_ROLES.slice().sort(), ['ACCOUNTANT', 'INVENTORY', 'MANAGER', 'TELLER']);
  for (const role of ['manager', 'Teller', 'INVENTORY', 'accountant']) assert.equal(isStaffRole(role), true, role);
  for (const role of ['TENANT_ADMIN', 'SUPER_ADMIN', 'PLATFORM_OPS', 'admin', '', null, undefined, {}, ['TELLER']]) {
    assert.equal(isStaffRole(role), false, JSON.stringify(role));
  }
});

it('update refuses a custom role name that is not a staff role', async () => {
  const res = await put({ role: 'PLATFORM_OPS' });
  assert.equal(res.status, 400);
  assert.equal(await currentRole(), 'TELLER');
});

it('update still refuses the admin roles', async () => {
  for (const role of ['TENANT_ADMIN', 'SUPER_ADMIN', 'admin']) {
    const res = await put({ role });
    assert.equal(res.status, 400, role);
  }
  assert.equal(await currentRole(), 'TELLER');
});

it('update refuses non-string role values instead of crashing', async () => {
  for (const role of [{ $ne: 1 }, ['MANAGER'], 123]) {
    const res = await put({ role });
    assert.equal(res.status, 400, JSON.stringify(role));
  }
  assert.equal(await currentRole(), 'TELLER');
});

it('create applies the same allowlist', async () => {
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify({ email: 'new@shop.test', password: 'LongPassword1', role: 'PLATFORM_OPS' }),
  });
  assert.equal(res.status, 400);
});

it('a normal edit with no role, or a real staff role, still works', async () => {
  const rename = await put({ fullName: 'Staff Renamed' });
  assert.equal(rename.status, 200);
  assert.equal((await rename.json()).full_name, 'Staff Renamed');
  assert.equal(await currentRole(), 'TELLER');

  const same = await put({ role: 'teller' });
  assert.equal(same.status, 200);
  assert.equal(await currentRole(), 'TELLER');
});
