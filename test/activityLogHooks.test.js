const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const productService = require('../services/productService');
const orderService = require('../services/orderService');
const staffUserService = require('../services/staffUserService');
const authRepo = require('../repositories/dynamodb/authDynamoRepository');
const repo = require('../repositories/dynamodb/activityLogDynamoRepository');
const itemController = require('../controllers/itemController');
const saleController = require('../controllers/saleController');
const userController = require('../controllers/userController');
const { ACTIONS } = require('../services/activityLogService');

afterEach(() => {
  mock.restoreAll();
});

function response() {
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

function capture() {
  const logs = [];
  mock.method(repo, 'record', async (tenantId, entry) => {
    logs.push({ tenantId, entry });
  });
  return logs;
}

const clerk = {
  user: { id: 'c1', email: 'clerk@shop.test', tenantId: 3, role: 'INVENTORY' },
};

test('creating, editing and deleting an item each write one log row', async () => {
  const logs = capture();
  mock.method(productService, 'create', async () => ({ id: '42', name: 'Kettle' }));
  const created = response();
  await itemController.createItem({
    ...clerk,
    body: { name: 'Kettle', sellingPrice: 10, quantity: 2 },
  }, created);
  assert.equal(created.statusCode, 201);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].tenantId, 3);
  assert.equal(logs[0].entry.action, ACTIONS.ITEM_CREATED);
  assert.equal(logs[0].entry.target_id, '42');
  assert.equal(logs[0].entry.target_label, 'Kettle');
  assert.equal(logs[0].entry.user_email, 'clerk@shop.test');

  const existing = {
    id: '42',
    name: 'Kettle',
    description: '',
    buying_price: 4,
    selling_price: 10,
    quantity: 5,
    category: 'Home',
    category_id: 'c1',
    image_path: null,
    barcode: '',
  };
  mock.method(productService, 'getById', async () => existing);
  mock.method(productService, 'update', async () => ({ ...existing, quantity: 8 }));
  const updated = response();
  await itemController.updateItem({
    ...clerk,
    params: { id: '42' },
    body: { quantity: 8, sellingPrice: 10 },
  }, updated);
  assert.equal(updated.statusCode, 200);
  assert.equal(logs.length, 2);
  assert.equal(logs[1].entry.action, ACTIONS.ITEM_UPDATED);
  assert.equal(logs[1].entry.detail, 'quantity');

  mock.method(productService, 'delete', async () => true);
  const deleted = response();
  await itemController.deleteItem({ ...clerk, params: { id: '42' } }, deleted);
  assert.equal(deleted.statusCode, 200);
  assert.equal(logs.length, 3);
  assert.equal(logs[2].entry.action, ACTIONS.ITEM_DELETED);
  assert.equal(logs[2].entry.target_label, 'Kettle');
});

test('a failed item create does not write a log', async () => {
  const logs = capture();
  mock.method(productService, 'create', async () => {
    throw new Error('down');
  });
  const res = response();
  await itemController.createItem({
    ...clerk,
    body: { name: 'Kettle', sellingPrice: 10, quantity: 1 },
  }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(logs.length, 0);
});

test('a cash sale is logged once and a replay is not logged again', async () => {
  const logs = capture();
  const teller = {
    user: { id: 't1', email: 'teller@shop.test', tenantId: 3, role: 'TELLER' },
    body: {
      lines: [{ itemId: '1', quantity: 1 }],
      idempotencyKey: 'idem-key-1',
    },
  };
  mock.method(orderService, 'processCashSale', async () => ({
    order_number: 'ORD100',
    replayed: false,
  }));
  const created = response();
  await saleController.processCashSale(teller, created);
  assert.equal(created.statusCode, 201);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].entry.action, ACTIONS.ORDER_CREATED);
  assert.equal(logs[0].entry.target_id, 'ORD100');
  assert.equal(logs[0].entry.detail, 'cash');
  assert.equal(logs[0].entry.user_email, 'teller@shop.test');

  mock.method(orderService, 'processCashSale', async () => ({
    order_number: 'ORD100',
    replayed: true,
  }));
  const replayed = response();
  await saleController.processCashSale(teller, replayed);
  assert.equal(replayed.statusCode, 200);
  assert.equal(logs.length, 1);
});

test('staff create, edit and delete log the person but never the password or PIN', async () => {
  const logs = capture();
  const admin = {
    user: { id: 'owner', email: 'owner@shop.test', tenantId: 4, role: 'TENANT_ADMIN', branchId: null },
  };
  mock.method(staffUserService, 'prepareStaffUserCreate', async () => ({
    finalUsername: 'shop-ann',
    normalizedEmail: 'ann@shop.test',
  }));
  mock.method(authRepo, 'createStaffUser', async () => ({
    id: '11',
    email: 'ann@shop.test',
    tenant_id: 4,
    role: 'TELLER',
    username: 'shop-ann',
  }));
  const created = response();
  await userController.createUser({
    ...admin,
    body: {
      email: 'ann@shop.test',
      password: 'hunter2-password',
      role: 'TELLER',
      pin: '135790',
    },
  }, created);
  assert.equal(created.statusCode, 201);
  assert.equal(logs[0].entry.action, ACTIONS.USER_CREATED);
  assert.equal(logs[0].entry.target_label, 'ann@shop.test');
  assert.equal(logs[0].entry.detail, 'TELLER');
  assert.equal(JSON.stringify(logs).includes('hunter2-password'), false);
  assert.equal(JSON.stringify(logs).includes('135790'), false);

  mock.method(authRepo, 'findUserById', async () => ({
    id: '11',
    tenant_id: 4,
    email: 'ann@shop.test',
    username: 'shop-ann',
    role: 'TELLER',
    full_name: 'Ann',
  }));
  mock.method(authRepo, 'updateStaffUser', async () => ({
    id: '11',
    email: 'ann@shop.test',
    role: 'TELLER',
    username: 'shop-ann',
  }));
  const updated = response();
  await userController.updateUser({
    ...admin,
    params: { id: '11' },
    body: { pin: '135790', fullName: 'Ann Lee' },
  }, updated);
  assert.equal(updated.statusCode, 200);
  assert.equal(logs[1].entry.action, ACTIONS.USER_UPDATED);
  assert.equal(logs[1].tenantId, 4);
  assert.match(logs[1].entry.detail, /fullName/);
  assert.match(logs[1].entry.detail, /pin/);
  assert.equal(logs[1].entry.detail.includes('135790'), false);

  mock.method(authRepo, 'softDeleteStaffUser', async () => true);
  const deleted = response();
  await userController.deleteUser({ ...admin, params: { id: '11' } }, deleted);
  assert.equal(deleted.statusCode, 200);
  assert.equal(logs[2].entry.action, ACTIONS.USER_DELETED);
  assert.equal(logs[2].entry.target_label, 'ann@shop.test');
  assert.equal(JSON.stringify(logs).includes('135790'), false);
});
