const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseSymbology,
  cleanBarcode,
  barcodeForUpdate,
  barcodeForCreate,
  expandUpcE,
  findByBarcode,
} = require('../utils/barcode');
const { mergeProductUpdate } = require('../utils/productWrite');

const rice = { id: '1', name: 'Rice', barcode: '036000291452' };
const soap = { id: '2', name: 'Soap', barcode: '04252614' };
const tagged = { id: '3', name: 'Shelf tag', barcode: 'SKU-10' };
const blank = { id: '4', name: 'Loose', barcode: '' };

test('UPC-E expands to the UPC-A used on the shelf label', () => {
  assert.equal(expandUpcE('04252614'), '042100005264');
  assert.equal(expandUpcE('01234565'), '012345000065');
  assert.equal(expandUpcE('22345670'), null);
  assert.equal(expandUpcE('123456789012'), null);
});

test('lookup matches UPC-A with its EAN-13 form and UPC-E only when the scanner says so', () => {
  const items = [rice, soap, tagged, blank];
  assert.deepEqual(findByBarcode(items, '0036000291452', 'ean13').map((item) => item.id), ['1']);
  assert.deepEqual(findByBarcode(items, '036000291452', 'upc_a').map((item) => item.id), ['1']);
  assert.deepEqual(findByBarcode(items, '04252614', 'upc_e').map((item) => item.id), ['2']);
  assert.deepEqual(findByBarcode(items, '042100005264', 'upc_a').map((item) => item.id), ['2']);
  assert.deepEqual(findByBarcode(items, 'sku-10', 'code128').map((item) => item.id), ['3']);
  assert.deepEqual(findByBarcode(items, '04252614', 'ean8').map((item) => item.id), ['2']);
  assert.deepEqual(
    findByBarcode([{ id: 'expanded', barcode: '042100005264' }], '04252614', 'ean8'),
    []
  );
  assert.deepEqual(findByBarcode(items, '', null), []);
  assert.deepEqual(findByBarcode(null, '036000291452', null), []);
});

test('two products with the same code are both returned', () => {
  const matches = findByBarcode(
    [
      { id: 'a', barcode: '111111111111' },
      { id: 'b', barcode: '0111111111111' },
    ],
    '111111111111',
    'upc_a'
  );
  assert.deepEqual(matches.map((item) => item.id), ['a', 'b']);
});

test('barcode text is trimmed and rejected when it is not a plain label', () => {
  assert.equal(cleanBarcode('  123  '), '123');
  assert.equal(cleanBarcode(null), '');
  assert.throws(() => cleanBarcode('x'.repeat(65)), /64 characters/);
  assert.throws(() => cleanBarcode('bad\ncode'), /plain letters/);
  assert.equal(parseSymbology('upc_e'), 'upc_e');
  assert.equal(parseSymbology(['nope']), null);
  assert.equal(parseSymbology(undefined), null);
});

test('create stores a barcode and update leaves it untouched unless the client sends one', () => {
  assert.equal(barcodeForCreate({}), '');
  assert.equal(barcodeForCreate({ barcode: '  ABC ' }), 'ABC');
  assert.equal(barcodeForUpdate({ name: 'Rice' }), undefined);
  assert.equal(barcodeForUpdate({ barcode: '' }), '');

  const existing = { name: 'Rice', description: '', buying_price: 4, selling_price: 10, quantity: 3, barcode: '036000291452', category: '', category_id: null, return_quantity: 2 };
  const kept = mergeProductUpdate(existing, { name: 'Rice 5kg', quantity: 9, returnQuantity: 0 });
  assert.equal(kept.barcode, undefined);
  assert.equal(kept.quantity, 9);
  assert.equal(kept.return_quantity, undefined);
  assert.equal(kept.name, 'Rice 5kg');

  const replaced = mergeProductUpdate(existing, { barcode: '111' });
  assert.equal(replaced.barcode, '111');
  assert.equal(replaced.selling_price, 10);

  const cleared = mergeProductUpdate(existing, { barcode: '' });
  assert.equal(cleared.barcode, '');
});
