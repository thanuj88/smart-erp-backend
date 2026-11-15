/**
 * G4 — a teller's own sale rows.
 * Dates are calendar days in the server's local timezone, matching the other
 * sale summaries (`_today`, trend buckets). `to` includes the whole day.
 * Existing store-wide list endpoints are unchanged.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseCalendarDay(value, endOfDay) {
  const match = DAY.exec(String(value ?? '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

/**
 * @param {unknown} from
 * @param {unknown} to
 * @returns {{ ok: true, from: Date | null, to: Date | null } | { ok: false, error: string }}
 */
function parseMineRange(from, to) {
  const hasFrom = from != null && String(from).trim() !== '';
  const hasTo = to != null && String(to).trim() !== '';
  if (!hasFrom && !hasTo) return { ok: true, from: null, to: null };
  if (!hasFrom || !hasTo) {
    return { ok: false, error: 'from and to must be provided together' };
  }
  const start = parseCalendarDay(from, false);
  const end = parseCalendarDay(to, true);
  if (!start || !end) {
    return { ok: false, error: 'from and to must be dates (YYYY-MM-DD)' };
  }
  if (start > end) return { ok: false, error: 'from must be on or before to' };
  return { ok: true, from: start, to: end };
}

function filterTellerSales(sales, tellerId, range = {}) {
  const id = String(tellerId);
  const start = range.from || null;
  const end = range.to || null;
  return (Array.isArray(sales) ? sales : []).filter((sale) => {
    if (String(sale?.teller_id) !== id) return false;
    if (!start && !end) return true;
    const when = new Date(sale.sale_date);
    if (Number.isNaN(when.getTime())) return false;
    if (start && when < start) return false;
    if (end && when > end) return false;
    return true;
  });
}

module.exports = { parseMineRange, filterTellerSales, parseCalendarDay };
