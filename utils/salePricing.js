/**
 * Prices a bill the same way the POS does, from catalog data.
 * Client totals are not trusted. Shipping and discount inputs are teller charges;
 * the amounts are recomputed here and capped so a discount cannot exceed the bill.
 */

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function parseBillAmount(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseBillPercent(value) {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, 100);
}

function promotionMatchesItem(promo, item) {
  if (!promo) return false;
  const applies = promo.applies_to || 'all';
  if (applies === 'all') return true;
  const itemId = String(item?.id ?? '');
  const categoryId = String(item?.category_id ?? '');
  if (applies === 'items') {
    return (promo.item_ids || []).map(String).includes(itemId);
  }
  if (applies === 'categories') {
    return (promo.category_ids || []).map(String).includes(categoryId);
  }
  return false;
}

const SPECIFICITY = { items: 3, categories: 2, all: 1 };

function bestPromotion(item, promotions = []) {
  const matches = (promotions || []).filter((promo) => promotionMatchesItem(promo, item));
  if (matches.length === 0) return null;
  return [...matches].sort((a, b) => {
    const byPercent = Number(b.percent || 0) - Number(a.percent || 0);
    if (byPercent !== 0) return byPercent;
    return (SPECIFICITY[b.applies_to] || 0) - (SPECIFICITY[a.applies_to] || 0);
  })[0];
}

function applyPromotionPrice(item, promotions = []) {
  const listPrice = Number(item?.selling_price ?? item?.price ?? 0);
  const promotion = bestPromotion(item, promotions);
  if (!promotion) {
    return { listPrice, chargedUnit: listPrice, promotion: null };
  }
  const chargedUnit = roundMoney(listPrice * (1 - Number(promotion.percent || 0) / 100));
  return { listPrice, chargedUnit, promotion };
}

function readChargeInput(body = {}) {
  return {
    shipping: body.shipping,
    shippingPercent: body.shippingPercent ?? body.shipping_percent,
    discount: body.discount,
    discountPercent: body.discountPercent ?? body.discount_percent,
  };
}

function computeCharges(itemsTotal, input = {}) {
  const shippingPct = parseBillPercent(input.shippingPercent);
  const discountPct = parseBillPercent(input.discountPercent);
  const shippingAmount = roundMoney(
    parseBillAmount(input.shipping) + itemsTotal * (shippingPct / 100)
  );
  const maxDiscount = itemsTotal + shippingAmount;
  const discountAmount = roundMoney(
    Math.min(parseBillAmount(input.discount) + itemsTotal * (discountPct / 100), maxDiscount)
  );
  const grandTotal = roundMoney(Math.max(0, itemsTotal + shippingAmount - discountAmount));
  return { shippingAmount, shippingPct, discountAmount, discountPct, grandTotal };
}

/**
 * Spread shipping and discount across lines by merchandise share.
 * The last line takes the leftover cents so the booked totals equal the grand total.
 */
function allocateCharges(pricedLines, charges) {
  const merchandise = pricedLines.map((line) => roundMoney(line.chargedUnit * line.quantity));
  const itemsTotal = roundMoney(merchandise.reduce((sum, value) => sum + value, 0));
  let shippingLeft = charges.shippingAmount;
  let discountLeft = charges.discountAmount;
  let bookedLeft = charges.grandTotal;

  return pricedLines.map((line, index) => {
    const isLast = index === pricedLines.length - 1;
    const share = itemsTotal > 0 ? merchandise[index] / itemsTotal : index === 0 ? 1 : 0;
    const shippingShare = isLast ? shippingLeft : roundMoney(charges.shippingAmount * share);
    const discountShare = isLast ? discountLeft : roundMoney(charges.discountAmount * share);
    const total = isLast
      ? bookedLeft
      : roundMoney(merchandise[index] + shippingShare - discountShare);
    const buying = Number(line.item?.buying_price) || 0;
    const profit = roundMoney(total - buying * line.quantity);
    if (!isLast) {
      shippingLeft = roundMoney(shippingLeft - shippingShare);
      discountLeft = roundMoney(discountLeft - discountShare);
      bookedLeft = roundMoney(bookedLeft - total);
    }
    return {
      ...line,
      merchandise: merchandise[index],
      shippingShare,
      discountShare,
      total,
      profit,
    };
  });
}

function priceBill(resolvedLines, promotions, chargeInput = {}) {
  const priced = (resolvedLines || []).map((line) => {
    const { listPrice, chargedUnit, promotion } = applyPromotionPrice(line.item, promotions);
    return {
      ...line,
      listPrice,
      chargedUnit,
      promotionId: promotion?.id || null,
      promotionPercent: promotion ? Number(promotion.percent) || 0 : 0,
    };
  });
  const itemsTotal = roundMoney(
    priced.reduce((sum, line) => sum + roundMoney(line.chargedUnit * line.quantity), 0)
  );
  const charges = computeCharges(itemsTotal, chargeInput);
  const lines = allocateCharges(priced, charges);
  return {
    lines,
    itemsTotal,
    shippingAmount: charges.shippingAmount,
    discountAmount: charges.discountAmount,
    grandTotal: charges.grandTotal,
  };
}

/** Unit a refund should use. Older sales have no charged price, so they stay on list price. */
function bookedUnitPrice(sale) {
  const qty = Number(sale?.quantity) || 0;
  const hasCharge =
    sale?.charged_unit_price != null ||
    sale?.shipping_share != null ||
    sale?.discount_share != null;
  if (qty > 0 && hasCharge && Number.isFinite(Number(sale.total))) {
    return roundMoney(Number(sale.total) / qty);
  }
  return Number(sale?.selling_price ?? sale?.price) || 0;
}

function saleChargeFields(line, bill) {
  return {
    selling_price: line.listPrice,
    price: line.chargedUnit,
    charged_unit_price: line.chargedUnit,
    promotion_id: line.promotionId,
    promotion_percent: line.promotionPercent,
    list_total: line.merchandise,
    shipping_amount: bill.shippingAmount,
    discount_amount: bill.discountAmount,
    shipping_share: line.shippingShare,
    discount_share: line.discountShare,
    total: line.total,
    profit: line.profit,
  };
}

module.exports = {
  roundMoney,
  readChargeInput,
  priceBill,
  bookedUnitPrice,
  saleChargeFields,
  applyPromotionPrice,
};
