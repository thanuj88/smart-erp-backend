const harness = require('./helpers/dynamoTestTable');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

let ready = false;
let admin;
let authRepo;
let tokenService;
let authController;

const TENANT = 1;

before(async () => {
  ready = await harness.isReachable();
  if (!ready) return;
  admin = await harness.createTable();
  authRepo = require('../repositories/dynamodb/authDynamoRepository');
  tokenService = require('../services/tokenService');
  authController = require('../controllers/authController');
});

after(async () => {
  if (!ready) return;
  await harness.dropTable(admin);
  authRepo.client.destroy();
});

const it = (name, fn) =>
  test(name, async (t) => {
    if (!ready) return t.skip('DynamoDB Local is not running');
    return fn(t);
  });

async function seedUser(id, password = 'OldPassword1') {
  await authRepo.users.put(TENANT, id, {
    tenant_id: TENANT,
    username: id,
    email: `${id}@shop.test`,
    role: 'TELLER',
    is_active: 1,
    email_verified_at: new Date().toISOString(),
    password: await bcrypt.hash(password, 4),
  });
  return authRepo.findUserWithPassword(id);
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

const fakeReq = (body, user) => ({ body, user, headers: {}, ip: '127.0.0.1' });

it('refresh tokens minted in the same second are distinct', async () => {
  const user = { id: 'same-second' };
  const tokens = new Set(Array.from({ length: 5 }, () => tokenService.signRefreshToken(user)));
  assert.equal(tokens.size, 5);
});

it('a password change revokes every refresh token for that user only', async () => {
  const victim = await seedUser('victim');
  const bystander = await seedUser('bystander');
  const stolen = tokenService.signRefreshToken(victim);
  const phone = tokenService.signRefreshToken(victim);
  const other = tokenService.signRefreshToken(bystander);
  await tokenService.storeRefreshToken(victim.id, stolen);
  await tokenService.storeRefreshToken(victim.id, phone);
  await tokenService.storeRefreshToken(bystander.id, other);

  assert.ok(await tokenService.findRefreshToken(stolen));

  await authRepo.updatePassword(victim.id, await bcrypt.hash('NewPassword1', 4));

  assert.equal(await tokenService.findRefreshToken(stolen), null);
  assert.equal(await tokenService.findRefreshToken(phone), null);
  assert.ok(await tokenService.findRefreshToken(other));
  const refreshed = await authRepo.findUserWithPassword(victim.id);
  assert.ok(refreshed.password_changed_at);
});

it('refresh endpoint rejects a stolen token after a password reset', async () => {
  const victim = await seedUser('reset-victim');
  const stolen = tokenService.signRefreshToken(victim);
  await tokenService.storeRefreshToken(victim.id, stolen);

  await authRepo.updatePassword(victim.id, await bcrypt.hash('NewPassword1', 4));

  const res = fakeRes();
  await authController.refresh(fakeReq({ refreshToken: stolen }), res);
  assert.equal(res.statusCode, 401);
});

it('refresh endpoint rejects a token that was minted before the password changed, even if not revoked', async () => {
  const victim = await seedUser('race-victim');
  const raced = tokenService.signRefreshToken(victim);
  await tokenService.storeRefreshToken(victim.id, raced);

  // A refresh that was already past the revoke step when the reset landed.
  await authRepo.updatePassword(victim.id, await bcrypt.hash('NewPassword1', 4));
  const tokenRecords = await authRepo.refreshTokens.queryByTenant(TENANT);
  const record = tokenRecords.find((row) => row.user_id === victim.id);
  await authRepo.refreshTokens.update(TENANT, record.id, { revoked_at: null });

  const res = fakeRes();
  await authController.refresh(fakeReq({ refreshToken: raced }), res);
  assert.equal(res.statusCode, 401);
});

it('a still-valid session keeps refreshing when the password did not change', async () => {
  const user = await seedUser('steady');
  const token = tokenService.signRefreshToken(user);
  await tokenService.storeRefreshToken(user.id, token);

  const res = fakeRes();
  await authController.refresh(fakeReq({ refreshToken: token }), res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.refreshToken);
  assert.notEqual(res.body.refreshToken, token);
});

it('change password signs out other devices but hands this one a fresh pair', async () => {
  const user = await seedUser('changer', 'OldPassword1');
  const otherDevice = tokenService.signRefreshToken(user);
  await tokenService.storeRefreshToken(user.id, otherDevice);

  const res = fakeRes();
  await authController.changePassword(
    fakeReq(
      { currentPassword: 'OldPassword1', newPassword: 'BrandNewPassword1' },
      { id: user.id, tenantId: TENANT }
    ),
    res
  );

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(await tokenService.findRefreshToken(otherDevice), null);
  assert.ok(res.body.refreshToken);
  assert.ok(await tokenService.findRefreshToken(res.body.refreshToken));

  const refreshRes = fakeRes();
  await authController.refresh(fakeReq({ refreshToken: res.body.refreshToken }), refreshRes);
  assert.equal(refreshRes.statusCode, 200);
});
