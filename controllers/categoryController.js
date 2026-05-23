const categoryService = require('../services/categoryService');
const { resolveTenantId } = require('../utils/tenant');

exports.getCategories = async (req, res) => {
  try {
    const categories = await categoryService.getAll(resolveTenantId(req));
    res.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ message: 'Failed to fetch categories', error: error.message });
  }
};

exports.getCategoryById = async (req, res) => {
  try {
    const category = await categoryService.getById(resolveTenantId(req), req.params.id);
    if (!category) return res.status(404).json({ message: 'Category not found' });
    res.json(category);
  } catch (error) {
    console.error('Error fetching category:', error);
    res.status(500).json({ message: 'Failed to fetch category', error: error.message });
  }
};

exports.createCategory = async (req, res) => {
  try {
    const { name, description, icon } = req.body;
    if (!name) return res.status(400).json({ message: 'Category name is required' });

    const newCategory = await categoryService.create(resolveTenantId(req), { name, description, icon });
    res.status(201).json({ message: 'Category created successfully', category: newCategory });
  } catch (error) {
    console.error('Error creating category:', error);
    if (error.message?.includes('UNIQUE')) {
      return res.status(400).json({ message: 'Category name already exists' });
    }
    res.status(500).json({ message: 'Failed to create category', error: error.message });
  }
};

exports.updateCategory = async (req, res) => {
  try {
    const { name, description, icon } = req.body;
    const tenantId = resolveTenantId(req);
    const categoryId = req.params.id;

    if (!name) return res.status(400).json({ message: 'Category name is required' });

    const existingCategory = await categoryService.getById(tenantId, categoryId);
    if (!existingCategory) return res.status(404).json({ message: 'Category not found' });

    const updatedCategory = await categoryService.update(tenantId, categoryId, { name, description, icon });
    res.json({ message: 'Category updated successfully', category: updatedCategory });
  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({ message: 'Failed to update category', error: error.message });
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const categoryId = req.params.id;

    const existingCategory = await categoryService.getById(tenantId, categoryId);
    if (!existingCategory) return res.status(404).json({ message: 'Category not found' });

    const itemsCount = await categoryService.getItemsCount(tenantId, categoryId);
    if (itemsCount?.count > 0) {
      return res.status(400).json({
        message: `Cannot delete category. It has ${itemsCount.count} item(s) assigned to it.`,
      });
    }

    await categoryService.delete(tenantId, categoryId);
    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ message: 'Failed to delete category', error: error.message });
  }
};

exports.searchCategories = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ message: 'Search query is required' });
    const categories = await categoryService.search(resolveTenantId(req), q);
    res.json(categories);
  } catch (error) {
    console.error('Error searching categories:', error);
    res.status(500).json({ message: 'Failed to search categories', error: error.message });
  }
};
