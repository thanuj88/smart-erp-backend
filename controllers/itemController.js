const productService = require('../services/productService');
const { resolveTenantId } = require('../utils/tenant');

const getAllItems = async (req, res) => {
  try {
    const items = await productService.getAll(resolveTenantId(req));
    res.json(items);
  } catch (error) {
    console.error('Get items error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const getAvailableItems = async (req, res) => {
  try {
    const items = await productService.getAvailable(resolveTenantId(req));
    res.json(items);
  } catch (error) {
    console.error('Get available items error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const getItemById = async (req, res) => {
  try {
    const item = await productService.getById(resolveTenantId(req), req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (error) {
    console.error('Get item error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const createItem = async (req, res) => {
  try {
    const { name, description, buyingPrice, sellingPrice, quantity, category, categoryId } = req.body;
    if (!name || sellingPrice === undefined || quantity === undefined) {
      return res.status(400).json({ error: 'Name, selling price, and quantity are required' });
    }
    const newItem = await productService.create(resolveTenantId(req), {
      name,
      description,
      buyingPrice,
      sellingPrice,
      quantity,
      category,
      categoryId,
    });
    res.status(201).json(newItem);
  } catch (error) {
    console.error('Create item error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const updateItem = async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const item = await productService.getById(tenantId, req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const sellingPrice = req.body.sellingPrice ?? item.selling_price;
    const updatedItem = await productService.update(tenantId, req.params.id, {
      name: req.body.name ?? item.name,
      description: req.body.description ?? item.description,
      buyingPrice: req.body.buyingPrice ?? item.buying_price,
      sellingPrice,
      quantity: req.body.quantity ?? item.quantity,
      category: req.body.category ?? item.category,
      categoryId: req.body.categoryId ?? item.category_id,
    });
    res.json(updatedItem);
  } catch (error) {
    console.error('Update item error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const deleteItem = async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const item = await productService.getById(tenantId, req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    await productService.delete(tenantId, req.params.id);
    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    console.error('Delete item error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const searchItems = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Search query is required' });
    const items = await productService.search(resolveTenantId(req), q);
    res.json(items);
  } catch (error) {
    console.error('Search items error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const getItemsByCategory = async (req, res) => {
  try {
    const items = await productService.getByCategory(resolveTenantId(req), req.params.categoryId);
    res.json(items);
  } catch (error) {
    console.error('Get items by category error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getAllItems,
  getAvailableItems,
  getItemById,
  createItem,
  updateItem,
  deleteItem,
  searchItems,
  getItemsByCategory,
};
