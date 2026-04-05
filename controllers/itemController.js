const Item = require('../models/Item');

// Get all items
const getAllItems = (req, res) => {
  try {
    const items = Item.getAll();
    res.json(items);
  } catch (error) {
    console.error('Get items error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get available items (quantity > 0)
const getAvailableItems = (req, res) => {
  try {
    const items = Item.getAvailable();
    res.json(items);
  } catch (error) {
    console.error('Get available items error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get item by ID
const getItemById = (req, res) => {
  try {
    const item = Item.getById(req.params.id);
    
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json(item);
  } catch (error) {
    console.error('Get item error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Create new item (Admin only)
const createItem = (req, res) => {
  try {
    const { name, description, buyingPrice, sellingPrice, price, quantity, category, categoryId } = req.body;

    if (!name || sellingPrice === undefined || price === undefined || quantity === undefined) {
      return res.status(400).json({ error: 'Name, prices, and quantity are required' });
    }

    const itemId = Item.create(name, description || '', buyingPrice || 0, sellingPrice, price, quantity, category || '', categoryId);
    const newItem = Item.getById(itemId);

    res.status(201).json(newItem);
  } catch (error) {
    console.error('Create item error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Update item (Admin only)
const updateItem = (req, res) => {
  try {
    const { name, description, buyingPrice, sellingPrice, price, quantity, category, categoryId } = req.body;
    const itemId = req.params.id;

    const item = Item.getById(itemId);
    
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    Item.update(
      itemId,
      name !== undefined ? name : item.name,
      description !== undefined ? description : item.description,
      buyingPrice !== undefined ? buyingPrice : item.buying_price,
      sellingPrice !== undefined ? sellingPrice : item.selling_price,
      price !== undefined ? price : item.price,
      quantity !== undefined ? quantity : item.quantity,
      category !== undefined ? category : item.category,
      categoryId !== undefined ? categoryId : item.category_id
    );

    const updatedItem = Item.getById(itemId);
    res.json(updatedItem);
  } catch (error) {
    console.error('Update item error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Delete item (Admin only)
const deleteItem = (req, res) => {
  try {
    const item = Item.getById(req.params.id);
    
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    Item.delete(req.params.id);
    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    console.error('Delete item error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Search items by name
const searchItems = (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const items = Item.searchByName(q);
    res.json(items);
  } catch (error) {
    console.error('Search items error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get items by category
const getItemsByCategory = (req, res) => {
  try {
    const categoryId = req.params.categoryId;
    const items = Item.getByCategory(categoryId);
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
  getItemsByCategory
};
