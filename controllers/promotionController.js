const promotionService = require('../services/promotionService');
const { resolveTenantId } = require('../utils/tenant');
const { APPLIES_TO } = require('../repositories/dynamodb/promotionDynamoRepository');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validatePromotionBody(body) {
  const name = String(body?.name || '').trim();
  if (!name) return 'Promotion name is required';

  const percent = Number(body?.percent);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
    return 'Promotion percentage must be between 0 and 100';
  }

  const startDate = String(body?.start_date || '').trim();
  const endDate = String(body?.end_date || '').trim();
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    return 'Start date and end date are required';
  }
  if (endDate < startDate) return 'End date must be on or after the start date';

  const appliesTo = body?.applies_to || 'all';
  if (!APPLIES_TO.has(appliesTo)) {
    return 'Applies to must be all, categories, or items';
  }
  if (appliesTo === 'categories' && !Array.isArray(body.category_ids)) {
    return 'Select at least one category';
  }
  if (appliesTo === 'categories' && body.category_ids.filter(Boolean).length === 0) {
    return 'Select at least one category';
  }
  if (appliesTo === 'items' && (!Array.isArray(body.item_ids) || body.item_ids.filter(Boolean).length === 0)) {
    return 'Select at least one item';
  }
  return null;
}

function payloadFromBody(body) {
  return {
    name: String(body.name || '').trim(),
    percent: Number(body.percent),
    start_date: body.start_date,
    end_date: body.end_date,
    applies_to: body.applies_to || 'all',
    category_ids: body.category_ids || [],
    item_ids: body.item_ids || [],
    active: body.active !== false,
  };
}

exports.getPromotions = async (req, res) => {
  try {
    const promotions = await promotionService.getAll(resolveTenantId(req));
    res.json(promotions);
  } catch (error) {
    console.error('Error fetching promotions:', error);
    res.status(500).json({ message: 'Failed to fetch promotions', error: error.message });
  }
};

exports.getActivePromotions = async (req, res) => {
  try {
    const promotions = await promotionService.getActive(resolveTenantId(req));
    res.json(promotions);
  } catch (error) {
    console.error('Error fetching active promotions:', error);
    res.status(500).json({ message: 'Failed to fetch active promotions', error: error.message });
  }
};

exports.getPromotionById = async (req, res) => {
  try {
    const promotion = await promotionService.getById(resolveTenantId(req), req.params.id);
    if (!promotion) return res.status(404).json({ message: 'Promotion not found' });
    res.json(promotion);
  } catch (error) {
    console.error('Error fetching promotion:', error);
    res.status(500).json({ message: 'Failed to fetch promotion', error: error.message });
  }
};

exports.createPromotion = async (req, res) => {
  try {
    const error = validatePromotionBody(req.body);
    if (error) return res.status(400).json({ message: error });

    const promotion = await promotionService.create(resolveTenantId(req), payloadFromBody(req.body));
    res.status(201).json({ message: 'Promotion created successfully', promotion });
  } catch (error) {
    console.error('Error creating promotion:', error);
    res.status(500).json({ message: 'Failed to create promotion', error: error.message });
  }
};

exports.updatePromotion = async (req, res) => {
  try {
    const error = validatePromotionBody(req.body);
    if (error) return res.status(400).json({ message: error });

    const tenantId = resolveTenantId(req);
    const existing = await promotionService.getById(tenantId, req.params.id);
    if (!existing) return res.status(404).json({ message: 'Promotion not found' });

    const promotion = await promotionService.update(tenantId, req.params.id, payloadFromBody(req.body));
    res.json({ message: 'Promotion updated successfully', promotion });
  } catch (error) {
    console.error('Error updating promotion:', error);
    res.status(500).json({ message: 'Failed to update promotion', error: error.message });
  }
};

exports.deletePromotion = async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const existing = await promotionService.getById(tenantId, req.params.id);
    if (!existing) return res.status(404).json({ message: 'Promotion not found' });

    await promotionService.delete(tenantId, req.params.id);
    res.json({ message: 'Promotion deleted successfully' });
  } catch (error) {
    console.error('Error deleting promotion:', error);
    res.status(500).json({ message: 'Failed to delete promotion', error: error.message });
  }
};
