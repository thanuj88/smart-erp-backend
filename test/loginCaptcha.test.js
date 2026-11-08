const harness = require('./helpers/dynamoTestTable');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const bcrypt = require('bcryptjs');

let ready = false;
let admin;
let server;
let baseUrl;
let authRepo;
let authConfig;
let tenantId;
let seq = 0;
const realFetch = global.fetch;

before(async () => {
  ready = await harness.isReachable();
  if (!ready) return;
  admin = await harness.createTable();
  authConfig = require('../config/auth');
  tenantId = require('../config/dataStore').defaultTenantId;
  authRepo = require('../repositories/dynamodb/authDynamoRepository');
  await require('../services/permissionService').ensureSeeded();

  // Google's verification endpoint is faked: only the token "good" passes.
  global.fetch = async (url, init) => {
    if (String(url).includes('google.com/recaptcha')) {
      const token = new URLSearchParams(init.body).get('response');
      return { json: async () => ({ success: token === 'good' }) };
    }
    return realFetch(url, init);
  };

  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../routes/auth'));
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;
});

after(async () => {
  if (!ready) return;
  global.fetch = realFetch;
  await new Promise((resolve) => server.close(resolve));
  await harness.dropTable(admin);
  authRepo.client.destroy();
});

beforeEach(() => {
  if (!ready) return;
  // The per-IP login limiter (20 per 15 min) is not what is under test; every request here shares one IP.
  const { loginLimiter } = require('../middleware/rateLimit');
  for (const key of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) loginLimiter.resetKey(key);
  authConfig.skipCaptcha = false;
  process.env.RECAPTCHA_SECRET = 'secret';
  delete process.env.CAPTCHA_AFTER_FAILURES;
});

const it = (name, fn) =>
  test(name, async (t) => {
    if (!ready) return t.skip('DynamoDB Local is not running');
    return fn(t);
  });

async function makeUser() {
  seq += 1;
  const email = `teller${seq}@shop.test`;
  const user = await authRepo.createStaffUser({
    tenantId,
    branchId: null,
    username: `teller${seq}`,
    email,
    hashedPassword: await bcrypt.hash('RightPass123', 4),
    role: 'TELLER',
    fullName: 'Teller',
    pinHash: await bcrypt.hash('654321', 4),
    isActive: true,
  });
  return { email, id: user.id };
}

const post = (path, body) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const attempts = async (id) => (await authRepo.findUserWithPassword(id)).failed_login_attempts;

it('without CAPTCHA configured, sign-in behaves as before and never asks for one', async () => {
  delete process.env.RECAPTCHA_SECRET;
  const { email } = await makeUser();
  for (let i = 0; i < 4; i += 1) {
    const res = await post('/login', { email, password: 'wrong' });
    assert.equal(res.status, 401);
    assert.equal('captchaRequired' in (await res.json()), false);
  }
  assert.equal((await post('/login', { email, password: 'RightPass123' })).status, 200);
});

it('a skipped CAPTCHA (development) never challenges either', async () => {
  authConfig.skipCaptcha = true;
  const { email } = await makeUser();
  for (let i = 0; i < 4; i += 1) await post('/login', { email, password: 'wrong' });
  assert.equal((await post('/login', { email, password: 'RightPass123' })).status, 200);
});

it('the first failures are plain 401s, the third one says a CAPTCHA is now needed', async () => {
  const { email } = await makeUser();
  for (let i = 0; i < 2; i += 1) {
    const body = await (await post('/login', { email, password: 'wrong' })).json();
    assert.equal(body.captchaRequired, undefined, `attempt ${i + 1}`);
  }
  const third = await post('/login', { email, password: 'wrong' });
  assert.equal(third.status, 401);
  assert.equal((await third.json()).captchaRequired, true);
});

it('after the threshold even the right password needs a valid CAPTCHA, and a refused try does not count', async () => {
  const { email, id } = await makeUser();
  for (let i = 0; i < 3; i += 1) await post('/login', { email, password: 'wrong' });
  assert.equal(await attempts(id), 3);

  const none = await post('/login', { email, password: 'RightPass123' });
  assert.equal(none.status, 400);
  assert.equal((await none.json()).captchaRequired, true);

  const bad = await post('/login', { email, password: 'RightPass123', captchaToken: 'forged' });
  assert.equal(bad.status, 400);
  assert.equal(await attempts(id), 3, 'no password guess is made without a CAPTCHA');

  const ok = await post('/login', { email, password: 'RightPass123', captchaToken: 'good' });
  assert.equal(ok.status, 200);
  assert.equal(await attempts(id), 0);

  assert.equal((await post('/login', { email, password: 'RightPass123' })).status, 200, 'counter reset, no CAPTCHA');
});

it('PIN sign-in is challenged the same way', async () => {
  const { email, id } = await makeUser();
  for (let i = 0; i < 3; i += 1) {
    const res = await post('/login/pin', { email, pin: '000000' });
    assert.equal(res.status, 401);
  }
  assert.equal(await attempts(id), 3);
  const blocked = await post('/login/pin', { email, pin: '654321' });
  assert.equal(blocked.status, 400);
  assert.equal((await blocked.json()).captchaRequired, true);
  assert.equal((await post('/login/pin', { email, pin: '654321', captchaToken: 'good' })).status, 200);
});

it('a CAPTCHA does not lift the account lockout', async () => {
  const { email, id } = await makeUser();
  for (let i = 0; i < 3; i += 1) await post('/login', { email, password: 'wrong' });
  for (let i = 0; i < 2; i += 1) await post('/login', { email, password: 'wrong', captchaToken: 'good' });
  assert.equal(await attempts(id), 5);
  const locked = await post('/login', { email, password: 'RightPass123', captchaToken: 'good' });
  assert.equal(locked.status, 403);
});

it('CAPTCHA_AFTER_FAILURES moves the threshold', async () => {
  process.env.CAPTCHA_AFTER_FAILURES = '1';
  const { email } = await makeUser();
  const first = await post('/login', { email, password: 'wrong' });
  assert.equal((await first.json()).captchaRequired, true);
  assert.equal((await post('/login', { email, password: 'RightPass123' })).status, 400);
});
