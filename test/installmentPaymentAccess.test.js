const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const tokenService = require('../services/tokenService');
const permissionService = require('../services/permissionService');
const installmentPaymentService = require('../services/installmentPaymentService');
const installmentPaymentDynamo = require('../repositories/dynamodb/installmentPaymentDynamoRepository');

let server;
let baseUrl;
let recorded;

function allow(role) {
  if (role === 'TELLER') return ['sales:create', 'sales:view'];
  if (role === 'MANAGER') return ['sales:create', 'reports:view', 'inventory:manage'];
  if (role === 'ACCOUNTANT') return ['sales:view', 'reports:view', 'inventory:view'];
  if (role === 'INVENTORY') return ['inventory:manage', 'inventory:view'];
  if (role === 'TENANT_ADMIN') return ['users:manage', 'sales:create', 'reports:view'];
  return [];
}

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/installment-payments', require('../routes/installmentPayments'));
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/installment-payments`;
});

beforeEach(() => {
  recorded = [];
  mock.restoreAll();
  mock.method(permissionService, 'getPermissionsForRole', async (role) => allow(role));
  mock.method(installmentPaymentService, 'getPending', async () => [{ id: 'pay1', status: 'pending' }]);
  mock.method(installmentPaymentDynamo, 'getById', async () => ({
    id: 'pay1',
    status: 'pending',
    amount_due: 100,
    amount_paid: 0,
  }));
  mock.method(installmentPaymentService, 'recordPayment', async (...args) => {
    recorded.push(args);
    return { id: 'pay1', status: 'paid' };
  });
});

after(async () => {
  mock.restoreAll();
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const token = (role) => tokenService.signAccessToken(
  { id: 'u1', username: 'user', email: 'user@shop.test', role, tenant_id: 1 },
  null,
  []
);

const pay = (role) => fetch(`${baseUrl}/pay1/pay`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token(role)}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ amountPaid: 50 }),
});

test('an accountant can read pending installments and cannot record a payment', async () => {
  const listed = await fetch(`${baseUrl}/pending`, {
    headers: { Authorization: `Bearer ${token('ACCOUNTANT')}` },
  });
  assert.equal(listed.status, 200);

  const res = await pay('ACCOUNTANT');
  assert.equal(res.status, 403);
  assert.equal(recorded.length, 0);
});

test('a teller and a manager can record an installment payment', async () => {
  assert.equal((await pay('TELLER')).status, 200);
  assert.equal((await pay('MANAGER')).status, 200);
  assert.equal(recorded.length, 2);
});

test('an inventory clerk cannot read or record installment payments', async () => {
  const listed = await fetch(`${baseUrl}/pending`, {
    headers: { Authorization: `Bearer ${token('INVENTORY')}` },
  });
  assert.equal(listed.status, 403);
  assert.equal((await pay('INVENTORY')).status, 403);
  assert.equal(recorded.length, 0);
});
