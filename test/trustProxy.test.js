const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { resolveTrustProxy } = require('../config/proxy');

test('unset or zero trusts nothing', () => {
  assert.deepEqual(resolveTrustProxy({}), { value: false });
  assert.deepEqual(resolveTrustProxy({ TRUST_PROXY: '' }), { value: false });
  assert.deepEqual(resolveTrustProxy({ TRUST_PROXY: '0' }), { value: false });
});

test('a hop count or a list of addresses and keywords is accepted', () => {
  assert.deepEqual(resolveTrustProxy({ TRUST_PROXY: '1' }), { value: 1 });
  assert.deepEqual(resolveTrustProxy({ TRUST_PROXY: ' 2 ' }), { value: 2 });
  assert.deepEqual(resolveTrustProxy({ TRUST_PROXY: 'loopback' }), { value: ['loopback'] });
  assert.deepEqual(resolveTrustProxy({ TRUST_PROXY: 'Loopback, 10.0.0.0/8 ,::1' }), {
    value: ['loopback', '10.0.0.0/8', '::1'],
  });
});

test('"true" and junk are refused and fall back to trusting nothing', () => {
  for (const raw of ['true', 'yes', 'all', '*', '1.2.3', 'abc', '10.0.0.0/8; drop', '-1']) {
    const result = resolveTrustProxy({ TRUST_PROXY: raw });
    assert.equal(result.value, false, raw);
    assert.match(result.warning, /TRUST_PROXY/, raw);
  }
});

async function ipSeenBy(trustProxy, headers) {
  const app = express();
  app.set('trust proxy', trustProxy.value);
  app.get('/ip', (req, res) => res.json({ ip: req.ip }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/ip`, { headers });
    return (await res.json()).ip;
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('by default a client cannot choose its own IP with X-Forwarded-For', async () => {
  const ip = await ipSeenBy(resolveTrustProxy({}), { 'X-Forwarded-For': '6.6.6.6' });
  assert.notEqual(ip, '6.6.6.6');
  assert.match(ip, /127\.0\.0\.1/);
});

test('with one trusted proxy the proxy-appended address is used, and a spoofed one is not', async () => {
  const trust = resolveTrustProxy({ TRUST_PROXY: '1' });
  // A real proxy appends the address it saw; anything the client put first is ignored.
  const ip = await ipSeenBy(trust, { 'X-Forwarded-For': '6.6.6.6, 203.0.113.9' });
  assert.equal(ip, '203.0.113.9');
});

test('auth audit metadata never reads the forwarded header directly', () => {
  const source = fs.readFileSync(path.join(__dirname, '../controllers/authController.js'), 'utf8');
  assert.equal(/x-forwarded-for/i.test(source.replace(/\/\/.*$/gm, '')), false);
});
