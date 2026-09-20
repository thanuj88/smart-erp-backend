/** Canonical store order ID: ORD123456 */

function generateOrderNumber() {
  return `ORD${Date.now().toString().slice(-6)}`;
}

function normalizeOrderNumber(value) {
  if (value == null || value === '') return null;
  let raw = String(value).trim();
  if (raw.startsWith('#')) raw = raw.slice(1);
  if (/^ORD/i.test(raw)) {
    const suffix = raw.slice(3).replace(/\D/g, '').slice(-6).padStart(6, '0');
    return `ORD${suffix}`;
  }
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  return `ORD${digits.slice(-6).padStart(6, '0')}`;
}

function resolveOrderNumber(value, fallbackId) {
  return normalizeOrderNumber(value) || normalizeOrderNumber(fallbackId) || generateOrderNumber();
}

module.exports = {
  generateOrderNumber,
  normalizeOrderNumber,
  resolveOrderNumber,
};
