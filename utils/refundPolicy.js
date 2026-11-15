/**
 * Refund controls.
 * Every return needs a reason.
 * Cash refunds above the shop threshold need a manager PIN. The default threshold is 0,
 * so any cash refund needs a manager who is not the teller taking the return.
 * A return above €50 also needs a manager, the sales receipt ID, and a 12 or 24 month
 * warranty that still covers the sale date. That check uses fixed rates
 * (1 EUR = 1.08 USD = 330 LKR) only to decide whether the €50 rule applies.
 * Smaller returns must fall inside the shop's refund window instead.
 */
const { normalizeRole } = require('../config/permissions');
const { normalizeOrderNumber } = require('./orderId');
const { roundMoney } = require('./salePricing');

const HIGH_VALUE_EUR_CENTS = 5000;
const WARRANTY_MONTHS = [12, 24];
const RETURN_TYPES = ['cash', 'defect', 'warranty'];
const DEFAULT_REFUND_WINDOW_DAYS = 30;
const DEFAULT_CASH_APPROVAL_THRESHOLD = 0;
const MAX_REASON_LENGTH = 200;
const MS_DAY = 24 * 60 * 60 * 1000;

/** Minor units of each currency that equal one euro. */
const CENTS_PER_EUR = {
  EUR: 100,
  USD: 108,
  LKR: 33000,
};

const REASON_REQUIRED = 'A reason is required for a return';
const REASON_TOO_LONG = 'Return reason must be 200 characters or less';
const NO_SALE_DATE = 'This order has no sale date, so the refund period cannot be checked';
const WINDOW_OFF = 'Refunds at or below €50 are turned off for this shop';
const WARRANTY_REQUIRED = 'Choose a 12 or 24 month warranty for a return above €50';
const RECEIPT_REQUIRED = 'Enter the sales receipt ID for a return above €50';
const RECEIPT_MISMATCH = 'Sales receipt ID does not match this order';
const PIN_REQUIRED = 'A manager PIN is required for this refund';
const PIN_REJECTED = 'Manager PIN was not accepted';

const APPROVER_ROLES = new Set(['TENANT_ADMIN', 'MANAGER']);

function eurCents(amount, currencyCode) {
  const code = String(currencyCode || 'USD').toUpperCase();
  const perEur = CENTS_PER_EUR[code] || CENTS_PER_EUR.USD;
  const minor = Math.round((Number(amount) || 0) * 100);
  return Math.round((minor * 100) / perEur);
}

function aboveWarrantyThreshold(amount, currencyCode) {
  return eurCents(amount, currencyCode) > HIGH_VALUE_EUR_CENTS;
}

function normalizeRefundWindowDays(value) {
  if (value == null || value === '') return DEFAULT_REFUND_WINDOW_DAYS;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_REFUND_WINDOW_DAYS;
  return Math.min(3650, Math.max(0, Math.round(n)));
}

function normalizeCashRefundApprovalThreshold(value) {
  if (value == null || value === '') return DEFAULT_CASH_APPROVAL_THRESHOLD;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_CASH_APPROVAL_THRESHOLD;
  return roundMoney(n);
}

function windowMessage(days) {
  if (!(days > 0)) return WINDOW_OFF;
  return `This sale is outside the ${days}-day refund window`;
}

function warrantyMessage(months) {
  return `This sale is outside the ${months}-month warranty`;
}

function addMonths(date, months) {
  const next = new Date(date.getTime());
  const day = next.getUTCDate();
  next.setUTCMonth(next.getUTCMonth() + months);
  if (next.getUTCDate() < day) next.setUTCDate(0);
  return next;
}

function saleTime(order) {
  if (order?.sale_date == null || order.sale_date === '') return null;
  const start = new Date(order.sale_date);
  if (Number.isNaN(start.getTime())) return null;
  return start;
}

function insideRefundWindow(saleDate, days, now) {
  if (!(Number(days) > 0)) return false;
  return now.getTime() - saleDate.getTime() <= Number(days) * MS_DAY;
}

function insideWarranty(saleDate, months, now) {
  return now.getTime() <= addMonths(saleDate, months).getTime();
}

function cleanReason(value) {
  const text = String(value ?? '').trim();
  if (!text) return { error: REASON_REQUIRED };
  if (text.length > MAX_REASON_LENGTH) return { error: REASON_TOO_LONG };
  return { text };
}

function parseWarrantyMonths(value) {
  const n = Number(value);
  return WARRANTY_MONTHS.includes(n) ? n : null;
}

function quoteReturnLines(order, requested) {
  const rows = Array.isArray(requested) ? requested : [];
  let refundValue = 0;
  const seen = new Set();
  for (const row of rows) {
    const sale = (order?.lines || []).find((line) => String(line.id) === String(row?.saleId || row?.sale_id));
    if (!sale) return { error: 'Sale line not found on this order' };
    if (seen.has(String(sale.id))) return { error: 'Each sale line can only appear once in a return' };
    seen.add(String(sale.id));
    const qty = Number(row.quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      return { error: 'Each return line needs a quantity of at least 1' };
    }
    if (qty > sale.returnable_qty) {
      return { error: `Only ${sale.returnable_qty} left to return for ${sale.item_name}` };
    }
    const fullLine =
      qty === Number(sale.quantity) &&
      !(Number(sale.returned_qty) > 0) &&
      Number.isFinite(Number(sale.total));
    const lineTotal = fullLine ? roundMoney(Number(sale.total)) : roundMoney((Number(sale.unit_price) || 0) * qty);
    refundValue = roundMoney(refundValue + lineTotal);
  }
  if (!seen.size) return { error: 'Select at least one item to return' };
  return { refundValue };
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

function canApproveRefund(user, { sellerId, now }) {
  if (!isActiveUser(user, now)) return false;
  if (sellerId != null && String(user.id) === String(sellerId)) return false;
  return APPROVER_ROLES.has(normalizeRole(user.role));
}

async function matchRefundApprover({ pin, users, sellerId, comparePin, now }) {
  const value = String(pin ?? '');
  if (!/^\d{6,8}$/.test(value)) return { format: false, approver: null };
  const hits = [];
  for (const user of users || []) {
    if (!canApproveRefund(user, { sellerId, now })) continue;
    const hash = user.pin_hash || user.pinHash;
    if (!hash) continue;
    if (await comparePin(value, hash)) hits.push(user);
  }
  if (hits.length !== 1) return { format: true, approver: null };
  return { format: true, approver: hits[0] };
}

function fail(message) {
  throw Object.assign(new Error(message), { status: 400 });
}

/**
 * Checks the reason, the refund window or the warranty, and whether a manager is required.
 * Throws status 400. Does not look at the PIN.
 */
function previewReturn({
  order,
  lines,
  reason,
  returnType,
  salesReceiptId,
  warrantyMonths,
  currencyCode,
  refundWindowDays,
  cashRefundApprovalThreshold,
  now = new Date(),
}) {
  const quoted = quoteReturnLines(order, lines);
  if (quoted.error) fail(quoted.error);

  const cleaned = cleanReason(reason);
  if (cleaned.error) fail(cleaned.error);

  const type = RETURN_TYPES.includes(returnType) ? returnType : 'cash';
  const soldAt = saleTime(order);
  if (!soldAt) fail(NO_SALE_DATE);

  const windowDays = normalizeRefundWindowDays(refundWindowDays);
  const cashThreshold = normalizeCashRefundApprovalThreshold(cashRefundApprovalThreshold);
  const needsWarranty = aboveWarrantyThreshold(quoted.refundValue, currencyCode);
  let appliedMonths = null;
  let appliedReceipt = null;

  if (needsWarranty) {
    appliedMonths = parseWarrantyMonths(warrantyMonths);
    if (!appliedMonths) fail(WARRANTY_REQUIRED);
    if (!insideWarranty(soldAt, appliedMonths, now)) fail(warrantyMessage(appliedMonths));
    const given = normalizeOrderNumber(salesReceiptId);
    const expected = normalizeOrderNumber(order.order_number);
    if (!given) fail(RECEIPT_REQUIRED);
    if (!expected || given !== expected) fail(RECEIPT_MISMATCH);
    appliedReceipt = expected;
  } else if (!insideRefundWindow(soldAt, windowDays, now)) {
    fail(windowMessage(windowDays));
  }

  const needsManager = needsWarranty || (type === 'cash' && quoted.refundValue > cashThreshold);
  return {
    needsManager,
    needsWarranty,
    refundValue: quoted.refundValue,
    reason: cleaned.text,
    returnType: type,
    warrantyMonths: appliedMonths,
    salesReceiptId: appliedReceipt,
  };
}

/** Adds the approver. The PIN is checked here and is not part of the result. */
async function approvePreview(draft, { managerPin, users, sellerId, comparePin, now = new Date() }) {
  if (!draft.needsManager) {
    return { ...draft, approverId: null, approverName: null };
  }
  const matched = await matchRefundApprover({
    pin: managerPin,
    users,
    sellerId,
    comparePin,
    now: now.getTime(),
  });
  if (!matched.format) fail(PIN_REQUIRED);
  if (!matched.approver) fail(PIN_REJECTED);
  const approver = matched.approver;
  return {
    ...draft,
    approverId: String(approver.id),
    approverName: approver.full_name || approver.fullName || approver.username || null,
  };
}

async function decideReturn(input) {
  const draft = previewReturn(input);
  return approvePreview(draft, input);
}

function parseBound(value, endOfDay) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const parsed = new Date(dateOnly && endOfDay ? `${text}T23:59:59.999` : text);
  if (Number.isNaN(parsed.getTime())) return { error: 'Invalid date' };
  return { date: parsed };
}

/** One group per teller, so a manager can see who paid refunds out. */
function buildRefundReport(returns, query = {}) {
  const from = parseBound(query.from, false);
  const to = parseBound(query.to, true);
  if (from?.error || to?.error) return { error: 'Invalid date' };

  const byTeller = new Map();
  for (const entry of returns || []) {
    if (!entry) continue;
    const when = new Date(entry.created_at || entry.createdAt);
    if (Number.isNaN(when.getTime())) continue;
    if (from?.date && when < from.date) continue;
    if (to?.date && when > to.date) continue;

    const tellerId = entry.teller_id != null && String(entry.teller_id) !== '' ? String(entry.teller_id) : 'unknown';
    let group = byTeller.get(tellerId);
    if (!group) {
      group = {
        tellerId,
        tellerName: entry.teller_name || 'Unknown',
        count: 0,
        refundCash: 0,
        refundValue: 0,
        returns: [],
      };
      byTeller.set(tellerId, group);
    }
    if (group.tellerName === 'Unknown' && entry.teller_name) group.tellerName = entry.teller_name;
    const refundCash = roundMoney(entry.refund_cash);
    const refundValue = roundMoney(entry.refund_value);
    group.count += 1;
    group.refundCash = roundMoney(group.refundCash + refundCash);
    group.refundValue = roundMoney(group.refundValue + refundValue);
    group.returns.push({
      returnNumber: entry.return_number || null,
      orderNumber: entry.order_number || null,
      createdAt: entry.created_at || entry.createdAt || null,
      returnType: entry.return_type || 'cash',
      reason: entry.reason || null,
      approverName: entry.approver_name || null,
      refundCash,
      refundValue,
      warrantyMonths: entry.warranty_months || null,
      salesReceiptId: entry.sales_receipt_id || null,
    });
  }

  const tellers = [...byTeller.values()];
  tellers.forEach((group) => {
    group.returns.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  });
  tellers.sort((a, b) => b.refundCash - a.refundCash || String(a.tellerName).localeCompare(String(b.tellerName)));

  return {
    tellers,
    totals: {
      count: tellers.reduce((sum, group) => sum + group.count, 0),
      refundCash: roundMoney(tellers.reduce((sum, group) => sum + group.refundCash, 0)),
      refundValue: roundMoney(tellers.reduce((sum, group) => sum + group.refundValue, 0)),
    },
  };
}

module.exports = {
  HIGH_VALUE_EUR_CENTS,
  WARRANTY_MONTHS,
  DEFAULT_REFUND_WINDOW_DAYS,
  DEFAULT_CASH_APPROVAL_THRESHOLD,
  CENTS_PER_EUR,
  REASON_REQUIRED,
  REASON_TOO_LONG,
  NO_SALE_DATE,
  WINDOW_OFF,
  WARRANTY_REQUIRED,
  RECEIPT_REQUIRED,
  RECEIPT_MISMATCH,
  PIN_REQUIRED,
  PIN_REJECTED,
  aboveWarrantyThreshold,
  normalizeRefundWindowDays,
  normalizeCashRefundApprovalThreshold,
  previewReturn,
  approvePreview,
  decideReturn,
  buildRefundReport,
};
