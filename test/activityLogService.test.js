const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const repo = require('../repositories/dynamodb/activityLogDynamoRepository');
const { record, ACTIONS, RETENTION_DAYS, DETAIL_MAX, buildEntry } = require('../services/activityLogService');

afterEach(() => {
  mock.restoreAll();
});

const req = {
  user: { id: 'u1', email: 'Clerk@Shop.test', tenantId: 7 },
};

test('ttl is about 90 days ahead, detail is truncated, and secrets are dropped', async () => {
  let saved;
  mock.method(repo, 'record', async (tenantId, entry) => {
    saved = { tenantId, entry };
  });
  const now = Math.floor(Date.now() / 1000);
  await record(req, {
    action: ACTIONS.ITEM_UPDATED,
    targetId: 'p1',
    targetLabel: 'Kettle',
    detail: 'x'.repeat(200),
    password: 'hunter2',
    pin: '135790',
    pinHash: 'hashed-secret',
  });
  assert.equal(saved.tenantId, 7);
  assert.equal(saved.entry.detail.length, DETAIL_MAX);
  assert.equal(saved.entry.user_id, 'u1');
  assert.equal(saved.entry.user_email, 'clerk@shop.test');
  assert.equal(saved.entry.action, ACTIONS.ITEM_UPDATED);
  const blob = JSON.stringify(saved);
  assert.equal(blob.includes('hunter2'), false);
  assert.equal(blob.includes('135790'), false);
  assert.equal(blob.includes('hashed-secret'), false);
  assert.equal(blob.includes('password'), false);
  const expected = now + RETENTION_DAYS * 24 * 60 * 60;
  assert.ok(Math.abs(saved.entry.ttl - expected) < 5);
});

test('a repository failure does not throw', async () => {
  mock.method(repo, 'record', async () => {
    throw new Error('table unavailable');
  });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    await assert.doesNotReject(() => record(req, { action: ACTIONS.ITEM_CREATED, targetId: '1' }));
  } finally {
    console.error = original;
  }
  assert.match(errors.join('\n'), /table unavailable/);
});

test('an unknown action is not written', async () => {
  let calls = 0;
  mock.method(repo, 'record', async () => {
    calls += 1;
  });
  await record(req, { action: 'LOGIN', targetId: '1' });
  assert.equal(calls, 0);
});

test('buildEntry keeps only the activity fields', () => {
  const entry = buildEntry(req, {
    action: ACTIONS.USER_CREATED,
    targetId: '9',
    targetLabel: 'ann@shop.test',
    detail: 'TELLER',
    password: 'hunter2',
  });
  assert.deepEqual(Object.keys(entry).sort(), [
    'action',
    'created_at',
    'detail',
    'target_id',
    'target_label',
    'ttl',
    'user_email',
    'user_id',
  ]);
});
