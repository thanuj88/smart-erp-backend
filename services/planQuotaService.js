const { getAuthRepository, getPlatformRepository } = require('../repositories/factory');
const { ROLES, normalizeRole } = require('../config/permissions');

const ROLE_LIMIT_FIELD = {
  [ROLES.TELLER]: 'max_tellers',
  [ROLES.MANAGER]: 'max_managers',
  [ROLES.ACCOUNTANT]: 'max_accountants',
};

const ROLE_LABEL = {
  [ROLES.TELLER]: 'Teller',
  [ROLES.MANAGER]: 'Manager',
  [ROLES.ACCOUNTANT]: 'Accountant',
};

function planLimit(plan, field) {
  if (!plan) return null;
  const value = plan[field];
  if (value === null || value === undefined || value === '') return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

async function getTenantPlan(tenantId) {
  const platform = getPlatformRepository();
  const tenant = await platform.getTenant(tenantId);
  if (!tenant?.plan_code) return null;
  const plans = await platform.listPlans();
  return plans.find((p) => p.code === tenant.plan_code) || null;
}

async function countStaffByRole(tenantId) {
  const users = await getAuthRepository().getStaffUsers(tenantId);
  const counts = {
    [ROLES.TELLER]: 0,
    [ROLES.MANAGER]: 0,
    [ROLES.ACCOUNTANT]: 0,
    [ROLES.INVENTORY]: 0,
  };
  users.forEach((u) => {
    const role = normalizeRole(u.role);
    if (counts[role] !== undefined) counts[role] += 1;
  });
  return counts;
}

function buildQuotaError(plan, role, limit) {
  const label = ROLE_LABEL[role] || role;
  const planName = plan?.name || plan?.code || 'current';
  const err = new Error(
    `Your "${planName}" plan allows up to ${limit} ${label} account(s). Upgrade your plan or remove an existing user before adding another.`
  );
  err.statusCode = 403;
  return err;
}

async function assertCanAddStaff(tenantId, role) {
  const normalized = normalizeRole(role);
  const field = ROLE_LIMIT_FIELD[normalized];
  if (!field) return;

  const plan = await getTenantPlan(tenantId);
  if (!plan) return;

  const limit = planLimit(plan, field);
  if (limit === null) return;

  const counts = await countStaffByRole(tenantId);
  const current = counts[normalized] || 0;
  if (current >= limit) {
    throw buildQuotaError(plan, normalized, limit);
  }
}

async function assertCanAssignRole(tenantId, newRole, previousRole = null) {
  const next = normalizeRole(newRole);
  const prev = previousRole ? normalizeRole(previousRole) : null;
  if (next === prev) return;

  const field = ROLE_LIMIT_FIELD[next];
  if (!field) return;

  const plan = await getTenantPlan(tenantId);
  if (!plan) return;

  const limit = planLimit(plan, field);
  if (limit === null) return;

  const counts = await countStaffByRole(tenantId);
  let current = counts[next] || 0;
  if (prev === next) return;
  if (current >= limit) {
    throw buildQuotaError(plan, next, limit);
  }
}

module.exports = {
  getTenantPlan,
  countStaffByRole,
  assertCanAddStaff,
  assertCanAssignRole,
};
