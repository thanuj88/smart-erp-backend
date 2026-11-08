const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  findSecretProblems,
  assertSecureConfig,
  isWeakSecret,
  isStrongAdminPassword,
  isLocalEnvironment,
} = require('../config/secrets');

const strong = 'k9Jx2mQ7vB4nR8tY1wZ5cL0pD3fH6sA9uE2gN7';
const strongRefresh = 'Zr4Tq8Wm1Xc6Vb3Nk9Lh2Jd5Fs0Pa7Ge4Yu1Ro8';

test('local environments are development and test only', () => {
  assert.equal(isLocalEnvironment({ NODE_ENV: 'development' }), true);
  assert.equal(isLocalEnvironment({ NODE_ENV: 'test' }), true);
  for (const NODE_ENV of ['production', 'staging', '', undefined]) {
    assert.equal(isLocalEnvironment({ NODE_ENV }), false, String(NODE_ENV));
  }
});

test('the repo placeholders and the code fallback count as weak secrets', () => {
  assert.equal(isWeakSecret('default_secret_change_in_production'), true);
  assert.equal(isWeakSecret('your_super_secret_jwt_key_change_this_in_production'), true);
  assert.equal(isWeakSecret('your_refresh_secret'), true);
  assert.equal(isWeakSecret('short'), true);
  assert.equal(isWeakSecret(undefined), true);
  assert.equal(isWeakSecret(strong), false);
});

test('a deployed environment on placeholder or missing secrets has problems', () => {
  for (const NODE_ENV of ['production', 'staging', undefined]) {
    assert.ok(findSecretProblems({ NODE_ENV }).length >= 2, `NODE_ENV=${NODE_ENV}`);
    assert.ok(
      findSecretProblems({
        NODE_ENV,
        JWT_SECRET: 'default_secret_change_in_production',
        JWT_REFRESH_SECRET: 'your_refresh_secret',
      }).length >= 2
    );
  }
});

test('refresh secret must be set and different from the access secret', () => {
  assert.ok(findSecretProblems({ NODE_ENV: 'production', JWT_SECRET: strong }).length === 1);
  assert.ok(
    findSecretProblems({ NODE_ENV: 'production', JWT_SECRET: strong, JWT_REFRESH_SECRET: strong })
      .some((problem) => /differ/.test(problem))
  );
});

test('strong distinct secrets pass in production', () => {
  assert.deepEqual(
    findSecretProblems({ NODE_ENV: 'production', JWT_SECRET: strong, JWT_REFRESH_SECRET: strongRefresh }),
    []
  );
  assert.doesNotThrow(() =>
    assertSecureConfig({ NODE_ENV: 'production', JWT_SECRET: strong, JWT_REFRESH_SECRET: strongRefresh })
  );
});

test('local development keeps working with the example placeholders', () => {
  assert.deepEqual(
    findSecretProblems({ NODE_ENV: 'development', JWT_SECRET: 'your_super_secret_jwt_key_change_this_in_production' }),
    []
  );
});

test('assertSecureConfig names the environment and every problem', () => {
  assert.throws(
    () => assertSecureConfig({ NODE_ENV: 'production' }),
    (error) => /NODE_ENV="production"/.test(error.message) && /JWT_SECRET/.test(error.message) && /JWT_REFRESH_SECRET/.test(error.message)
  );
  assert.throws(() => assertSecureConfig({}), /NODE_ENV=\(unset\)/);
});

test('the demo super admin password is never acceptable for a deployment', () => {
  assert.equal(isStrongAdminPassword('superadmin123'), false);
  assert.equal(isStrongAdminPassword('short'), false);
  assert.equal(isStrongAdminPassword(undefined), false);
  assert.equal(isStrongAdminPassword('a-long-unique-passphrase'), true);
});

test('server.js refuses to boot in production on the default JWT secret', () => {
  const serverFile = path.join(__dirname, '..', 'server.js');
  const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(serverFile)})`], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      JWT_SECRET: 'default_secret_change_in_production',
      JWT_REFRESH_SECRET: 'your_refresh_secret',
      PORT: '0',
    },
    encoding: 'utf8',
    timeout: 20000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to start/);
  assert.doesNotMatch(result.stdout, /Server running/);
});

test('server.js no longer prints demo credentials on boot', () => {
  const source = require('fs').readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(source, /superadmin123|admin123|teller123|manager123|accountant123|Default credentials/);
});

// scripts/ is gitignored in this repo, so a fresh clone has no seed script to check.
const seedFile = path.join(__dirname, '..', 'scripts', 'seedDynamo.js');
test('the seed script never prints passwords or PINs', { skip: !require('fs').existsSync(seedFile) && 'scripts/seedDynamo.js is not in this checkout' }, () => {
  const source = require('fs').readFileSync(seedFile, 'utf8');
  const logLines = source.split(/\r?\n/).filter((line) => /console\.(log|info|warn)/.test(line));
  assert.ok(logLines.length > 0);
  for (const line of logLines) {
    assert.doesNotMatch(line, /\$\{[^}]*(password|pin)[^}]*\}/i, line);
  }
});
