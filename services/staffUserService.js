const { getAuthRepository } = require('../repositories/factory');
const { ROLES, normalizeRole } = require('../config/permissions');
const {
  buildStaffUsername,
  localPartFromInput,
  buildTenantPrefix,
} = require('../utils/staffUsername');
const planQuotaService = require('./planQuotaService');

const QUOTA_ROLES = [ROLES.MANAGER, ROLES.TELLER, ROLES.ACCOUNTANT];

function httpError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Resolve prefixed username, global uniqueness, and plan quota for tenant staff creation.
 */
async function prepareStaffUserCreate({ tenantId, username, role }) {
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === ROLES.SUPER_ADMIN) {
    if (tenantId) {
      throw httpError('Super admin cannot belong to a tenant');
    }
    const finalUsername = String(username || '').trim();
    if (!finalUsername) {
      throw httpError('Username is required');
    }
    const repo = getAuthRepository();
    const existing = await repo.findUserByUsernameOrEmail(finalUsername, null);
    if (existing) {
      throw httpError('Username already taken');
    }
    return { finalUsername, normalizedRole, tenantId: 0 };
  }

  if (!tenantId) {
    throw httpError('Tenant is required for store users');
  }

  const repo = getAuthRepository();
  const tenantMeta = await repo.getTenantMeta(tenantId);
  if (!tenantMeta) {
    throw httpError('Store not found');
  }

  let finalUsername;
  try {
    finalUsername = buildStaffUsername(tenantMeta, localPartFromInput(tenantMeta, username));
  } catch (err) {
    throw httpError(err.message || 'Invalid username');
  }

  const existing = await repo.findUserByUsernameOrEmail(finalUsername, null);
  if (existing) {
    const prefix = buildTenantPrefix(tenantMeta);
    throw httpError(`Username already taken. Use a different name after "${prefix}-"`);
  }

  if (QUOTA_ROLES.includes(normalizedRole)) {
    try {
      await planQuotaService.assertCanAddStaff(tenantId, normalizedRole);
    } catch (quotaErr) {
      throw httpError(quotaErr.message, quotaErr.statusCode || 403);
    }
  }

  return {
    finalUsername,
    normalizedRole,
    tenantId: String(tenantId),
    tenantMeta,
  };
}

async function assertStaffRoleChange(tenantId, newRole, previousRole) {
  if (!tenantId) return;
  const next = normalizeRole(newRole);
  const prev = normalizeRole(previousRole);
  if (next === prev) return;
  if (!QUOTA_ROLES.includes(next)) return;
  try {
    await planQuotaService.assertCanAssignRole(tenantId, next, prev);
  } catch (quotaErr) {
    throw httpError(quotaErr.message, quotaErr.statusCode || 403);
  }
}

module.exports = {
  prepareStaffUserCreate,
  assertStaffRoleChange,
};
