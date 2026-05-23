const permissionService = require('../services/permissionService');

const listPermissions = async (req, res) => {
  try {
    const permissions = await permissionService.listPermissions();
    res.json(permissions);
  } catch (error) {
    console.error('List permissions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const listRoles = async (req, res) => {
  try {
    const roles = await permissionService.listRoles();
    res.json(roles);
  } catch (error) {
    console.error('List roles error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const getRolePermissions = async (req, res) => {
  try {
    const role = await permissionService.getRoleWithPermissions(req.params.code);
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }
    res.json(role);
  } catch (error) {
    console.error('Get role permissions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const updateRolePermissions = async (req, res) => {
  try {
    const { permissions } = req.body;
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: 'permissions array is required' });
    }

    const validCodes = await permissionService.getValidPermissionCodes();
    const invalid = permissions.filter((c) => !validCodes.has(c));
    if (invalid.length) {
      return res.status(400).json({ error: 'Unknown permission codes', invalid });
    }

    const updated = await permissionService.setRolePermissions(req.params.code, permissions);
    res.json({
      code: req.params.code,
      permissions: updated,
      message: 'Role capabilities updated. Users must sign in again for changes to apply.',
    });
  } catch (error) {
    if (error.message?.includes('cannot be modified') || error.message?.includes('not found')) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Update role permissions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const createPermission = async (req, res) => {
  try {
    const { code, name, category } = req.body;
    if (!code || !name) {
      return res.status(400).json({ error: 'code and name are required' });
    }
    if (!/^[a-z][a-z0-9]*:[a-z][a-z0-9]*$/.test(code)) {
      return res.status(400).json({ error: 'code must be format category:action (e.g. sales:export)' });
    }
    const perm = await permissionService.createPermission({ code, name, category });
    res.status(201).json(perm);
  } catch (error) {
    if (error.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Permission code already exists' });
    }
    console.error('Create permission error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const createRole = async (req, res) => {
  try {
    const { code, name, description } = req.body;
    if (!code || !name) {
      return res.status(400).json({ error: 'code and name are required' });
    }
    const role = await permissionService.createRole({
      code: String(code).toUpperCase().replace(/\s+/g, '_'),
      name,
      description,
    });
    res.status(201).json(role);
  } catch (error) {
    console.error('Create role error:', error);
    res.status(400).json({ error: error.message || 'Server error' });
  }
};

module.exports = {
  listPermissions,
  listRoles,
  getRolePermissions,
  updateRolePermissions,
  createPermission,
  createRole,
};
