const harness = require('./helpers/dynamoTestTable');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

let ready = false;
let admin;
let products;
let orders;
let plans;
let settings;
let customerService;
const T = 9500;
const user = { id: 'teller-1', username: 'ada' };

before(async () => {
  ready = await harness.isReachable();
  if (!ready) return;
  admin = await harness.createTable();
  products = require('../repositories/dynamodb/productDynamoRepository');
  orders = require('../repositories/dynamodb/orderDynamoRepository');
  plans = require('../repositories/dynamodb/installmentPlanDynamoRepository');
  settings = require('../repositories/dynamodb/installmentSettingDynamoRepository');
  customerService = require('../services/customerService');
  await settings.upsert(T, 3, 0);
  await products.create(T, { id: 'p1', name: 'Fan', sellingPrice: 100, buyingPrice: 60, quantity: 100, returnQuantity: 0 });
});

after(async () => {
  if (!ready) return;
  await harness.dropTable(admin);
  orders.client.destroy();
});

const it = (name, fn) =>
  test(name, async (t) => {
    if (!ready) return t.skip('DynamoDB Local is not running');
    return fn(t);
  });

const sellWalkIn = async (name, phone, lines = 1) => {
  await orders.processInstallmentSale(T, user, {
    lines: Array.from({ length: lines }, () => ({ itemId: 'p1', quantity: 1 })),
    customer: { name, phone },
    includeWitness: false,
    downPayment: 10,
    installmentMonths: 3,
  });
  return (await plans.getAll(T)).find((p) => p.customer_name === name);
};

const saleRow = (id) => orders.getById(T, id);

it('registering the phone in CRM links the earlier walk-in plan and its sale rows', async () => {
  const plan = await sellWalkIn('Walk A', '0772000001', 2);
  assert.equal(plan.customer_id, null);
  assert.equal(plan.sale_ids.length, 2);

  const member = await customerService.create(T, { name: 'Walk A', phone: '077 200 0001' });

  const linked = await plans.getById(T, plan.id);
  assert.equal(linked.customer_id, member.id);
  for (const id of plan.sale_ids) assert.equal((await saleRow(id)).customer_id, member.id);

  const page = await customerService.getById(T, member.id);
  assert.equal(page.plans.length, 1);
  assert.equal(page.open_plans_count, 1);
});

it('only plans with the same phone are linked; others stay walk-in', async () => {
  const mine = await sellWalkIn('Walk B', '0772000002');
  const other = await sellWalkIn('Walk C', '0772000003');
  const member = await customerService.create(T, { name: 'Walk B', phone: '0772000002' });
  assert.equal((await plans.getById(T, mine.id)).customer_id, member.id);
  assert.equal((await plans.getById(T, other.id)).customer_id, null);
});

it('a plan already linked to a member is never moved to someone else', async () => {
  const first = await customerService.create(T, { name: 'Owner D', phone: '0772000004' });
  await orders.processInstallmentSale(T, user, {
    lines: [{ itemId: 'p1', quantity: 1 }],
    customer: { name: 'Owner D', phone: '0772000004', memberId: first.id },
    includeWitness: false,
    downPayment: 10,
    installmentMonths: 3,
  });
  const plan = (await plans.getAll(T)).find((p) => p.customer_id === first.id);
  assert.ok(plan);
  const second = await customerService.create(T, { name: 'Other E', phone: '0772000005' });
  await customerService.attachWalkInPlans(T, { ...second, phone: '0772000004' }, 'LK');
  assert.equal((await plans.getById(T, plan.id)).customer_id, first.id);
});

it('changing a member phone to a number with walk-in plans links them, and repeating is harmless', async () => {
  const plan = await sellWalkIn('Walk F', '0772000006');
  const member = await customerService.create(T, { name: 'Member F', phone: '0772000007' });
  assert.equal((await plans.getById(T, plan.id)).customer_id, null);

  await customerService.update(T, member.id, { phone: '0772000006' });
  assert.equal((await plans.getById(T, plan.id)).customer_id, member.id);

  await customerService.update(T, member.id, { phone: '0772000006', name: 'Member F2' });
  assert.equal((await plans.getById(T, plan.id)).customer_id, member.id);
});

it('a member created with no matching walk-in plans is unaffected', async () => {
  const member = await customerService.create(T, { name: 'Lonely G', phone: '0772000008' });
  const page = await customerService.getById(T, member.id);
  assert.equal(page.plans.length, 0);
});

it('a failure while linking never blocks saving the customer', async () => {
  const original = require('../services/installmentPlanService').getAll;
  require('../services/installmentPlanService').getAll = async () => {
    throw new Error('boom');
  };
  try {
    const member = await customerService.create(T, { name: 'Safe H', phone: '0772000009' });
    assert.ok(member.id);
  } finally {
    require('../services/installmentPlanService').getAll = original;
  }
});
