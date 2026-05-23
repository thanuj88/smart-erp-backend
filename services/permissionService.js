const { getRbacRepository } = require('../repositories/factory');
const { normalizeRole } = require('../config/permissions');

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

function cacheKey(role) {
  return normalizeRole(role);
}

function getCached(role) {
  const key = cacheKey(role);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.permissions;
}

function setCache(role, permissions) {
  cache.set(cacheKey(role), {
    permissions,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function invalidateCache(roleCode) {
  if (roleCode) {
    cache.delete(cacheKey(roleCode));
  } else {
    cache.clear();
  }
}

async function ensureSeeded() {
  const repo = getRbacRepository();
  return repo.seedFromCatalog();
}

async function getPermissionsForRole(role) {
  const normalized = normalizeRole(role);
  if (!normalized) return [];

  const cached = getCached(normalized);
  if (cached) return cached;

  const repo = getRbacRepository();
  const permissions = await repo.getPermissionCodesForRole(normalized);
  setCache(normalized, permissions);
  return permissions;
}

async function listPermissions() {
  return getRbacRepository().listPermissions();
}

async function listRoles() {
  const roles = await getRbacRepository().listRoles();
  return roles.map((r) => ({ ...r, system: r.code === 'SUPER_ADMIN' }));
}

async function getRoleWithPermissions(roleCode) {
  const repo = getRbacRepository();
  const roles = await repo.listRoles();
  const role = roles.find((r) => r.code === roleCode);
  if (!role) return null;
  const permissions = await repo.getPermissionCodesForRole(roleCode);
  return { ...role, permissions, system: role.code === 'SUPER_ADMIN' };
}

async function setRolePermissions(roleCode, permissionCodes) {
  const codes = await getRbacRepository().setRolePermissions(roleCode, permissionCodes);
  invalidateCache(roleCode);
  return codes;
}

async function createPermission(data) {
  const result = await getRbacRepository().createPermission(data);
  invalidateCache();
  return result;
}

async function createRole(data) {
  const result = await getRbacRepository().createRole(data);
  return result;
}

async function getValidPermissionCodes() {
  const perms = await listPermissions();
  return new Set(perms.map((p) => p.code));
}

module.exports = {
  ensureSeeded,
  getPermissionsForRole,
  listPermissions,
  listRoles,
  getRoleWithPermissions,
  setRolePermissions,
  createPermission,
  createRole,
  getValidPermissionCodes,
  invalidateCache,
};
