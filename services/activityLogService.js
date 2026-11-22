const { getActivityLogRepository } = require('../repositories/factory');
const { resolveTenantId } = require('../utils/tenant');

const RETENTION_DAYS = 90;
const RETENTION_SECONDS = RETENTION_DAYS * 24 * 60 * 60;
const DETAIL_MAX = 120;

const ACTIONS = {
  ITEM_CREATED: 'ITEM_CREATED',
  ITEM_UPDATED: 'ITEM_UPDATED',
  ITEM_DELETED: 'ITEM_DELETED',
  ORDER_CREATED: 'ORDER_CREATED',
  RETURN_CREATED: 'RETURN_CREATED',
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_DELETED: 'USER_DELETED',
};

const KNOWN_ACTIONS = new Set(Object.values(ACTIONS));

function clip(value, max) {
  if (value == null || value === '') return null;
  const text = String(value);
  return text.length <= max ? text : text.slice(0, max);
}

function same(from, to) {
  if ((from == null || from === '') && (to == null || to === '')) return true;
  const left = Number(from);
  const right = Number(to);
  if (from !== '' && to !== '' && !Number.isNaN(left) && !Number.isNaN(right)) return left === right;
  return String(from) === String(to);
}

/** Names of fields whose values differ. Values themselves are not returned. */
function changedNames(pairs) {
  const names = pairs.filter((pair) => !same(pair.from, pair.to)).map((pair) => pair.name);
  return names.length ? names.join(', ') : null;
}

function buildEntry(req, input) {
  const user = req?.user || {};
  const now = new Date();
  const email = user.email ? String(user.email).trim().toLowerCase() : '';
  return {
    action: input.action,
    target_id: clip(input.targetId, 80),
    target_label: clip(input.targetLabel, 120),
    detail: clip(input.detail, DETAIL_MAX),
    user_id: user.id != null && user.id !== '' ? String(user.id) : null,
    user_email: clip(email, 120),
    created_at: now.toISOString(),
    ttl: Math.floor(now.getTime() / 1000) + RETENTION_SECONDS,
  };
}

/**
 * Best-effort. A logging failure is reported and never fails the action that just succeeded.
 * Only action, target, detail and the signed-in user are stored. Extra fields on `input`
 * (passwords, PINs, hashes) are ignored.
 */
async function record(req, input = {}) {
  try {
    if (!KNOWN_ACTIONS.has(input.action)) {
      throw new Error(`Unknown activity action: ${input.action}`);
    }
    const tenantId = input.tenantId != null && input.tenantId !== ''
      ? input.tenantId
      : resolveTenantId(req);
    await getActivityLogRepository().record(tenantId, buildEntry(req, input));
  } catch (err) {
    console.error('Activity log error:', err.message);
  }
}

function list(tenantId, query) {
  return getActivityLogRepository().list(tenantId, query);
}

module.exports = {
  ACTIONS,
  RETENTION_DAYS,
  DETAIL_MAX,
  changedNames,
  buildEntry,
  record,
  list,
};
