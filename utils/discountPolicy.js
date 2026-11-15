/**
 * Discount ceiling for a sale.
 * 5% of the merchandise is the most any role can take off, with or without a manager.
 * A role's own limit (tenant settings, also at most 5%) can be lower.
 * A discount above that role limit needs a manager PIN, a reason, and is stored with the approver.
 * The arithmetic matches utils/salePricing.js: percent applies to the items total, then the
 * fixed amount is added, and the result cannot exceed the bill.
 */
const { normalizeRole } = require('../config/permissions');
const { computeCharges, roundMoney } = require('./salePricing');

const MAX_DISCOUNT_PERCENT = 5;

const DISCOUNT_ROLES = ['TENANT_ADMIN', 'MANAGER', 'TELLER', 'INVENTORY', 'ACCOUNTANT'];

const DEFAULT_DISCOUNT_LIMITS = {
  TENANT_ADMIN: MAX_DISCOUNT_PERCENT,
  MANAGER: MAX_DISCOUNT_PERCENT,
  TELLER: MAX_DISCOUNT_PERCENT,
  INVENTORY: 0,
  ACCOUNTANT: 0,
};

const APPROVER_ROLES = new Set(['TENANT_ADMIN', 'MANAGER']);

const OVER_CEILING = 'Discount cannot exceed 5% of the bill';
const REASON_REQUIRED = 'A reason is required for a discount above your limit';
const REASON_TOO_LONG = 'Discount reason must be 200 characters or less';
const PIN_REJECTED = 'Manager PIN was not accepted';

function toCents(value) {
  return Math.round((Number(value) || 0) * 100);
}

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_DISCOUNT_PERCENT);
}

function normalizeDiscountLimits(raw, base) {
  const next = { ...DEFAULT_DISCOUNT_LIMITS };
  const seed = base && typeof base === 'object' ? base : null;
  if (seed) {
    DISCOUNT_ROLES.forEach((role) => {
      if (seed[role] != null && seed[role] !== '') next[role] = clampPercent(seed[role]);
    });
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return next;
  DISCOUNT_ROLES.forEach((role) => {
    if (raw[role] != null && raw[role] !== '') next[role] = clampPercent(raw[role]);
  });
  return next;
}

/** Super admin is not a store role. Their ceiling is the same 5% hard cap. */
function limitForRole(limits, role) {
  const key = normalizeRole(role);
  if (key === 'SUPER_ADMIN') return MAX_DISCOUNT_PERCENT;
  const table = limits && typeof limits === 'object' ? limits : DEFAULT_DISCOUNT_LIMITS;
  if (table[key] == null || table[key] === '') return DEFAULT_DISCOUNT_LIMITS[key] ?? 0;
  return clampPercent(table[key]);
}

function requestedPercent(input) {
  const n = parseFloat(input?.discountPercent);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

function assessDiscount({ role, limits, itemsTotal, input }) {
  const merchandise = roundMoney(itemsTotal);
  const charges = computeCharges(merchandise, input || {});
  const discountCents = toCents(charges.discountAmount);
  const capCents = toCents(roundMoney(merchandise * (MAX_DISCOUNT_PERCENT / 100)));
  const limit = limitForRole(limits, role);
  const limitCents = toCents(roundMoney(merchandise * (limit / 100)));
  const askedPercent = requestedPercent(input);
  const effectivePercent = merchandise > 0
    ? Math.round((charges.discountAmount / merchandise) * 10000) / 100
    : 0;

  if (askedPercent > MAX_DISCOUNT_PERCENT || discountCents > capCents) {
    return {
      allowed: false,
      error: OVER_CEILING,
      discountAmount: charges.discountAmount,
      effectivePercent,
      limit,
    };
  }

  const needsApproval = discountCents > 0 && (askedPercent > limit || discountCents > limitCents);
  return {
    allowed: true,
    needsApproval,
    discountAmount: charges.discountAmount,
    effectivePercent,
    limit,
    error: null,
  };
}

function cleanReason(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (text.length > 200) return { tooLong: true };
  return text;
}

function isActiveUser(user, now) {
  if (!user || user.deleted_at) return false;
  if (user.is_active === 0 || user.is_active === false || user.is_active === '0') return false;
  if (user.locked_until) {
    const until = new Date(user.locked_until).getTime();
    if (Number.isFinite(until) && until > now) return false;
  }
  return true;
}

function canApprove(user, { limits, requiredPercent, sellerId, now }) {
  if (!isActiveUser(user, now)) return false;
  if (sellerId != null && String(user.id) === String(sellerId)) return false;
  const role = normalizeRole(user.role);
  if (!APPROVER_ROLES.has(role)) return false;
  return limitForRole(limits, role) + 1e-9 >= requiredPercent;
}

/**
 * One matching manager PIN. Zero matches and two matches both fail
 * so a shared PIN cannot be used to guess which account approved.
 */
async function matchApprover({ pin, users, limits, requiredPercent, sellerId, comparePin, now = Date.now() }) {
  const value = String(pin ?? '');
  if (!/^\d{6,8}$/.test(value)) return null;
  const hits = [];
  for (const user of users || []) {
    if (!canApprove(user, { limits, requiredPercent, sellerId, now })) continue;
    const hash = user.pin_hash || user.pinHash;
    if (!hash) continue;
    if (await comparePin(value, hash)) hits.push(user);
  }
  if (hits.length !== 1) return null;
  return hits[0];
}

function discountAuditFields(decision) {
  if (!decision || !(Number(decision.discountAmount) > 0)) return {};
  return {
    discount_reason: decision.reason || null,
    discount_approved_by: decision.approverId || null,
    discount_approver_name: decision.approverName || null,
    discount_effective_percent: decision.effectivePercent,
  };
}

/**
 * Pure decision used by the sale service after settings and staff PINs are loaded.
 * Throws status 400. Never includes the PIN in the error.
 */
async function decideDiscount({
  role,
  sellerId,
  limits,
  itemsTotal,
  input,
  managerPin,
  discountReason,
  users,
  comparePin,
  now,
}) {
  const assessment = assessDiscount({ role, limits, itemsTotal, input });
  if (!assessment.allowed) {
    throw Object.assign(new Error(assessment.error), { status: 400 });
  }
  if (!assessment.needsApproval) {
    return {
      ...assessment,
      reason: null,
      approverId: null,
      approverName: null,
    };
  }

  const reason = cleanReason(discountReason);
  if (reason && reason.tooLong) {
    throw Object.assign(new Error(REASON_TOO_LONG), { status: 400 });
  }
  if (!reason) {
    throw Object.assign(new Error(REASON_REQUIRED), { status: 400 });
  }

  const approver = await matchApprover({
    pin: managerPin,
    users,
    limits,
    requiredPercent: assessment.effectivePercent,
    sellerId,
    comparePin,
    now,
  });
  if (!approver) {
    throw Object.assign(new Error(PIN_REJECTED), { status: 400 });
  }

  return {
    ...assessment,
    reason,
    approverId: String(approver.id),
    approverName: approver.full_name || approver.fullName || approver.username || null,
  };
}

function parseBound(value, endOfDay) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const parsed = new Date(dateOnly && endOfDay ? `${text}T23:59:59.999` : text);
  if (Number.isNaN(parsed.getTime())) {
    return { error: 'Invalid date' };
  }
  return { date: parsed };
}

/** One row per order. discount_amount is the bill total copied onto every line, so it is not summed. */
function buildDiscountReport(sales, query = {}) {
  const from = parseBound(query.from, false);
  const to = parseBound(query.to, true);
  if (from?.error || to?.error) return { error: 'Invalid date' };

  const byOrder = new Map();
  for (const sale of sales || []) {
    if (!sale || sale.is_return || sale.return_flag) continue;
    const discountAmount = roundMoney(sale.discount_amount);
    if (!(discountAmount > 0)) continue;
    const when = new Date(sale.sale_date);
    if (Number.isNaN(when.getTime())) continue;
    if (from?.date && when < from.date) continue;
    if (to?.date && when > to.date) continue;

    const key = sale.order_number || sale.id;
    let row = byOrder.get(key);
    if (!row) {
      row = {
        orderNumber: sale.order_number || null,
        saleDate: sale.sale_date,
        tellerId: sale.teller_id || null,
        tellerName: sale.teller_name || null,
        paymentType: sale.payment_type || 'cash',
        discountAmount,
        itemsTotal: 0,
        grandTotal: 0,
        reason: sale.discount_reason || null,
        approverId: sale.discount_approved_by || null,
        approverName: sale.discount_approver_name || null,
        effectivePercent: Number(sale.discount_effective_percent) || 0,
      };
      byOrder.set(key, row);
    }
    row.itemsTotal = roundMoney(row.itemsTotal + (Number(sale.list_total) || 0));
    row.grandTotal = roundMoney(row.grandTotal + (Number(sale.total) || 0));
  }

  const orders = [...byOrder.values()].map((row) => {
    if (!(row.effectivePercent > 0) && row.itemsTotal > 0) {
      return {
        ...row,
        effectivePercent: Math.round((row.discountAmount / row.itemsTotal) * 10000) / 100,
      };
    }
    return row;
  });
  orders.sort((a, b) => String(b.saleDate).localeCompare(String(a.saleDate)));

  return {
    orders,
    totals: {
      count: orders.length,
      discountAmount: roundMoney(orders.reduce((sum, row) => sum + row.discountAmount, 0)),
    },
  };
}

module.exports = {
  MAX_DISCOUNT_PERCENT,
  DISCOUNT_ROLES,
  DEFAULT_DISCOUNT_LIMITS,
  APPROVER_ROLES,
  OVER_CEILING,
  REASON_REQUIRED,
  REASON_TOO_LONG,
  PIN_REJECTED,
  normalizeDiscountLimits,
  limitForRole,
  assessDiscount,
  matchApprover,
  decideDiscount,
  discountAuditFields,
  buildDiscountReport,
};
