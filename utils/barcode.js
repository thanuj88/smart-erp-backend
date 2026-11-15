/**
 * Retail barcode matching for the scanner (G5).
 * Exact match, plus the usual UPC-A (12) / EAN-13 (13, one leading 0) pair.
 * UPC-E expands only when the scanner says the symbol is UPC-E, so an EAN-8 is not
 * rewritten into a different product's UPC-A.
 */

const SYMBOLOGIES = new Set(['ean13', 'ean8', 'upc_a', 'upc_e', 'code128']);
const MAX_LENGTH = 64;

function parseSymbology(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' && SYMBOLOGIES.has(raw) ? raw : null;
}

function cleanBarcode(value) {
  if (value == null) return '';
  const text = String(value).trim();
  if (text.length > MAX_LENGTH) {
    throw Object.assign(new Error('Barcode must be 64 characters or fewer'), { status: 400 });
  }
  if (/[^\x20-\x7e]/.test(text)) {
    throw Object.assign(new Error('Barcode must use plain letters, numbers and symbols'), { status: 400 });
  }
  return text;
}

/** Undefined when the client did not send `barcode`, so an update leaves the stored value alone. */
function barcodeForUpdate(body) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'barcode')) return undefined;
  return cleanBarcode(body.barcode);
}

function barcodeForCreate(body) {
  if (!body || body.barcode == null || body.barcode === '') return '';
  return cleanBarcode(body.barcode);
}

/**
 * UPC-E (number system, 6 data digits, check) → 12-digit UPC-A.
 * The check digit is the UPC-A check digit and is kept as sent.
 */
function expandUpcE(code) {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const ns = code[0];
  const data = code.slice(1, 7);
  const check = code[7];
  const last = data[5];
  let body;
  if (last === '0' || last === '1' || last === '2') {
    body = `${ns}${data[0]}${data[1]}${last}0000${data[2]}${data[3]}${data[4]}`;
  } else if (last === '3') {
    body = `${ns}${data[0]}${data[1]}${data[2]}00000${data[3]}${data[4]}`;
  } else if (last === '4') {
    body = `${ns}${data[0]}${data[1]}${data[2]}${data[3]}00000${data[4]}`;
  } else {
    body = `${ns}${data[0]}${data[1]}${data[2]}${data[3]}${data[4]}0000${last}`;
  }
  return `${body}${check}`;
}

function equivalents(raw, symbology) {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  const keys = new Set([text.toLowerCase()]);
  if (!/^\d+$/.test(text)) return [...keys];
  if (text.length === 12) keys.add(`0${text}`);
  if (text.length === 13 && text.startsWith('0')) keys.add(text.slice(1));
  if (symbology === 'upc_e') {
    const expanded = expandUpcE(text);
    if (expanded) {
      keys.add(expanded);
      keys.add(`0${expanded}`);
    }
  }
  return [...keys];
}

function sameBarcode(stored, scanned, symbology) {
  // Expand a stored UPC-E so it matches the UPC-A printed on the same packet.
  // An EAN-8 scan is not expanded: the same 8 digits must be stored as-is.
  const left = equivalents(stored, 'upc_e');
  if (left.length === 0) return false;
  const scanType = symbology === 'ean8' ? null : symbology === 'upc_e' || symbology == null ? 'upc_e' : symbology;
  const right = new Set(equivalents(scanned, scanType));
  return left.some((key) => right.has(key));
}

function findByBarcode(items, code, symbology) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => sameBarcode(item && item.barcode, code, symbology));
}

module.exports = {
  parseSymbology,
  cleanBarcode,
  barcodeForUpdate,
  barcodeForCreate,
  expandUpcE,
  equivalents,
  sameBarcode,
  findByBarcode,
};
