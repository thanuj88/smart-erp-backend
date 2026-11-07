/**
 * Cash checkout sends the whole bill in one request.
 * Posting one request per line meant a failure on line 3 left lines 1-2 committed,
 * and retrying the same bill sold them again.
 */
const { mergeInstallmentLines } = require('./installmentLines');

// DynamoDB transactions allow 100 actions: 1 idempotency marker + (sale put + stock update) per line.
const MAX_CASH_LINES = 40;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function parseCashSaleBody(body = {}) {
  if (body.itemId != null || body.quantity != null) {
    throw badRequest(
      'Send lines: [{ itemId, quantity }, ...] and an idempotencyKey. Single-item cash payload is no longer accepted.'
    );
  }

  const lines = mergeInstallmentLines(body.lines);
  if (lines.length > MAX_CASH_LINES) {
    throw badRequest(`A cash sale can have at most ${MAX_CASH_LINES} different products`);
  }

  const idempotencyKey = String(body.idempotencyKey || '').trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw badRequest('idempotencyKey is required (8-128 letters, digits, - or _)');
  }

  return { lines, idempotencyKey };
}

module.exports = { MAX_CASH_LINES, parseCashSaleBody };
