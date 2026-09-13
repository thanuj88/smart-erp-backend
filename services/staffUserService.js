const { getAuthRepository } = require('../repositories/factory');
const { ROLES, normalizeRole } = require('../config/permissions');
const {
  buildStaffUsername,
  localPartFromInput,
  normalizeEmail,
} = require('../utils/staffUsername');
const planQuotaService = require('./planQuotaService');

const QUOTA_ROLES = [ROLES.MANAGER, ROLES.TELLER, ROLES.ACCOUNTANT];

function httpError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Resolve unique email, generated username, and plan quota for user creation.
 */
async function prepareStaffUserCreate({ tenantId, username, email, role }) {
  const normalizedRole = normalizeRole(role);
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw httpError('Email is required');
  }

  const repo = getAuthRepository();
  const existingEmail = await repo.findUserByUsernameOrEmail(normalizedEmail, null);
  if (existingEmail) {
    throw httpError('An account with this email already exists', 409);
  }

  if (normalizedRole === ROLES.SUPER_ADMIN) {
    if (tenantId) {
      throw httpError('Super admin cannot belong to a tenant');
    }
    const finalUsername = username
      ? String(username).trim()
      : await repo.uniqueUsernameFromEmail(null, normalizedEmail);
    if (!finalUsername) {
      throw httpError('Could not create an account name from this email');
    }
    const existingUser = await repo.findUserByUsernameOrEmail(finalUsername, null);
    if (existingUser) {
      throw httpError('An account with this email already exists', 409);
    }
    return { finalUsername, normalizedEmail, normalizedRole, tenantId: 0 };
  }

  if (!tenantId) {
    throw httpError('Tenant is required for store users');
  }

  const tenantMeta = await repo.getTenantMeta(tenantId);
  if (!tenantMeta) {
    throw httpError('Store not found');
  }

  let finalUsername;
  try {
    finalUsername = username
      ? buildStaffUsername(tenantMeta, localPartFromInput(tenantMeta, username))
      : await repo.uniqueUsernameFromEmail(tenantMeta, normalizedEmail);
  } catch (err) {
    throw httpError(err.message || 'Invalid account name');
  }

  const existingUser = await repo.findUserByUsernameOrEmail(finalUsername, null);
  if (existingUser) {
    finalUsername = await repo.uniqueUsernameFromEmail(tenantMeta, normalizedEmail);
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
    normalizedEmail,
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
  httpError,
};
