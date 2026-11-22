const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const repo = require('../repositories/dynamodb/activityLogDynamoRepository');

afterEach(() => {
  mock.restoreAll();
});

test('record writes a time-ordered key and the ttl it was given', async () => {
  let command;
  mock.method(repo.client, 'send', async (cmd) => {
    command = cmd;
    return {};
  });
  const ttl = Math.floor(Date.now() / 1000) + repo.RETENTION_SECONDS;
  await repo.record(4, {
    action: 'ITEM_CREATED',
    target_id: '1',
    target_label: 'Kettle',
    user_id: 'u1',
    user_email: 'clerk@shop.test',
    created_at: '2026-11-22T10:00:00.000Z',
    ttl,
  });
  const item = command.input.Item;
  assert.equal(item.PK, 'TENANT#4');
  assert.match(item.SK, /^ACTIVITY_LOG#2026-11-22T10:00:00\.000Z#[0-9a-f]{4}$/);
  assert.equal(item.ttl, ttl);
  assert.equal(item.user_email, 'clerk@shop.test');
});

test('list queries one tenant, newest first, and pages with a cursor', async () => {
  const calls = [];
  mock.method(repo.client, 'send', async (cmd) => {
    calls.push(cmd.input);
    if (calls.length > 1) return { Items: [] };
    return {
      Items: [{
        PK: 'TENANT#2',
        SK: 'ACTIVITY_LOG#2026-11-22T10:00:00.000Z#ab12',
        entityType: 'ACTIVITY_LOG',
        entityId: '2026-11-22T10:00:00.000Z#ab12',
        tenantId: 2,
        action: 'ORDER_CREATED',
        target_id: 'ORD1',
        target_label: 'ORD1',
        user_id: 'teller1',
        user_email: 'teller@shop.test',
        detail: 'cash',
        createdAt: '2026-11-22T10:00:00.000Z',
        ttl: 1,
      }],
      LastEvaluatedKey: { PK: 'TENANT#2', SK: 'ACTIVITY_LOG#2026-11-22T10:00:00.000Z#ab12' },
    };
  });

  const page = await repo.list(2, {
    from: '2026-11-01',
    to: '2026-11-22',
    action: 'ORDER_CREATED',
    email: 'Teller@Shop.test',
    limit: 1,
  });
  assert.equal(calls[0].ScanIndexForward, false);
  assert.equal(calls[0].Limit, 1);
  assert.equal(calls[0].ExpressionAttributeValues[':pk'], 'TENANT#2');
  assert.equal(calls[0].ExpressionAttributeValues[':from'], 'ACTIVITY_LOG#2026-11-01T00:00:00.000Z');
  assert.equal(calls[0].ExpressionAttributeValues[':to'], 'ACTIVITY_LOG#2026-11-22T23:59:59.999Z\uffff');
  assert.equal(calls[0].ExpressionAttributeValues[':action'], 'ORDER_CREATED');
  assert.equal(calls[0].ExpressionAttributeValues[':email'], 'teller@shop.test');
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].ttl, undefined);
  assert.equal(page.items[0].user_email, 'teller@shop.test');
  assert.ok(page.nextCursor);

  await repo.list(2, { cursor: page.nextCursor, limit: 1 });
  assert.deepEqual(calls[1].ExclusiveStartKey, {
    PK: 'TENANT#2',
    SK: 'ACTIVITY_LOG#2026-11-22T10:00:00.000Z#ab12',
  });
  assert.equal(calls[1].ExpressionAttributeValues[':pk'], 'TENANT#2');
});

test('a cursor from another tenant is rejected', async () => {
  const cursor = Buffer.from(JSON.stringify({
    PK: 'TENANT#1',
    SK: 'ACTIVITY_LOG#2026-11-22T10:00:00.000Z#ab12',
  }), 'utf8').toString('base64url');
  await assert.rejects(
    () => repo.list(2, { cursor }),
    (err) => err.status === 400 && err.message === 'Invalid cursor'
  );
});

test('a reversed date range is rejected', async () => {
  await assert.rejects(
    () => repo.list(1, { from: '2026-12-01', to: '2026-11-01' }),
    (err) => err.status === 400
  );
});
