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
const staffUserService = require('../services/staffUserService');
const { withoutCredentialFields } = require('../utils/publicUser');
const { isStaffRole, STAFF_ROLE_ERROR } = require('../config/staffRoles');

const getAllUsers = async (req, res) => {
  try {
    const isMissing = (v) => v === undefined || v === null || v === '';
    let tenantId;
    if (req.user.role === ROLES.SUPER_ADMIN) {
      // The platform account has tenantId 0, which is not a shop. It must name the shop it wants.
      const requested = req.query.tenantId;
      if (isMissing(requested) || typeof requested !== 'string' || !/^\d+$/.test(requested) || Number(requested) < 1) {
        return res.status(400).json({
          error: 'tenantId query parameter is required. Use /api/platform/users for platform staff.',
        });
      }
      tenantId = Number(requested);
    } else {
      // 0 is a valid-looking falsy value, so test for missing explicitly and never fall back to tenant 1.
      if (isMissing(req.user.tenantId)) {
        return res.status(403).json({ error: 'No shop is associated with this account' });
      }
      tenantId = req.user.tenantId;
    }
    const repo = getAuthRepository();
    const users = await repo.getStaffUsers(tenantId);
    res.json(withoutCredentialFields(users));
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

    if (!email || !password || !role) {
      return res.status(400).json({ error: 'Email, password, and role are required' });
    }

    if (!isStaffRole(role)) {
      return res.status(400).json({ error: STAFF_ROLE_ERROR });
    }
    const normalizedRole = normalizeRole(role);

    let finalUsername;
    let normalizedEmail;
    try {
      ({ finalUsername, normalizedEmail } = await staffUserService.prepareStaffUserCreate({
        tenantId,
        username,
        email,
        role: normalizedRole,
      }));
    } catch (err) {
      return res.status(err.statusCode || 400).json({ error: err.message });
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
      email: normalizedEmail,
      hashedPassword,
      role: normalizedRole,
      fullName,
      pinHash,
      isActive: true,
    });

    res.status(201).json(withoutCredentialFields(newUser));
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

    if (role !== undefined && role !== null && role !== '') {
      // Same allowlist as create. Admin roles and any custom role name are refused.
      if (!isStaffRole(role)) {
        return res.status(400).json({ error: STAFF_ROLE_ERROR });
      }
      const normalizedRole = normalizeRole(role);
      try {
        await staffUserService.assertStaffRoleChange(user.tenant_id, normalizedRole, user.role);
      } catch (quotaErr) {
        return res.status(quotaErr.statusCode || 403).json({ error: quotaErr.message });
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
      role: role !== undefined && role !== null && role !== '' ? normalizeRole(role) : undefined,
      fullName,
      branchId,
      pinHash,
    });

    res.json(withoutCredentialFields(updated));
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
