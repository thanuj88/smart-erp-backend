const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const tokenService = require('../services/tokenService');
const permissionService = require('../services/permissionService');
const repo = require('../repositories/dynamodb/activityLogDynamoRepository');

let server;
let baseUrl;
let listed;

function allow(role) {
  if (role === 'TENANT_ADMIN') return ['users:manage'];
  if (role === 'SUPER_ADMIN') return ['platform:manage'];
  if (role === 'TELLER') return ['sales:create'];
  if (role === 'INVENTORY') return ['inventory:manage'];
  if (role === 'ACCOUNTANT') return ['reports:view'];
  return [];
}

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/activity-logs', require('../routes/activityLogs'));
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/activity-logs`;
});

beforeEach(() => {
  listed = [];
  mock.restoreAll();
  mock.method(permissionService, 'getPermissionsForRole', async (role) => allow(role));
  mock.method(repo, 'list', async (tenantId, query) => {
    listed.push({ tenantId, query });
    return {
      items: [{ id: '1', action: 'ITEM_CREATED', user_email: 'clerk@shop.test' }],
      nextCursor: 'next-page',
    };
  });
});

after(async () => {
  mock.restoreAll();
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const token = (role, tenantId) => tokenService.signAccessToken(
  { id: 'u1', username: 'user', email: 'admin@shop.test', role, tenant_id: tenantId },
  null,
  []
);

const get = (role, tenantId, query = '') => fetch(`${baseUrl}${query}`, {
  headers: { Authorization: `Bearer ${token(role, tenantId)}` },
});

test('a teller, an inventory clerk and an accountant cannot read the log', async () => {
  assert.equal((await get('TELLER', 1)).status, 403);
  assert.equal((await get('INVENTORY', 1)).status, 403);
  assert.equal((await get('ACCOUNTANT', 1)).status, 403);
  assert.equal(listed.length, 0);
});

test('a tenant admin sees only the tenant on their token, newest page first', async () => {
  const res = await get('TENANT_ADMIN', 5, '?tenantId=9&action=ITEM_CREATED&cursor=abc&limit=2');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.items[0].action, 'ITEM_CREATED');
  assert.equal(body.nextCursor, 'next-page');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].tenantId, 5);
  assert.equal(listed[0].query.action, 'ITEM_CREATED');
  assert.equal(listed[0].query.cursor, 'abc');
  assert.equal(listed[0].query.limit, '2');
  assert.equal(listed[0].query.tenantId, undefined);
});

test('an unknown action is rejected before the log is read', async () => {
  const res = await get('TENANT_ADMIN', 5, '?action=LOGIN');
  assert.equal(res.status, 400);
  assert.equal(listed.length, 0);
});
