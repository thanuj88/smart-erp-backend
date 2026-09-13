/**
 * Staff usernames (teller, manager, accountant, inventory) are stored as:
 *   {tenantPrefix}-{localPart}
 * e.g. brightmart-john — globally unique across tenants for PIN/login lookups.
 */

function normalizePart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '')
    .slice(0, 40);
}

function buildTenantPrefix(tenantMeta) {
  if (tenantMeta?.slug) {
    const fromSlug = normalizePart(tenantMeta.slug);
    if (fromSlug) return fromSlug;
  }
  const id = String(tenantMeta?.tenantId ?? tenantMeta?.id ?? '').replace(/\D/g, '');
  const tail = id.slice(-8) || 'store';
  return `t${tail}`;
}

function buildStaffUsername(tenantMeta, localPart) {
  const prefix = buildTenantPrefix(tenantMeta);
  const local = normalizePart(localPart);
  if (!local) {
    const err = new Error('Username must contain letters or numbers');
    err.code = 'INVALID_USERNAME';
    throw err;
  }
  if (local.startsWith(`${prefix}-`)) {
    return local;
  }
  return `${prefix}-${local}`;
}

function localPartFromInput(tenantMeta, usernameInput) {
  const prefix = buildTenantPrefix(tenantMeta);
  const raw = String(usernameInput || '').trim().toLowerCase();
  const pref = `${prefix}-`;
  if (raw.startsWith(pref)) {
    return raw.slice(pref.length);
  }
  return raw;
}

module.exports = {
  normalizePart,
  buildTenantPrefix,
  buildStaffUsername,
  localPartFromInput,
};
