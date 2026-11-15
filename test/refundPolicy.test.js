const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  aboveWarrantyThreshold,
  normalizeRefundWindowDays,
  normalizeCashRefundApprovalThreshold,
  decideReturn,
  buildRefundReport,
  REASON_REQUIRED,
  WARRANTY_REQUIRED,
  RECEIPT_REQUIRED,
  RECEIPT_MISMATCH,
  PIN_REQUIRED,
  PIN_REJECTED,
  WINDOW_OFF,
  NO_SALE_DATE,
} = require('../utils/refundPolicy');

const comparePin = async (pin, hash) => pin === hash;
const NOW = new Date('2026-06-15T12:00:00.000Z');

const manager = {
  id: 'mgr-1',
  username: 'maya',
  full_name: 'Maya Perera',
  role: 'MANAGER',
  is_active: 1,
  pin_hash: '654321',
};

const otherManager = {
  id: 'mgr-2',
  username: 'nimal',
  full_name: 'Nimal Silva',
  role: 'TENANT_ADMIN',
  is_active: 1,
  pin_hash: '654321',
};

function order(saleDate, total = 80) {
  return {
    order_number: 'ORD000101',
    sale_date: saleDate,
    lines: [
      {
        id: 's1',
        item_name: 'Kettle',
        quantity: 1,
        returned_qty: 0,
        returnable_qty: 1,
        unit_price: total,
        total,
      },
    ],
  };
}

function request(overrides = {}) {
  return {
    order: order('2026-06-01T12:00:00.000Z'),
    lines: [{ saleId: 's1', quantity: 1 }],
    reason: 'Customer changed their mind',
    returnType: 'cash',
    currencyCode: 'EUR',
    refundWindowDays: 30,
    cashRefundApprovalThreshold: 0,
    managerPin: '654321',
    users: [manager],
    sellerId: 'teller-1',
    comparePin,
    now: NOW,
    ...overrides,
  };
}

describe('€50 warranty threshold', () => {
  it('treats amounts above €50 as high value and leaves €50 itself below', () => {
    assert.equal(aboveWarrantyThreshold(50, 'EUR'), false);
    assert.equal(aboveWarrantyThreshold(50.01, 'EUR'), true);
    assert.equal(aboveWarrantyThreshold(54, 'USD'), false);
    assert.equal(aboveWarrantyThreshold(54.01, 'USD'), true);
    assert.equal(aboveWarrantyThreshold(16500, 'LKR'), false);
    assert.equal(aboveWarrantyThreshold(16501.66, 'LKR'), true);
  });
});

describe('refund settings', () => {
  it('defaults the window to 30 days and the cash approval threshold to 0', () => {
    assert.equal(normalizeRefundWindowDays(undefined), 30);
    assert.equal(normalizeRefundWindowDays(14.2), 14);
    assert.equal(normalizeRefundWindowDays(-4), 0);
    assert.equal(normalizeRefundWindowDays(99999), 3650);
    assert.equal(normalizeCashRefundApprovalThreshold(undefined), 0);
    assert.equal(normalizeCashRefundApprovalThreshold(12.345), 12.35);
    assert.equal(normalizeCashRefundApprovalThreshold(-1), 0);
  });
});

describe('return decision', () => {
  it('books a small cash refund inside the window when a manager approves it', async () => {
    const decision = await decideReturn(request({
      order: order('2026-06-01T12:00:00.000Z', 20),
    }));
    assert.equal(decision.needsManager, true);
    assert.equal(decision.needsWarranty, false);
    assert.equal(decision.approverId, 'mgr-1');
    assert.equal(decision.approverName, 'Maya Perera');
    assert.equal(decision.reason, 'Customer changed their mind');
    assert.equal(decision.warrantyMonths, null);
    assert.equal(decision.salesReceiptId, null);
  });

  it('skips the manager PIN when the cash refund is within a raised threshold', async () => {
    const decision = await decideReturn(request({
      order: order('2026-06-01T12:00:00.000Z', 20),
      cashRefundApprovalThreshold: 25,
      managerPin: '',
      users: [],
    }));
    assert.equal(decision.needsManager, false);
    assert.equal(decision.approverId, null);
  });

  it('rejects a small refund outside the shop window', async () => {
    await assert.rejects(
      () => decideReturn(request({
        order: order('2026-04-01T12:00:00.000Z', 20),
      })),
      (error) => error.message === 'This sale is outside the 30-day refund window',
    );
  });

  it('rejects small refunds when the shop window is 0 days', async () => {
    await assert.rejects(
      () => decideReturn(request({
        order: order('2026-06-15T11:00:00.000Z', 20),
        refundWindowDays: 0,
      })),
      (error) => error.message === WINDOW_OFF,
    );
  });

  it('requires a reason', async () => {
    await assert.rejects(
      () => decideReturn(request({ reason: '   ' })),
      (error) => error.message === REASON_REQUIRED,
    );
  });

  it('rejects the teller approving their own cash refund', async () => {
    await assert.rejects(
      () => decideReturn(request({
        order: order('2026-06-01T12:00:00.000Z', 20),
        sellerId: 'mgr-1',
      })),
      (error) => error.message === PIN_REJECTED,
    );
  });

  it('rejects a missing or shared manager PIN', async () => {
    await assert.rejects(
      () => decideReturn(request({
        order: order('2026-06-01T12:00:00.000Z', 20),
        managerPin: '12',
      })),
      (error) => error.message === PIN_REQUIRED,
    );
    await assert.rejects(
      () => decideReturn(request({
        order: order('2026-06-01T12:00:00.000Z', 20),
        users: [manager, otherManager],
      })),
      (error) => error.message === PIN_REJECTED,
    );
  });

  it('checks a 12 or 24 month warranty and the sales receipt above €50', async () => {
    const allowed = await decideReturn(request({
      order: order('2025-06-15T12:00:00.000Z', 80),
      warrantyMonths: 12,
      salesReceiptId: 'ord-000101',
    }));
    assert.equal(allowed.needsWarranty, true);
    assert.equal(allowed.warrantyMonths, 12);
    assert.equal(allowed.salesReceiptId, 'ORD000101');
    assert.equal(allowed.approverId, 'mgr-1');

    const longer = await decideReturn(request({
      order: order('2025-01-15T12:00:00.000Z', 80),
      warrantyMonths: 24,
      salesReceiptId: '#101',
    }));
    assert.equal(longer.warrantyMonths, 24);

    await assert.rejects(
      () => decideReturn(request({
        order: order('2025-01-15T12:00:00.000Z', 80),
        warrantyMonths: 12,
        salesReceiptId: 'ORD000101',
      })),
      (error) => error.message === 'This sale is outside the 12-month warranty',
    );
    await assert.rejects(
      () => decideReturn(request({ salesReceiptId: 'ORD000101' })),
      (error) => error.message === WARRANTY_REQUIRED,
    );
    await assert.rejects(
      () => decideReturn(request({ warrantyMonths: 12 })),
      (error) => error.message === RECEIPT_REQUIRED,
    );
    await assert.rejects(
      () => decideReturn(request({ warrantyMonths: 12, salesReceiptId: 'ORD000999' })),
      (error) => error.message === RECEIPT_MISMATCH,
    );
  });

  it('uses the warranty period instead of the short window above €50', async () => {
    const decision = await decideReturn(request({
      order: order('2026-04-01T12:00:00.000Z', 80),
      refundWindowDays: 14,
      warrantyMonths: 12,
      salesReceiptId: 'ORD000101',
    }));
    assert.equal(decision.needsWarranty, true);
    assert.equal(decision.salesReceiptId, 'ORD000101');
  });

  it('requires a manager for a high-value defect return', async () => {
    await assert.rejects(
      () => decideReturn(request({
        returnType: 'defect',
        warrantyMonths: 12,
        salesReceiptId: 'ORD000101',
        managerPin: '',
      })),
      (error) => error.message === PIN_REQUIRED,
    );
  });

  it('allows a small defect return with a reason and no PIN', async () => {
    const decision = await decideReturn(request({
      order: order('2026-06-10T12:00:00.000Z', 15),
      returnType: 'defect',
      managerPin: '',
      users: [],
    }));
    assert.equal(decision.needsManager, false);
    assert.equal(decision.returnType, 'defect');
  });

  it('rejects an order with no sale date', async () => {
    await assert.rejects(
      () => decideReturn(request({ order: { ...order('2026-06-01T12:00:00.000Z', 10), sale_date: null } })),
      (error) => error.message === NO_SALE_DATE,
    );
  });
});

describe('refunds by teller', () => {
  it('groups refunds by the teller who took them', () => {
    const report = buildRefundReport([
      {
        return_number: 'RET1',
        order_number: 'ORD000101',
        created_at: '2026-06-02T10:00:00.000Z',
        teller_id: 'teller-1',
        teller_name: 'Ada',
        return_type: 'cash',
        reason: 'Changed mind',
        approver_name: 'Maya',
        refund_cash: 20,
        refund_value: 20,
      },
      {
        return_number: 'RET2',
        order_number: 'ORD000102',
        created_at: '2026-06-03T10:00:00.000Z',
        teller_id: 'teller-1',
        teller_name: 'Ada',
        return_type: 'cash',
        reason: 'Faulty',
        approver_name: 'Maya',
        refund_cash: 80,
        refund_value: 80,
        warranty_months: 24,
        sales_receipt_id: 'ORD000102',
      },
      {
        return_number: 'RET3',
        order_number: 'ORD000103',
        created_at: '2026-05-01T10:00:00.000Z',
        teller_id: 'teller-2',
        teller_name: 'Ben',
        return_type: 'defect',
        refund_cash: 0,
        refund_value: 10,
      },
    ], { from: '2026-06-01', to: '2026-06-30' });

    assert.equal(report.tellers.length, 1);
    assert.equal(report.tellers[0].tellerName, 'Ada');
    assert.equal(report.tellers[0].count, 2);
    assert.equal(report.tellers[0].refundCash, 100);
    assert.equal(report.tellers[0].returns[0].returnNumber, 'RET2');
    assert.equal(report.tellers[0].returns[0].warrantyMonths, 24);
    assert.equal(report.totals.count, 2);
    assert.equal(report.totals.refundCash, 100);
  });

  it('rejects a bad date filter', () => {
    assert.equal(buildRefundReport([], { from: 'yesterday' }).error, 'Invalid date');
  });
});
