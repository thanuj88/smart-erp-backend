/**
 * Fields written by `PUT /items/:id`.
 * `return_quantity` is never included: returns and release-to-stock own that column.
 * `barcode` is included only when the client sent it, so older clients keep the stored code.
 */

function sellingPrice(data, existing) {
  const raw =
    data.sellingPrice ??
    data.selling_price ??
    existing?.selling_price ??
    existing?.price;
  return raw != null && raw !== '' ? Number(raw) : 0;
}

function mergeProductUpdate(existing, data) {
  const price = sellingPrice(data, existing);
  const merged = {
    name: data.name ?? existing.name,
    description: data.description ?? existing.description,
    buying_price: data.buyingPrice ?? data.buying_price ?? existing.buying_price,
    selling_price: price,
    price,
    quantity: data.quantity ?? existing.quantity,
    category: data.category ?? existing.category,
    category_id: data.categoryId ?? data.category_id ?? existing.category_id,
  };
  if (data.imagePath !== undefined || data.image_path !== undefined) {
    merged.image_path = data.imagePath ?? data.image_path ?? null;
  }
  if (data.barcode !== undefined) {
    merged.barcode = data.barcode || '';
  }
  return merged;
}

module.exports = { sellingPrice, mergeProductUpdate };
