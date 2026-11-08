const harness = require('./helpers/dynamoTestTable');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

let ready = false;
let admin;
let server;
let baseUrl;
let authRepo;
let mailer;
let authConfig;
const sent = [];
let failSend = false;

const fakeTransport = {
  async sendMail(msg) {
    if (failSend) throw new Error('smtp down');
    sent.push(msg);
  },
};

before(async () => {
  ready = await harness.isReachable();
  if (!ready) return;
  admin = await harness.createTable();
  process.env.SKIP_CAPTCHA = 'true';
  authConfig = require('../config/auth');
  authConfig.skipCaptcha = true;
  authRepo = require('../repositories/dynamodb/authDynamoRepository');
  mailer = require('../services/mailer');
  mailer._setTransport(fakeTransport);
  const permissionService = require('../services/permissionService');
  await permissionService.ensureSeeded();

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
  mailer._setTransport(null);
  await new Promise((resolve) => server.close(resolve));
  await harness.dropTable(admin);
  authRepo.client.destroy();
});

beforeEach(() => {
  sent.length = 0;
  failSend = false;
  delete process.env.SMTP_HOST;
});

const it = (name, fn) =>
  test(name, async (t) => {
    if (!ready) return t.skip('DynamoDB Local is not running');
    return fn(t);
  });

const post = (path, body) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

let n = 0;
const registration = () => {
  n += 1;
  return {
    email: `owner${n}@shop.test`,
    password: 'LongPassword1',
    fullName: 'Owner <b>One</b>',
    businessName: `Shop ${n}`,
    country: 'LK',
    phone: '+94771234567',
  };
};

it('deployed without SMTP: register is refused and no account is created', async () => {
  authConfig.exposeDevTokens = false;
  const body = registration();
  const res = await post('/register', body);
  assert.equal(res.status, 503);
  assert.equal(await authRepo.findUserByUsernameOrEmail(body.email), null);
});

it('with SMTP: register sends one verification email to the owner and still works', async () => {
  authConfig.exposeDevTokens = false;
  process.env.SMTP_HOST = 'smtp.test';
  const body = registration();
  const res = await post('/register', body);
  assert.equal(res.status, 201);
  const payload = await res.json();
  assert.equal('verificationToken' in payload, false, 'token must not be in the response');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, body.email);
  assert.match(sent[0].text, /\/verify-email\?token=[0-9a-f]+/i);
  assert.equal(sent[0].html.includes('<b>One</b>'), false, 'user supplied name is escaped');
});

it('the emailed token actually verifies the account', async () => {
  authConfig.exposeDevTokens = false;
  process.env.SMTP_HOST = 'smtp.test';
  await post('/register', registration());
  const token = sent[0].text.match(/token=([0-9a-f]+)/i)[1];
  const verify = await post('/verify-email', { token });
  assert.equal(verify.status, 200);
});

it('a failing mail server gives a clear error, and resend recovers the account', async () => {
  authConfig.exposeDevTokens = false;
  process.env.SMTP_HOST = 'smtp.test';
  failSend = true;
  const body = registration();
  const res = await post('/register', body);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).code, 'VERIFICATION_EMAIL_FAILED');

  failSend = false;
  const resend = await post('/resend-verification', { email: body.email });
  assert.equal(resend.status, 200);
  assert.equal(sent.length, 1);
  const token = sent[0].text.match(/token=([0-9a-f]+)/i)[1];
  assert.equal((await post('/verify-email', { token })).status, 200);

  // Once verified, resend is a silent no-op.
  sent.length = 0;
  assert.equal((await post('/resend-verification', { email: body.email })).status, 200);
  assert.equal(sent.length, 0);
});

it('resend gives the same answer for unknown emails and sends nothing', async () => {
  process.env.SMTP_HOST = 'smtp.test';
  const known = registration();
  authConfig.exposeDevTokens = false;
  await post('/register', known);
  sent.length = 0;
  const a = await post('/resend-verification', { email: 'nobody@shop.test' });
  assert.equal(a.status, 200);
  assert.equal(sent.length, 0);
  const b = await post('/resend-verification', { email: known.email });
  assert.deepEqual(await a.json(), await b.json());
});

it('forgot-password emails a working reset link, and answers the same for unknown emails', async () => {
  authConfig.exposeDevTokens = false;
  process.env.SMTP_HOST = 'smtp.test';
  const body = registration();
  await post('/register', body);
  const verifyToken = sent[0].text.match(/token=([0-9a-f]+)/i)[1];
  await post('/verify-email', { token: verifyToken });
  sent.length = 0;

  const known = await post('/forgot-password', { email: body.email });
  const unknown = await post('/forgot-password', { email: 'ghost@shop.test' });
  assert.equal(known.status, 200);
  assert.deepEqual(await known.json(), await unknown.json());
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, body.email);

  const resetToken = sent[0].text.match(/reset-password\?token=([0-9a-f]+)/i)[1];
  const reset = await post('/reset-password', { token: resetToken, newPassword: 'AnotherPass12' });
  assert.equal(reset.status, 200);
});

it('forgot-password stays a 200 even when the mail server is down', async () => {
  authConfig.exposeDevTokens = false;
  process.env.SMTP_HOST = 'smtp.test';
  const body = registration();
  await post('/register', body);
  failSend = true;
  assert.equal((await post('/forgot-password', { email: body.email })).status, 200);
});

test('mailer escapes html and refuses to send when unconfigured', async () => {
  const m = require('../services/mailer');
  m._setTransport(null);
  await assert.rejects(m.sendMail({ to: 'a@b.test', subject: 's', text: 't' }, {}), { code: 'MAIL_NOT_CONFIGURED' });
  m._setTransport(fakeTransport);
  await m.sendVerificationEmail({ to: 'a@b.test', name: '<script>', url: 'https://x.test/?a=1&b="2"' }, {});
  const html = sent.pop().html;
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('&quot;'), true);
  m._setTransport(null);
});
