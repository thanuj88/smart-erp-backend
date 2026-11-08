const harness = require('./helpers/dynamoTestTable');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

let ready = false;
let admin;
let server;
let baseUrl;
let tokenService;
let permissionService;
let authRouter;

before(async () => {
  ready = await harness.isReachable();
  if (!ready) return;
  admin = await harness.createTable();
  tokenService = require('../services/tokenService');
  permissionService = require('../services/permissionService');
  const { authenticate } = require('../middleware/auth');
  const requirePermission = require('../middleware/requirePermission');
  authRouter = require('../routes/auth');
  await permissionService.ensureSeeded();

  const app = express();
  app.use(express.json());
  app.get('/whoami', authenticate, (req, res) => res.json({ role: req.user.role, permissions: req.user.permissions }));
  app.get('/needs-users', authenticate, requirePermission('users:manage'), (req, res) => res.json({ ok: true }));
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!ready) return;
  await new Promise((resolve) => server.close(resolve));
  await harness.dropTable(admin);
  require('../repositories/dynamodb/rbacDynamoRepository').client.destroy();
});

const it = (name, fn) =>
  test(name, async (t) => {
    if (!ready) return t.skip('DynamoDB Local is not running');
    return fn(t);
  });

const token = (role, permissions) =>
  tokenService.signAccessToken({ id: 'u1', username: 'u', role, tenant_id: 1 }, null, permissions);
const call = (path, tok) => fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${tok}` } });

it('permissions come from the role, so a forged or stale claim in the token is ignored', async () => {
  const forged = token('TELLER', ['users:manage', 'platform:manage', 'roles:manage']);
  const body = await (await call('/whoami', forged)).json();
  assert.deepEqual(body.permissions.slice().sort(), ['sales:create', 'sales:view']);
  assert.equal((await call('/needs-users', forged)).status, 403);
});

it('a token with no permission claim still gets the role permissions', async () => {
  assert.equal((await call('/needs-users', token('TENANT_ADMIN', []))).status, 200);
});

it('removing a permission from a role applies to tokens that were already issued', async () => {
  const adminToken = token('TENANT_ADMIN', ['users:manage']);
  assert.equal((await call('/needs-users', adminToken)).status, 200);

  const current = await permissionService.getPermissionsForRole('TENANT_ADMIN');
  await permissionService.setRolePermissions(
    'TENANT_ADMIN',
    current.filter((p) => p !== 'users:manage')
  );
  try {
    assert.equal((await call('/needs-users', adminToken)).status, 403);
  } finally {
    await permissionService.setRolePermissions('TENANT_ADMIN', current);
  }
  assert.equal((await call('/needs-users', adminToken)).status, 200);
});

it('an unknown role gets no permissions at all', async () => {
  const body = await (await call('/whoami', token('GHOST_ROLE', ['users:manage']))).json();
  assert.deepEqual(body.permissions, []);
});

it('bad or missing tokens are still 401', async () => {
  assert.equal((await call('/whoami', 'nope')).status, 401);
  const res = await fetch(`${baseUrl}/whoami`);
  assert.equal(res.status, 401);
});

test('POST /auth/refresh is behind the refresh limiter', () => {
  const { refreshLimiter } = require('../middleware/rateLimit');
  const route = require('../routes/auth').stack.find((l) => l.route?.path === '/refresh' && l.route.methods.post);
  assert.ok(route, 'refresh route exists');
  assert.ok(route.route.stack.some((l) => l.handle === refreshLimiter), 'refreshLimiter is on the route');
});

test('the refresh limiter answers 429 after 60 requests from one address', async () => {
  const { refreshLimiter } = require('../middleware/rateLimit');
  const app = express();
  app.post('/r', refreshLimiter, (req, res) => res.json({ ok: true }));
  const srv = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const url = `http://127.0.0.1:${srv.address().port}/r`;
    for (let i = 0; i < 60; i += 1) assert.equal((await fetch(url, { method: 'POST' })).status, 200);
    assert.equal((await fetch(url, { method: 'POST' })).status, 429);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});
