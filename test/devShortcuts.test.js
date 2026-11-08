const { test } = require('node:test');
const assert = require('node:assert/strict');
const authConfig = require('../config/auth');
const { verifyCaptcha } = require('../utils/captcha');

const { resolveSecurityFlags } = authConfig;

test('captcha is skipped only in local development', () => {
  assert.equal(resolveSecurityFlags({ NODE_ENV: 'development' }).skipCaptcha, true);
  assert.equal(resolveSecurityFlags({ NODE_ENV: 'test', SKIP_CAPTCHA: 'true' }).skipCaptcha, true);
  assert.equal(resolveSecurityFlags({ NODE_ENV: 'test' }).skipCaptcha, false);
});

test('SKIP_CAPTCHA=true does nothing in a deployed environment', () => {
  for (const NODE_ENV of ['production', 'staging', 'uat', undefined, '']) {
    assert.equal(
      resolveSecurityFlags({ NODE_ENV, SKIP_CAPTCHA: 'true' }).skipCaptcha,
      false,
      `NODE_ENV=${NODE_ENV}`
    );
  }
});

test('verify and reset tokens need an explicit opt-in', () => {
  assert.equal(resolveSecurityFlags({ NODE_ENV: 'development' }).exposeDevTokens, false);
  assert.equal(resolveSecurityFlags({}).exposeDevTokens, false);
  assert.equal(resolveSecurityFlags({ NODE_ENV: 'development', EXPOSE_DEV_TOKENS: 'true' }).exposeDevTokens, true);
  assert.equal(resolveSecurityFlags({ NODE_ENV: 'staging', EXPOSE_DEV_TOKENS: 'true' }).exposeDevTokens, true);
  assert.equal(resolveSecurityFlags({ NODE_ENV: 'development', EXPOSE_DEV_TOKENS: 'yes' }).exposeDevTokens, false);
});

test('tokens are never exposed in production, even with the flag', () => {
  assert.equal(resolveSecurityFlags({ NODE_ENV: 'production', EXPOSE_DEV_TOKENS: 'true' }).exposeDevTokens, false);
});

test('captcha fails closed when the secret is missing and skipping is off', async (t) => {
  const savedSkip = authConfig.skipCaptcha;
  const savedSecret = process.env.RECAPTCHA_SECRET;
  const savedError = console.error;
  t.after(() => {
    authConfig.skipCaptcha = savedSkip;
    if (savedSecret === undefined) delete process.env.RECAPTCHA_SECRET;
    else process.env.RECAPTCHA_SECRET = savedSecret;
    console.error = savedError;
  });
  console.error = () => {};

  authConfig.skipCaptcha = false;
  delete process.env.RECAPTCHA_SECRET;

  for (const nodeEnv of ['production', 'staging', 'development', undefined]) {
    const savedEnv = process.env.NODE_ENV;
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
    try {
      assert.equal(await verifyCaptcha('any-token'), false, `NODE_ENV=${nodeEnv}`);
    } finally {
      if (savedEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = savedEnv;
    }
  }
});

test('captcha is still skipped when local development says so', async (t) => {
  const savedSkip = authConfig.skipCaptcha;
  t.after(() => {
    authConfig.skipCaptcha = savedSkip;
  });
  authConfig.skipCaptcha = true;
  assert.equal(await verifyCaptcha(undefined), true);
});
