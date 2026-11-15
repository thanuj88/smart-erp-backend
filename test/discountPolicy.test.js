const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_DISCOUNT_PERCENT,
  normalizeDiscountLimits,
  limitForRole,
  assessDiscount,
  matchApprover,
  decideDiscount,
  discountAuditFields,
  buildDiscountReport,
  OVER_CEILING,
  REASON_REQUIRED,
  PIN_REJECTED,
} = require('../utils/discountPolicy');

const comparePin = async (pin, hash) => pin === hash;

const manager = {
  id: 'mgr-1',
  username: 'maya',
  full_name: 'Maya Perera',
  role: 'MANAGER',
  is_active: 1,
  pin_hash: '654321',
};

const tellerLimits = () => normalizeDiscountLimits({ TELLER: 0, MANAGER: 5, TENANT_ADMIN: 5 });

describe('discount limits', () => {
  it('caps every role at 5 percent and keeps the selling roles at that default', () => {
    assert.equal(MAX_DISCOUNT_PERCENT, 5);
    const limits = normalizeDiscountLimits(null);
    assert.equal(limits.TELLER, 5);
    assert.equal(limits.MANAGER, 5);
    assert.equal(limits.TENANT_ADMIN, 5);
    assert.equal(limits.INVENTORY, 0);
    assert.equal(limits.ACCOUNTANT, 0);
    assert.equal(normalizeDiscountLimits({ TELLER: 80, MANAGER: -3 }).TELLER, 5);
    assert.equal(normalizeDiscountLimits({ TELLER: 2 }, limits).MANAGER, 5);
    assert.equal(limitForRole(limits, 'teller'), 5);
    assert.equal(limitForRole({}, 'SUPER_ADMIN'), 5);
  });

  it('allows a teller discount inside the role limit with no approval', () => {
    const decision = assessDiscount({
      role: 'TELLER',
      limits: normalizeDiscountLimits(null),
      itemsTotal: 200,
      input: { discountPercent: 5 },
    });
    assert.equal(decision.allowed, true);
    assert.equal(decision.needsApproval, false);
    assert.equal(decision.discountAmount, 10);
  });

  it('rejects anything above 5 percent of the merchandise, including a fixed amount', () => {
    const byPercent = assessDiscount({
      role: 'MANAGER',
      limits: normalizeDiscountLimits(null),
      itemsTotal: 100,
      input: { discountPercent: 6 },
    });
    const byAmount = assessDiscount({
      role: 'TENANT_ADMIN',
      limits: normalizeDiscountLimits(null),
      itemsTotal: 80,
      input: { discount: 4.01 },
    });
    assert.equal(byPercent.allowed, false);
    assert.equal(byPercent.error, OVER_CEILING);
    assert.equal(byAmount.allowed, false);
    assert.equal(byAmount.discountAmount, 4.01);
  });

  it('asks for approval when the discount is above the teller limit and still within 5 percent', () => {
    const decision = assessDiscount({
      role: 'TELLER',
      limits: tellerLimits(),
      itemsTotal: 100,
      input: { discount: 4 },
    });
    assert.equal(decision.allowed, true);
    assert.equal(decision.needsApproval, true);
    assert.equal(decision.limit, 0);
    assert.equal(decision.effectivePercent, 4);
  });
});

describe('manager approval', () => {
  const base = {
    role: 'TELLER',
    sellerId: 'teller-1',
    limits: tellerLimits(),
    itemsTotal: 100,
    input: { discountPercent: 4 },
    users: [manager],
    comparePin,
  };

  it('stores the reason and the approver when the PIN matches one manager', async () => {
    const decision = await decideDiscount({ ...base, managerPin: '654321', discountReason: '  Damaged box  ' });
    assert.equal(decision.reason, 'Damaged box');
    assert.equal(decision.approverId, 'mgr-1');
    assert.equal(decision.approverName, 'Maya Perera');
    assert.deepEqual(discountAuditFields(decision), {
      discount_reason: 'Damaged box',
      discount_approved_by: 'mgr-1',
      discount_approver_name: 'Maya Perera',
      discount_effective_percent: 4,
    });
  });

  it('refuses a discount above the limit with no reason or a bad PIN', async () => {
    await assert.rejects(
      () => decideDiscount({ ...base, managerPin: '654321', discountReason: '   ' }),
      (error) => error.status === 400 && error.message === REASON_REQUIRED
    );
    await assert.rejects(
      () => decideDiscount({ ...base, managerPin: '000000', discountReason: 'Staff purchase' }),
      (error) => error.status === 400 && error.message === PIN_REJECTED
    );
  });

  it('does not let the seller, a teller, or a manager under the amount approve it', async () => {
    const users = [
      { ...manager, id: 'teller-1' },
      { ...manager, id: 'other-teller', role: 'TELLER', pin_hash: '654321' },
      { ...manager, id: 'low', pin_hash: '111111', role: 'MANAGER' },
      { ...manager, id: 'off', is_active: 0, pin_hash: '222222' },
    ];
    const limits = normalizeDiscountLimits({ TELLER: 0, MANAGER: 2, TENANT_ADMIN: 5 });
    const decision = await matchApprover({
      pin: '654321',
      users,
      limits,
      requiredPercent: 4,
      sellerId: 'teller-1',
      comparePin,
    });
    assert.equal(decision, null);
    const low = await matchApprover({
      pin: '111111',
      users,
      limits,
      requiredPercent: 4,
      sellerId: 'teller-1',
      comparePin,
    });
    assert.equal(low, null);
  });

  it('rejects the PIN when two managers share it', async () => {
    const hit = await matchApprover({
      pin: '654321',
      users: [manager, { ...manager, id: 'mgr-2', username: 'nia' }],
      limits: tellerLimits(),
      requiredPercent: 4,
      sellerId: 'teller-1',
      comparePin,
    });
    assert.equal(hit, null);
  });

  it('leaves a within-limit discount without an approver', async () => {
    const decision = await decideDiscount({
      ...base,
      limits: normalizeDiscountLimits(null),
      managerPin: '654321',
      discountReason: 'ignored',
      users: [],
    });
    assert.equal(decision.needsApproval, false);
    assert.equal(decision.approverId, null);
    assert.equal(discountAuditFields(decision).discount_approved_by, null);
  });
});

describe('discount report', () => {
  const sales = [
    {
      order_number: 'ORD1',
      sale_date: '2026-11-01T10:00:00.000Z',
      teller_name: 'Ann',
      payment_type: 'cash',
      discount_amount: 5,
      list_total: 60,
      total: 55,
      discount_reason: 'Damaged box',
      discount_approved_by: 'mgr-1',
      discount_approver_name: 'Maya',
      discount_effective_percent: 4.17,
    },
    {
      order_number: 'ORD1',
      sale_date: '2026-11-01T10:00:00.000Z',
      teller_name: 'Ann',
      discount_amount: 5,
      list_total: 60,
      total: 60,
    },
    {
      order_number: 'ORD2',
      sale_date: '2026-11-02T10:00:00.000Z',
      teller_name: 'Bo',
      discount_amount: 0,
      list_total: 20,
      total: 20,
    },
    {
      order_number: 'ORD3',
      sale_date: '2026-10-01T10:00:00.000Z',
      is_return: true,
      discount_amount: 5,
      list_total: 40,
      total: 35,
    },
  ];

  it('groups a bill once and skips zero discounts and returns', () => {
    const report = buildDiscountReport(sales, { from: '2026-11-01', to: '2026-11-30' });
    assert.equal(report.orders.length, 1);
    assert.equal(report.orders[0].orderNumber, 'ORD1');
    assert.equal(report.orders[0].discountAmount, 5);
    assert.equal(report.orders[0].itemsTotal, 120);
    assert.equal(report.orders[0].grandTotal, 115);
    assert.equal(report.orders[0].reason, 'Damaged box');
    assert.equal(report.orders[0].approverName, 'Maya');
    assert.equal(report.totals.count, 1);
    assert.equal(report.totals.discountAmount, 5);
  });

  it('rejects a bad date', () => {
    assert.equal(buildDiscountReport(sales, { from: 'yesterday' }).error, 'Invalid date');
  });
});
