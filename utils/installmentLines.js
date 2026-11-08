/**
 * Installment checkout must send every cart line.
 * The old single-item payload (itemId + summed quantity) oversold SKU A and skipped the rest.
 */

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

// One installment bill is one DynamoDB transaction: a sale put and a stock
// update per product, one plan, up to 12 payments, and an optional witness.
// 40 products stays under the 100-action transaction limit (same cap as cash).
const MAX_INSTALLMENT_LINES = 40;

function rejectLegacyInstallmentPayload(body = {}) {
  if (body.itemId != null || body.quantity != null) {
    throw badRequest(
      'Send lines: [{ itemId, quantity }, ...]. Single-item installment payload is no longer accepted.'
    );
  }
}

function mergeInstallmentLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw badRequest('At least one bill line is required');
  }

  const merged = new Map();
  for (const line of lines) {
    const itemId = line?.itemId ?? line?.item_id ?? line?.id;
    const quantity = Number(line?.quantity);
    if (itemId == null || itemId === '') {
      throw badRequest('Each line needs itemId');
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw badRequest('Each line needs a quantity of at least 1');
    }
    const key = String(itemId);
    const prev = merged.get(key);
    merged.set(key, {
      itemId: prev?.itemId ?? itemId,
      quantity: (prev?.quantity || 0) + quantity,
    });
  }

  return Array.from(merged.values());
}

function parseInstallmentLines(body = {}) {
  rejectLegacyInstallmentPayload(body);
  const lines = mergeInstallmentLines(body.lines);
  if (lines.length > MAX_INSTALLMENT_LINES) {
    throw badRequest(`An installment sale can have at most ${MAX_INSTALLMENT_LINES} different products`);
  }
  return lines;
}

module.exports = {
  MAX_INSTALLMENT_LINES,
  rejectLegacyInstallmentPayload,
  mergeInstallmentLines,
  parseInstallmentLines,
};
