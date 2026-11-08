const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { parseInstallmentLines, MAX_INSTALLMENT_LINES } = require('../utils/installmentLines');
const { parseCashSaleBody } = require('../utils/cashSaleLines');
const productDynamoRepository = require('../repositories/dynamodb/productDynamoRepository');
const promotionDynamoRepository = require('../repositories/dynamodb/promotionDynamoRepository');
const installmentSettingDynamoRepository = require('../repositories/dynamodb/installmentSettingDynamoRepository');
const witnessDynamoRepository = require('../repositories/dynamodb/witnessDynamoRepository');
const installmentPlanDynamoRepository = require('../repositories/dynamodb/installmentPlanDynamoRepository');
const installmentPaymentDynamoRepository = require('../repositories/dynamodb/installmentPaymentDynamoRepository');
const orderDynamoRepository = require('../repositories/dynamodb/orderDynamoRepository');

const products = {
  'sku-a': { id: 'sku-a', name: 'Rice', selling_price: 100, buying_price: 40, quantity: 5, category: 'Grocery' },
  'sku-b': { id: 'sku-b', name: 'Soap', selling_price: 50, buying_price: 20, quantity: 4, category: 'Grocery' },
};

function payload(overrides = {}) {
  return {
    lines: [
      { itemId: 'sku-a', quantity: 1 },
      { itemId: 'sku-b', quantity: 2 },
    ],
    customer: { name: 'Ada', phone: '0770000001' },
    witness: { name: 'Bea', phone: '0770000002', idCardNo: 'NIC1' },
    includeWitness: true,
    downPayment: 10,
    installmentMonths: 3,
    orderNumber: 'ORD123456',
    ...overrides,
  };
}

test('installment line cap does not change the cash sale cap message', () => {
  const lines = Array.from({ length: MAX_INSTALLMENT_LINES + 1 }, (_, index) => ({
    itemId: `sku-${index}`,
    quantity: 1,
  }));
  assert.throws(
    () => parseInstallmentLines({ lines }),
    (error) => error.status === 400 && /installment sale/.test(error.message)
  );
  assert.throws(
    () => parseCashSaleBody({ lines, idempotencyKey: 'cash-bill-key-01' }),
    (error) => error.status === 400 && /cash sale/.test(error.message)
  );
});

test('installment checkout books sales, plan, payments, witness, and stock in one transaction', async (t) => {
  const writes = [];
  const originals = {
    getById: productDynamoRepository.getById,
    decrement: productDynamoRepository.decrementQuantity,
    promotions: promotionDynamoRepository.getActive,
    settings: installmentSettingDynamoRepository.getByMonths,
    witnessCreate: witnessDynamoRepository.create,
    planCreate: installmentPlanDynamoRepository.create,
    paymentCreate: installmentPaymentDynamoRepository.create,
    send: orderDynamoRepository.client.send,
  };
  t.after(() => {
    productDynamoRepository.getById = originals.getById;
    productDynamoRepository.decrementQuantity = originals.decrement;
    promotionDynamoRepository.getActive = originals.promotions;
    installmentSettingDynamoRepository.getByMonths = originals.settings;
    witnessDynamoRepository.create = originals.witnessCreate;
    installmentPlanDynamoRepository.create = originals.planCreate;
    installmentPaymentDynamoRepository.create = originals.paymentCreate;
    orderDynamoRepository.client.send = originals.send;
  });

  productDynamoRepository.getById = async (_tenantId, id) => products[String(id)] || null;
  productDynamoRepository.decrementQuantity = async () => {
    throw new Error('stock must not be deducted outside the transaction');
  };
  promotionDynamoRepository.getActive = async () => [];
  installmentSettingDynamoRepository.getByMonths = async () => ({ months: 3, interest_rate: 10 });
  witnessDynamoRepository.create = async () => {
    throw new Error('witness must be written inside the transaction');
  };
  installmentPlanDynamoRepository.create = async () => {
    throw new Error('plan must be written inside the transaction');
  };
  installmentPaymentDynamoRepository.create = async () => {
    throw new Error('payments must be written inside the transaction');
  };
  orderDynamoRepository.client.send = async (command) => {
    writes.push(command);
    return {};
  };

  const result = await orderDynamoRepository.processInstallmentSale(1, { id: 'teller-1', username: 'ada' }, payload({
    lines: [
      { itemId: 'sku-a', quantity: 1 },
      { itemId: 'sku-a', quantity: 1 },
      { itemId: 'sku-b', quantity: 2 },
    ],
  }));

  assert.equal(writes.length, 1);
  assert.ok(writes[0] instanceof TransactWriteCommand);
  const items = writes[0].input.TransactItems;
  // 2 products: sale+stock, sale+stock, plan, 3 payments, witness
  assert.equal(items.length, 9);
  assert.equal(items[1].Update.ConditionExpression, 'quantity >= :qty');
  assert.equal(items[1].Update.ExpressionAttributeValues[':qty'], 2);
  assert.equal(items[3].Update.ExpressionAttributeValues[':qty'], 2);
  assert.equal(items[1].Update.Key.SK, productDynamoRepository.sk('sku-a'));
  assert.equal(result.sales.length, 2);
  assert.equal(result.sales[0].quantity, 2);
  assert.equal(result.payments.length, 3);
  assert.equal(result.plan.status, 'active');
  assert.equal(result.plan.paid_amount, 0);
  assert.ok(result.plan.witness_id);
  assert.equal(result.plan.sale_ids.length, 2);
  assert.equal(items[8].Put.Item.id_card_no, 'NIC1');
  assert.equal(items[4].Put.Item.entityType, 'INSTALLMENT_PLAN');
});

test('a lost stock race cancels the bill and reports the product that ran out', async (t) => {
  const originals = {
    getById: productDynamoRepository.getById,
    send: orderDynamoRepository.client.send,
    promotions: promotionDynamoRepository.getActive,
    settings: installmentSettingDynamoRepository.getByMonths,
  };
  t.after(() => {
    productDynamoRepository.getById = originals.getById;
    orderDynamoRepository.client.send = originals.send;
    promotionDynamoRepository.getActive = originals.promotions;
    installmentSettingDynamoRepository.getByMonths = originals.settings;
  });

  let reads = 0;
  productDynamoRepository.getById = async (_tenantId, id) => {
    reads += 1;
    if (reads > 2) return { ...products[String(id)], quantity: 0 };
    return products[String(id)] || null;
  };
  promotionDynamoRepository.getActive = async () => [];
  installmentSettingDynamoRepository.getByMonths = async () => ({ months: 3, interest_rate: 10 });
  orderDynamoRepository.client.send = async () => {
    const error = new Error('cancelled');
    error.name = 'TransactionCanceledException';
    error.CancellationReasons = [
      { Code: 'None' },
      { Code: 'None' },
      { Code: 'None' },
      { Code: 'ConditionalCheckFailed' },
    ];
    throw error;
  };

  await assert.rejects(
    () => orderDynamoRepository.processInstallmentSale(1, { id: 'teller-1', username: 'ada' }, payload()),
    (error) => error.status === 400 && error.message === 'Insufficient stock for Soap' && error.available === 0
  );
});

after(() => {
  orderDynamoRepository.client.destroy();
});
