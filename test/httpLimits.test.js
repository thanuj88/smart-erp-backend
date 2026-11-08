const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  applyHttpMiddleware,
  allowedOrigins,
  isOriginAllowed,
  IMAGE_ROUTE_PREFIXES,
} = require('../config/http');
const { authenticate } = require('../middleware/auth');
const tokenService = require('../services/tokenService');

const PROD = { NODE_ENV: 'production', APP_URL: 'https://app.brightpos.com', CORS_ORIGINS: 'https://admin.brightpos.com/, ,not a url' };

test('allowlist is APP_URL plus CORS_ORIGINS, normalised, junk dropped', () => {
  assert.deepEqual(allowedOrigins(PROD), ['https://app.brightpos.com', 'https://admin.brightpos.com']);
  assert.deepEqual(allowedOrigins({}), []);
});

test('deployed: only listed origins pass; localhost and look-alikes do not', () => {
  assert.equal(isOriginAllowed('https://app.brightpos.com', PROD), true);
  assert.equal(isOriginAllowed('https://APP.brightpos.com/', PROD), true);
  assert.equal(isOriginAllowed('https://admin.brightpos.com', PROD), true);
  assert.equal(isOriginAllowed('https://evil.com', PROD), false);
  assert.equal(isOriginAllowed('https://app.brightpos.com.evil.com', PROD), false);
  assert.equal(isOriginAllowed('http://app.brightpos.com', PROD), false);
  assert.equal(isOriginAllowed('http://localhost:3000', PROD), false);
  assert.equal(isOriginAllowed('null', PROD), false);
  // Unset NODE_ENV counts as deployed.
  assert.equal(isOriginAllowed('http://localhost:3000', { APP_URL: 'https://a.com' }), false);
});

test('local development allows localhost on any port only', () => {
  const dev = { NODE_ENV: 'development', APP_URL: 'http://localhost:3000' };
  assert.equal(isOriginAllowed('http://localhost:5173', dev), true);
  assert.equal(isOriginAllowed('http://127.0.0.1:3000', dev), true);
  assert.equal(isOriginAllowed('http://localhost.evil.com', dev), false);
  assert.equal(isOriginAllowed('https://evil.com', dev), false);
});

test('requests without an Origin header are not blocked by CORS', () => {
  assert.equal(isOriginAllowed(undefined, PROD), true);
});

let server;
let base;
const start = async (env) => {
  const app = express();
  applyHttpMiddleware(app, { authenticate, env });
  app.post('/api/auth/register', (req, res) => res.json({ ok: true }));
  app.post('/api/items', (req, res) => res.json({ ok: true, size: JSON.stringify(req.body).length }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.type || 'error' }));
  await new Promise((r) => {
    server = app.listen(0, r);
  });
  base = `http://127.0.0.1:${server.address().port}`;
};
const stop = () => new Promise((r) => server.close(r));

const post = (path, body, headers = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

test('http: CORS headers only for allowed origins', async () => {
  await start(PROD);
  try {
    const ok = await post('/api/auth/register', {}, { Origin: 'https://app.brightpos.com' });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.brightpos.com');
    const bad = await post('/api/auth/register', {}, { Origin: 'https://evil.com' });
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
    const pre = await fetch(`${base}/api/auth/register`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.com', 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(pre.headers.get('access-control-allow-origin'), null);
  } finally {
    await stop();
  }
});

test('http: anonymous callers are capped at the small default limit, even on image routes', async () => {
  await start(PROD);
  try {
    const big = { data: 'x'.repeat(2 * 1024 * 1024) };
    assert.equal((await post('/api/auth/register', big)).status, 413);
    // No token on an image route: rejected by authenticate before the 15mb parser runs.
    assert.equal((await post('/api/items', big)).status, 401);
    assert.equal((await post('/api/auth/register', { data: 'x'.repeat(1000) })).status, 200);
  } finally {
    await stop();
  }
});

test('http: a signed-in caller may upload a large image on image routes only', async () => {
  await start(PROD);
  try {
    const token = tokenService.signAccessToken(
      { id: 'u1', username: 'u', role: 'TENANT_ADMIN', tenant_id: 1 },
      null,
      ['inventory:manage']
    );
    const auth = { Authorization: `Bearer ${token}` };
    const image = { image: 'x'.repeat(2 * 1024 * 1024) };
    assert.equal((await post('/api/items', image, auth)).status, 200);
    assert.equal((await post('/api/auth/register', image, auth)).status, 413);
    const huge = { image: 'x'.repeat(16 * 1024 * 1024) };
    assert.equal((await post('/api/items', huge, auth)).status, 413);
  } finally {
    await stop();
  }
});

test('image prefixes are exactly the routes that save images', () => {
  assert.deepEqual(IMAGE_ROUTE_PREFIXES, ['/api/items', '/api/sales', '/api/settings']);
});
