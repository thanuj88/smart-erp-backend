const Category = require('../models/Category');

// Get all categories
exports.getCategories = (req, res) => {
  try {
    const categories = Category.getAll();
    res.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ message: 'Failed to fetch categories', error: error.message });
  }
};

// Get category by ID
exports.getCategoryById = (req, res) => {
  try {
    const category = Category.getById(req.params.id);
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    res.json(category);
  } catch (error) {
    console.error('Error fetching category:', error);
    res.status(500).json({ message: 'Failed to fetch category', error: error.message });
  }
};

// Create new category
exports.createCategory = (req, res) => {
  try {
    const { name, description, icon } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Category name is required' });
    }

    const categoryId = Category.create(name, description, icon);
    const newCategory = Category.getById(categoryId);
    
    res.status(201).json({
      message: 'Category created successfully',
      category: newCategory
    });
  } catch (error) {
    console.error('Error creating category:', error);
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ message: 'Category name already exists' });
    }
    res.status(500).json({ message: 'Failed to create category', error: error.message });
  }
};

// Update category
exports.updateCategory = (req, res) => {
  try {
    const { name, description, icon } = req.body;
    const categoryId = req.params.id;

    if (!name) {
      return res.status(400).json({ message: 'Category name is required' });
    }

    const existingCategory = Category.getById(categoryId);
    if (!existingCategory) {
      return res.status(404).json({ message: 'Category not found' });
    }

    Category.update(categoryId, name, description, icon);
    const updatedCategory = Category.getById(categoryId);
    
    res.json({
      message: 'Category updated successfully',
      category: updatedCategory
    });
  } catch (error) {
    console.error('Error updating category:', error);
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ message: 'Category name already exists' });
    }
    res.status(500).json({ message: 'Failed to update category', error: error.message });
  }
};

// Delete category
exports.deleteCategory = (req, res) => {
  try {
    const categoryId = req.params.id;

    const existingCategory = Category.getById(categoryId);
    if (!existingCategory) {
      return res.status(404).json({ message: 'Category not found' });
    }

    // Check if category has items
    const itemsCount = Category.getItemsCountByCategory(categoryId);
    if (itemsCount && itemsCount.count > 0) {
      return res.status(400).json({ 
        message: `Cannot delete category. It has ${itemsCount.count} item(s) assigned to it. Please reassign or delete those items first.` 
      });
    }

    Category.delete(categoryId);
    
    res.json({
      message: 'Category deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ message: 'Failed to delete category', error: error.message });
  }
};

// Search categories
exports.searchCategories = (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q) {
      return res.status(400).json({ message: 'Search query is required' });
    }

    const categories = Category.searchByName(q);
    res.json(categories);
  } catch (error) {
    console.error('Error searching categories:', error);
    res.status(500).json({ message: 'Failed to search categories', error: error.message });
  }
};
