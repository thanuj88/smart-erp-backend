const bcrypt = require('bcryptjs');
const { getAuthRepository } = require('../repositories/factory');
const authConfig = require('../config/auth');
const { ROLES, normalizeRole } = require('../config/permissions');
const tokenService = require('../services/tokenService');
const {
  buildStaffUsername,
  localPartFromInput,
  buildTenantPrefix,
} = require('../utils/staffUsername');

const STAFF_ROLES = [
  ROLES.MANAGER,
  ROLES.TELLER,
  ROLES.INVENTORY,
  ROLES.ACCOUNTANT,
];

const getAllUsers = async (req, res) => {
  try {
    const tenantId = req.user.role === ROLES.SUPER_ADMIN ? null : req.user.tenantId;
    const repo = getAuthRepository();
    const users = tenantId
      ? await repo.getStaffUsers(tenantId)
      : await repo.getStaffUsers(req.user.tenantId || 1);
    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const createUser = async (req, res) => {
  try {
    const { username, password, role, email, fullName, branchId, pin } = req.body;
    const tenantId = req.user.tenantId;
    const repo = getAuthRepository();

    if (!username || !password || !role) {
      return res.status(400).json({ error: 'Username, password, and role are required' });
    }

    const normalizedRole = normalizeRole(role);
    if (!STAFF_ROLES.includes(normalizedRole)) {
      return res.status(400).json({
        error: 'Staff role must be MANAGER, TELLER, INVENTORY, or ACCOUNTANT',
      });
    }

    const tenantMeta = await repo.getTenantMeta(tenantId);
    if (!tenantMeta) {
      return res.status(400).json({ error: 'Store not found' });
    }

    let finalUsername;
    try {
      finalUsername = buildStaffUsername(tenantMeta, localPartFromInput(tenantMeta, username));
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Invalid username' });
    }

    const existing = await repo.findUserByUsernameOrEmail(finalUsername, null);
    if (existing) {
      const prefix = buildTenantPrefix(tenantMeta);
      return res.status(400).json({
        error: `Username already taken. Use a different name after "${prefix}-"`,
      });
    }

    const hashedPassword = await bcrypt.hash(password, authConfig.bcryptRounds);
    let pinHash = null;
    if (pin) {
      pinHash = await tokenService.hashPin(pin);
    }

    const newUser = await repo.createStaffUser({
      tenantId,
      branchId: branchId || req.user.branchId,
      username: finalUsername,
      email,
      hashedPassword,
      role: normalizedRole,
      fullName,
      pinHash,
      isActive: true,
    });

    res.status(201).json(newUser);
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const updateUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const { username, role, fullName, branchId, pin } = req.body;
    const repo = getAuthRepository();

    const user = await repo.findUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (req.user.role !== ROLES.SUPER_ADMIN && user.tenant_id !== req.user.tenantId) {
      return res.status(403).json({ error: 'Cannot modify users outside your organization' });
    }

    if (role) {
      const normalizedRole = normalizeRole(role);
      if (normalizedRole === ROLES.SUPER_ADMIN || normalizedRole === ROLES.TENANT_ADMIN) {
        return res.status(400).json({ error: 'Cannot assign admin roles via this endpoint' });
      }
    }

    let pinHash;
    if (pin !== undefined) {
      pinHash = pin ? await tokenService.hashPin(pin) : null;
    }

    let finalUsername = username;
    if (username) {
      const tenantMeta = await repo.getTenantMeta(user.tenant_id);
      if (!tenantMeta) {
        return res.status(400).json({ error: 'Store not found' });
      }
      try {
        finalUsername = buildStaffUsername(tenantMeta, localPartFromInput(tenantMeta, username));
      } catch (err) {
        return res.status(400).json({ error: err.message || 'Invalid username' });
      }
      if (finalUsername.toLowerCase() !== String(user.username).toLowerCase()) {
        const existing = await repo.findUserByUsernameOrEmail(finalUsername, null);
        if (existing && String(existing.id) !== String(userId)) {
          const prefix = buildTenantPrefix(tenantMeta);
          return res.status(400).json({
            error: `Username already taken. Use a different name after "${prefix}-"`,
          });
        }
      }
    }

    const updated = await repo.updateStaffUser(userId, {
      username: finalUsername,
      role: role ? normalizeRole(role) : undefined,
      fullName,
      branchId,
      pinHash,
    });

    res.json(updated);
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;

    if (String(userId) === String(req.user.id)) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const repo = getAuthRepository();
    const user = await repo.findUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (req.user.role !== ROLES.SUPER_ADMIN && user.tenant_id !== req.user.tenantId) {
      return res.status(403).json({ error: 'Cannot delete users outside your organization' });
    }

    await repo.softDeleteStaffUser(userId);
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
};
