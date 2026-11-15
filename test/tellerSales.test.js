const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMineRange, filterTellerSales } = require('../utils/tellerSales');
const { redactMoneyFields } = require('../utils/costVisibility');

const at = (year, month, day, hour, minute) => new Date(year, month - 1, day, hour, minute).toISOString();

test('mine range accepts a pair of calendar dates or neither', () => {
  const open = parseMineRange(undefined, undefined);
  assert.equal(open.ok, true);
  assert.equal(open.from, null);

  const ranged = parseMineRange('2026-11-01', '2026-11-14');
  assert.equal(ranged.ok, true);
  assert.equal(ranged.from.getDate(), 1);
  assert.equal(ranged.to.getDate(), 14);
  assert.equal(ranged.to.getHours(), 23);

  assert.equal(parseMineRange('2026-11-01', '').ok, false);
  assert.equal(parseMineRange('2026-13-01', '2026-11-14').ok, false);
  assert.equal(parseMineRange('2026-11-20', '2026-11-01').ok, false);
});

test('teller sales stay on that teller and honour an inclusive local day range', () => {
  const rows = [
    { id: 'a', teller_id: 7, sale_date: at(2026, 11, 14, 0, 10), total: 10, profit: 2, buying_price: 4 },
    { id: 'b', teller_id: '7', sale_date: at(2026, 11, 14, 23, 30), total: 20, profit: 5, buying_price: 8 },
    { id: 'c', teller_id: '7', sale_date: at(2026, 11, 15, 0, 5), total: 30, profit: 1, buying_price: 9 },
    { id: 'd', teller_id: '8', sale_date: at(2026, 11, 14, 12, 0), total: 99, profit: 40, buying_price: 10 },
    { id: 'e', teller_id: '7', sale_date: 'not-a-date', total: 1 },
  ];
  const range = parseMineRange('2026-11-14', '2026-11-14');
  const mine = filterTellerSales(rows, '7', range);
  assert.deepEqual(mine.map((row) => row.id), ['a', 'b']);

  const allMine = filterTellerSales(rows, 7, parseMineRange(null, null));
  assert.deepEqual(
    allMine.map((row) => row.id),
    ['a', 'b', 'c', 'e']
  );
  assert.deepEqual(filterTellerSales(null, '7', {}), []);
});

test('cost and profit fields are removed for a caller who cannot see them', () => {
  const [row] = redactMoneyFields(
    [{ item_name: 'Rice', total: 20, profit: 5, buying_price: 8, total_purchase: 8, purchase: 8 }],
    { cost: false, profit: false }
  );
  assert.deepEqual(row, { item_name: 'Rice', total: 20 });
});
