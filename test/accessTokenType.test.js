const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const express = require('express');
const { jwtSecret } = require('../config/config');
const authConfig = require('../config/auth');
const tokenService = require('../services/tokenService');
const { authenticate } = require('../middleware/auth');

const base = { sub: 'u1', id: 'u1', username: 'u', role: 'TELLER', tenantId: 1, permissions: [] };

async function withServer(fn) {
  const app = express();
  app.get('/me', authenticate, (req, res) => res.json({ id: req.user.id }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    await fn(`http://127.0.0.1:${server.address().port}/me`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const status = async (url, token) => (await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).status;

test('verifyAccessToken only accepts type "access"', () => {
  const sign = (payload, secret = jwtSecret) => jwt.sign(payload, secret, { expiresIn: '5m' });
  assert.equal(tokenService.verifyAccessToken(sign({ ...base, type: 'access' })).id, 'u1');
  assert.throws(() => tokenService.verifyAccessToken(sign({ ...base })), /Invalid token type/);
  assert.throws(() => tokenService.verifyAccessToken(sign({ ...base, type: 'refresh' })), /Invalid token type/);
  assert.throws(() => tokenService.verifyAccessToken(sign({ ...base, type: 'ACCESS' })), /Invalid token type/);
  assert.throws(() => tokenService.verifyAccessToken(sign({ ...base, type: ['access'] })), /Invalid token type/);
});

test('tokens we issue still work end to end', async () => {
  await withServer(async (url) => {
    const issued = tokenService.signAccessToken({ id: 'u1', username: 'u', role: 'TELLER', tenant_id: 1 }, null, []);
    assert.equal(await status(url, issued), 200);
  });
});

test('the middleware rejects untyped, refresh-typed and cross-secret tokens', async () => {
  await withServer(async (url) => {
    const sign = (payload, secret = jwtSecret) => jwt.sign(payload, secret, { expiresIn: '5m' });
    assert.equal(await status(url, sign({ ...base })), 401, 'no type');
    assert.equal(await status(url, sign({ ...base, type: 'refresh' })), 401, 'refresh type');
    assert.equal(await status(url, sign({ ...base, type: 'access' }, authConfig.jwtRefreshSecret)), 401, 'wrong secret');
    assert.equal(await status(url, tokenService.signRefreshToken({ id: 'u1' })), 401, 'real refresh token');
    assert.equal(await status(url, 'garbage'), 401);
  });
});
