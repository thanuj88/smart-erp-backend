const harness = require('./helpers/dynamoTestTable');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

let ready = false;
let admin;
let products;
let orders;
let plans;
let payments;
let returns;
let tenantSeq = 9100;

const user = { id: 'teller-1', username: 'ada' };

before(async () => {
  ready = await harness.isReachable();
  if (!ready) return;
  admin = await harness.createTable();
  products = require('../repositories/dynamodb/productDynamoRepository');
  orders = require('../repositories/dynamodb/orderDynamoRepository');
  plans = require('../repositories/dynamodb/installmentPlanDynamoRepository');
  payments = require('../repositories/dynamodb/installmentPaymentDynamoRepository');
  returns = require('../repositories/dynamodb/returnDynamoRepository');
});

after(async () => {
  if (!ready) return;
  await harness.dropTable(admin);
  orders.client.destroy();
});

// Decided at run time: `ready` is only known once `before` has probed DynamoDB Local.
const it = (name, fn) =>
  test(name, async (t) => {
    if (!ready) return t.skip('DynamoDB Local is not running');
    return fn(t);
  });

async function seedProduct(tenantId, id, { quantity = 10, returnQuantity = 0 } = {}) {
  await products.create(tenantId, {
    id,
    name: `Item ${id}`,
    sellingPrice: 100,
    buyingPrice: 60,
    quantity,
    returnQuantity,
  });
}

async function seedSale(tenantId, saleId, orderNumber, itemId, quantity, paymentType = 'cash') {
  await orders.put(tenantId, saleId, {
    item_id: itemId,
    item_name: `Item ${itemId}`,
    quantity,
    buying_price: 60,
    selling_price: 100,
    price: 100,
    charged_unit_price: 100,
    total: 100 * quantity,
    profit: 40 * quantity,
    payment_type: paymentType,
    returned_qty: 0,
    order_number: orderNumber,
    teller_id: user.id,
    teller_name: user.username,
    sale_date: new Date().toISOString(),
  });
}

async function seedPlan(tenantId, orderNumber, saleIds) {
  const plan = await plans.create(tenantId, {
    sale_id: saleIds[0],
    sale_ids: saleIds,
    order_number: orderNumber,
    customer_name: 'Ada',
    customer_phone: '0770000001',
    total_amount: 300,
    down_payment: 60,
    remaining_amount: 240,
    interest_rate: 0,
    interest_amount: 0,
    total_with_interest: 240,
    installment_months: 3,
    monthly_payment: 80,
  });
  const rows = [];
  for (let i = 1; i <= 3; i += 1) {
    rows.push(
      await payments.create(tenantId, {
        installment_plan_id: plan.id,
        payment_number: i,
        amount_due: 80,
        due_date: `2027-0${i}-01`,
      })
    );
  }
  return { plan, rows };
}

it('cash return books everything in one transaction', async () => {
  const tenantId = (tenantSeq += 1);
  await seedProduct(tenantId, 'p1', { quantity: 5 });
  await seedSale(tenantId, 's1', 'ORD000101', 'p1', 2);

  const result = await orders.processReturn(tenantId, user, {
    orderNumber: 'ORD000101',
    lines: [{ saleId: 's1', quantity: 2 }],
    returnType: 'cash',
  });

  assert.equal(result.refund_cash, 200);
  const product = await products.getById(tenantId, 'p1');
  assert.equal(product.return_quantity, 2);
  assert.equal(product.quantity, 5);
  const sale = await orders.getById(tenantId, 's1');
  assert.equal(sale.returned_qty, 2);
  assert.equal((await returns.getAll(tenantId)).length, 1);
  const ledger = (await orders.getAll(tenantId)).filter((row) => row.is_return);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].total, -200);
});

it('the same unit cannot be returned twice, even in parallel', async () => {
  const tenantId = (tenantSeq += 1);
  await seedProduct(tenantId, 'p1', { quantity: 5 });
  await seedSale(tenantId, 's1', 'ORD000102', 'p1', 1);

  const attempt = () =>
    orders.processReturn(tenantId, user, {
      orderNumber: 'ORD000102',
      lines: [{ saleId: 's1', quantity: 1 }],
      returnType: 'cash',
    });
  const outcomes = await Promise.allSettled([attempt(), attempt(), attempt()]);

  assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
  assert.ok(outcomes.filter((o) => o.status === 'rejected').every((o) => [400, 409].includes(o.reason.status)));
  const product = await products.getById(tenantId, 'p1');
  assert.equal(product.return_quantity, 1);
  assert.equal((await returns.getAll(tenantId)).length, 1);
});

it('two sale lines of one product restock return stock once per unit', async () => {
  const tenantId = (tenantSeq += 1);
  await seedProduct(tenantId, 'p1', { quantity: 5 });
  await seedSale(tenantId, 's1', 'ORD000103', 'p1', 2);
  await seedSale(tenantId, 's2', 'ORD000103', 'p1', 3);

  await orders.processReturn(tenantId, user, {
    orderNumber: 'ORD000103',
    lines: [
      { saleId: 's1', quantity: 2 },
      { saleId: 's2', quantity: 1 },
    ],
    returnType: 'defect',
  });

  const product = await products.getById(tenantId, 'p1');
  assert.equal(product.return_quantity, 3);
});

it('warranty swaps from sellable stock and never goes negative', async () => {
  const tenantId = (tenantSeq += 1);
  await seedProduct(tenantId, 'p1', { quantity: 1 });
  await seedSale(tenantId, 's1', 'ORD000104', 'p1', 2);

  await assert.rejects(
    () =>
      orders.processReturn(tenantId, user, {
        orderNumber: 'ORD000104',
        lines: [{ saleId: 's1', quantity: 2 }],
        returnType: 'warranty',
      }),
    (error) => error.status === 400 && /sellable stock/.test(error.message)
  );
  let product = await products.getById(tenantId, 'p1');
  assert.equal(product.quantity, 1);
  assert.equal(product.return_quantity, 0);
  assert.equal((await orders.getById(tenantId, 's1')).returned_qty, 0);

  await orders.processReturn(tenantId, user, {
    orderNumber: 'ORD000104',
    lines: [{ saleId: 's1', quantity: 1 }],
    returnType: 'warranty',
  });
  product = await products.getById(tenantId, 'p1');
  assert.equal(product.quantity, 0);
  assert.equal(product.return_quantity, 1);
});

it('a warranty race on the last replacement unit cancels the whole return', async () => {
  const tenantId = (tenantSeq += 1);
  await seedProduct(tenantId, 'p1', { quantity: 1 });
  await seedSale(tenantId, 's1', 'ORD000105', 'p1', 1);
  await seedSale(tenantId, 's2', 'ORD000106', 'p1', 1);

  const claim = (orderNumber, saleId) =>
    orders.processReturn(tenantId, user, {
      orderNumber,
      lines: [{ saleId, quantity: 1 }],
      returnType: 'warranty',
    });
  const outcomes = await Promise.allSettled([claim('ORD000105', 's1'), claim('ORD000106', 's2')]);

  assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
  const product = await products.getById(tenantId, 'p1');
  assert.equal(product.quantity, 0);
  assert.equal(product.return_quantity, 1);
  const returned = (await orders.getAll(tenantId)).filter((row) => !row.is_return && row.returned_qty > 0);
  assert.equal(returned.length, 1);
});

it('defect return on an installment reduces what the customer owes, with no cash', async () => {
  const tenantId = (tenantSeq += 1);
  await seedProduct(tenantId, 'p1', { quantity: 5 });
  await seedSale(tenantId, 's1', 'ORD000107', 'p1', 1, 'installment');
  await seedSale(tenantId, 's2', 'ORD000107', 'p1', 2, 'installment');
  const { plan } = await seedPlan(tenantId, 'ORD000107', ['s1', 's2']);

  const result = await orders.processReturn(tenantId, user, {
    orderNumber: 'ORD000107',
    lines: [{ saleId: 's1', quantity: 1 }],
    returnType: 'defect',
  });

  assert.equal(result.refund_cash, 0);
  assert.equal(result.installment_adjustment.status, 'adjusted');
  const updatedPlan = await plans.getById(tenantId, plan.id);
  assert.equal(updatedPlan.status, 'adjusted');
  assert.equal(updatedPlan.remaining_amount, 140);
  const rows = await payments.getByPlanId(tenantId, plan.id);
  assert.ok(rows.every((row) => Math.abs(row.amount_due - 140 / 3) < 0.001));
});

it('defect return of the whole installment order cancels the plan', async () => {
  const tenantId = (tenantSeq += 1);
  await seedProduct(tenantId, 'p1', { quantity: 5 });
  await seedSale(tenantId, 's1', 'ORD000108', 'p1', 3, 'installment');
  const { plan } = await seedPlan(tenantId, 'ORD000108', ['s1']);

  const result = await orders.processReturn(tenantId, user, {
    orderNumber: 'ORD000108',
    lines: [{ saleId: 's1', quantity: 3 }],
    returnType: 'defect',
  });

  assert.equal(result.refund_cash, 0);
  assert.equal((await plans.getById(tenantId, plan.id)).status, 'cancelled');
  const rows = await payments.getByPlanId(tenantId, plan.id);
  assert.ok(rows.every((row) => row.status === 'cancelled'));
});

it('warranty on an installment leaves the plan alone', async () => {
  const tenantId = (tenantSeq += 1);
  await seedProduct(tenantId, 'p1', { quantity: 5 });
  await seedSale(tenantId, 's1', 'ORD000109', 'p1', 1, 'installment');
  const { plan } = await seedPlan(tenantId, 'ORD000109', ['s1']);

  await orders.processReturn(tenantId, user, {
    orderNumber: 'ORD000109',
    lines: [{ saleId: 's1', quantity: 1 }],
    returnType: 'warranty',
  });

  const unchanged = await plans.getById(tenantId, plan.id);
  assert.equal(unchanged.status, 'active');
  const rows = await payments.getByPlanId(tenantId, plan.id);
  assert.ok(rows.every((row) => row.status === 'pending' && row.amount_due === 80));
});

it('a failed return leaves the plan, stock and sale untouched', async () => {
  const tenantId = (tenantSeq += 1);
  await seedProduct(tenantId, 'p1', { quantity: 5 });
  await seedSale(tenantId, 's1', 'ORD000110', 'p1', 1, 'installment');
  const { plan } = await seedPlan(tenantId, 'ORD000110', ['s1']);

  // Another till collects a payment between our read and our write.
  const original = payments.getByPlanId.bind(payments);
  payments.getByPlanId = async (...args) => {
    const rows = await original(...args);
    await payments.update(tenantId, rows[0].id, { status: 'paid' });
    return rows;
  };
  try {
    await assert.rejects(
      () =>
        orders.processReturn(tenantId, user, {
          orderNumber: 'ORD000110',
          lines: [{ saleId: 's1', quantity: 1 }],
          returnType: 'cash',
        }),
      (error) => error.status === 409
    );
  } finally {
    payments.getByPlanId = original;
  }

  assert.equal((await orders.getById(tenantId, 's1')).returned_qty, 0);
  assert.equal((await products.getById(tenantId, 'p1')).return_quantity, 0);
  assert.equal((await plans.getById(tenantId, plan.id)).status, 'active');
  assert.equal((await returns.getAll(tenantId)).length, 0);
});

it('release moves units from return stock to the floor atomically', async () => {
  const tenantId = (tenantSeq += 1);
  await seedProduct(tenantId, 'p1', { quantity: 3, returnQuantity: 4 });

  const released = await products.releaseReturnQuantity(tenantId, 'p1', 3);
  assert.equal(released.quantity, 6);
  assert.equal(released.return_quantity, 1);

  await assert.rejects(
    () => products.releaseReturnQuantity(tenantId, 'p1', 2),
    (error) => error.status === 400 && error.available === 1
  );
  const unchanged = await products.getById(tenantId, 'p1');
  assert.equal(unchanged.quantity, 6);
  assert.equal(unchanged.return_quantity, 1);
});

it('parallel releases can never move more than return stock holds', async () => {
  const tenantId = (tenantSeq += 1);
  await seedProduct(tenantId, 'p1', { quantity: 0, returnQuantity: 5 });

  const outcomes = await Promise.allSettled(
    Array.from({ length: 4 }, () => products.releaseReturnQuantity(tenantId, 'p1', 2))
  );

  assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 2);
  const product = await products.getById(tenantId, 'p1');
  assert.equal(product.quantity, 4);
  assert.equal(product.return_quantity, 1);
});

it('editing an item never rewrites return stock', async () => {
  const tenantId = (tenantSeq += 1);
  await seedProduct(tenantId, 'p1', { quantity: 3, returnQuantity: 4 });

  const updated = await products.update(tenantId, 'p1', {
    name: 'Renamed',
    quantity: 9,
    returnQuantity: 0,
  });

  assert.equal(updated.name, 'Renamed');
  assert.equal(updated.quantity, 9);
  assert.equal(updated.return_quantity, 4);
});

it('stock helpers are conditional, not read then write', async () => {
  const tenantId = (tenantSeq += 1);
  await seedProduct(tenantId, 'p1', { quantity: 2 });

  const outcomes = await Promise.allSettled([
    products.decrementQuantity(tenantId, 'p1', 2),
    products.decrementQuantity(tenantId, 'p1', 2),
  ]);

  assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
  assert.equal((await products.getById(tenantId, 'p1')).quantity, 0);
});
