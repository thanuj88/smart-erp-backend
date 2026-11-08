const harness = require('./helpers/dynamoTestTable');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

let ready = false;
let admin;
let products;
let orders;
let plans;
let customers;
let settings;
const T = 9300;
const user = { id: 'teller-1', username: 'ada' };

before(async () => {
  ready = await harness.isReachable();
  if (!ready) return;
  admin = await harness.createTable();
  products = require('../repositories/dynamodb/productDynamoRepository');
  orders = require('../repositories/dynamodb/orderDynamoRepository');
  plans = require('../repositories/dynamodb/installmentPlanDynamoRepository');
  customers = require('../repositories/dynamodb/customerDynamoRepository');
  settings = require('../repositories/dynamodb/installmentSettingDynamoRepository');
  await settings.upsert(T, 3, 0);
  await products.create(T, { id: 'p1', name: 'Fan', sellingPrice: 100, buyingPrice: 60, quantity: 50, returnQuantity: 0 });
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

const sell = (customer) =>
  orders.processInstallmentSale(T, user, {
    lines: [{ itemId: 'p1', quantity: 1 }],
    customer,
    includeWitness: false,
    downPayment: 10,
    installmentMonths: 3,
  });

const activePlanFor = async (orderNumberOrName) => {
  const active = await plans.getActive(T);
  return active.find((p) => p.customer_name === orderNumberOrName);
};

it('a walk-in installment keeps the NIC typed at the till on the plan', async () => {
  await sell({ name: 'Walker', phone: '0771110001', idCardNo: '901234567V' });
  const plan = await activePlanFor('Walker');
  assert.equal(plan.customer_id_card, '901234567V');
  assert.equal(plan.customer_id, null);
});

it('a walk-in without a NIC leaves it empty, not undefined or crashing', async () => {
  await sell({ name: 'NoNic', phone: '0771110002' });
  const plan = await activePlanFor('NoNic');
  assert.equal(plan.customer_id_card, null);
});

it('a plan for a CRM member carries the member NIC from the CRM record', async () => {
  const member = await customers.create(T, { name: 'Member M', phone: '0771110003', idCardNo: '851234567V' });
  await sell({ name: 'typed differently', phone: member.phone, idCardNo: '000000000V', memberId: member.id });
  const plan = await activePlanFor('Member M');
  assert.equal(plan.customer_id_card, '851234567V', 'CRM record wins over what was typed');
});

it('an older member plan with no stored NIC is filled from the CRM on read', async () => {
  const member = await customers.create(T, { name: 'Old Member', phone: '0771110004', idCardNo: '751234567V' });
  const created = await plans.create(T, {
    sale_id: 's-old',
    customer_id: member.id,
    customer_name: 'Old Member',
    customer_phone: member.phone,
    total_amount: 100,
    down_payment: 10,
    remaining_amount: 90,
    interest_rate: 0,
    interest_amount: 0,
    total_with_interest: 90,
    installment_months: 3,
    monthly_payment: 30,
  });
  assert.equal(created.customer_id_card, '751234567V');
  const listed = (await plans.getActive(T)).find((p) => p.id === created.id);
  assert.equal(listed.customer_id_card, '751234567V');
});

it('a plan with no customer at all is returned as is', async () => {
  const created = await plans.create(T, { sale_id: 's-none', total_amount: 1, down_payment: 0, remaining_amount: 1,
    interest_rate: 0, interest_amount: 0, total_with_interest: 1, installment_months: 1, monthly_payment: 1 });
  assert.equal(created.customer_name, null);
  assert.equal(created.customer_id_card, null);
});
