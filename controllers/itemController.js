const productService = require('../services/productService');
const { resolveTenantId } = require('../utils/tenant');
const { saveImage } = require('../utils/saveImage');
const { barcodeForCreate, barcodeForUpdate, parseSymbology } = require('../utils/barcode');

function rejectBarcode(res, error) {
  if (error && error.status) {
    res.status(error.status).json({ error: error.message });
    return true;
  }
  return false;
}

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

const getItemByBarcode = async (req, res) => {
  try {
    const code = String(req.params.code || req.query.code || '').trim();
    if (!code) return res.status(400).json({ error: 'Barcode is required' });
    if (code.length > 64) return res.status(400).json({ error: 'Barcode must be 64 characters or fewer' });
    const matches = await productService.getByBarcode(
      resolveTenantId(req),
      code,
      parseSymbology(req.query.type)
    );
    if (matches.length === 0) return res.status(404).json({ error: 'No product uses this barcode' });
    if (matches.length > 1) {
      return res.status(409).json({ error: 'More than one product uses this barcode', matches });
    }
    res.json(matches[0]);
  } catch (error) {
    console.error('Barcode lookup error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const createItem = async (req, res) => {
  try {
    const { name, description, buyingPrice, sellingPrice, quantity, category, categoryId } = req.body;
    if (!name || sellingPrice === undefined || quantity === undefined) {
      return res.status(400).json({ error: 'Name, selling price, and quantity are required' });
    }
    let barcode = '';
    try {
      barcode = barcodeForCreate(req.body);
    } catch (error) {
      if (rejectBarcode(res, error)) return;
      throw error;
    }
    const newItem = await productService.create(resolveTenantId(req), {
      name,
      description,
      buyingPrice,
      sellingPrice,
      quantity,
      category,
      categoryId,
      barcode,
      imagePath: req.body.image
        ? saveImage(
            req.body.image,
            'products',
            `product_${Date.now()}${Math.floor(Math.random() * 1000)}.jpg`
          )
        : null,
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

    // Return stock only changes through returns and the release endpoint. A free edit let staff
    // raise the floor without lowering return stock, cloning returned units into sellable stock.
    const sentReturnQty = req.body.returnQuantity ?? req.body.return_quantity;
    if (
      sentReturnQty !== undefined &&
      sentReturnQty !== null &&
      sentReturnQty !== '' &&
      Number(sentReturnQty) !== Number(item.return_quantity ?? 0)
    ) {
      return res.status(400).json({
        error: 'Return stock cannot be edited here. Use "Release to sellable stock" to move units back.',
      });
    }

    const sellingPrice = req.body.sellingPrice ?? item.selling_price;
    let imagePath = item.image_path;
    if (req.body.image) {
      imagePath = saveImage(
        req.body.image,
        'products',
        `product_${req.params.id}_${Date.now()}.jpg`
      );
    } else if (req.body.removeImage) {
      imagePath = null;
    }

    let barcode;
    try {
      barcode = barcodeForUpdate(req.body);
    } catch (error) {
      if (rejectBarcode(res, error)) return;
      throw error;
    }

    const updatedItem = await productService.update(tenantId, req.params.id, {
      name: req.body.name ?? item.name,
      description: req.body.description ?? item.description,
      buyingPrice: req.body.buyingPrice ?? item.buying_price,
      sellingPrice,
      quantity: req.body.quantity ?? item.quantity,
      category: req.body.category ?? item.category,
      categoryId: req.body.categoryId ?? item.category_id,
      imagePath,
      ...(barcode !== undefined ? { barcode } : {}),
    });
    res.json(updatedItem);
  } catch (error) {
    console.error('Update item error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const releaseReturns = async (req, res) => {
  try {
    const item = await productService.releaseReturnQuantity(
      resolveTenantId(req),
      req.params.id,
      req.body.quantity
    );
    res.json(item);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({
        error: error.message,
        ...(error.available !== undefined ? { available: error.available } : {}),
      });
    }
    console.error('Release returns error:', error);
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
  getItemByBarcode,
  getItemById,
  createItem,
  updateItem,
  releaseReturns,
  deleteItem,
  searchItems,
  getItemsByCategory,
};
