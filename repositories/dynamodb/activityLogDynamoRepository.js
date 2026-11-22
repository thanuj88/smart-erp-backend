const crypto = require('crypto');
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const BaseDynamoRepository = require('./baseDynamoRepository');
const ENTITY = require('../entityTypes');
const { tenantPk } = require('../../utils/tenant');

const RETENTION_SECONDS = 90 * 24 * 60 * 60;
const PREFIX = `${ENTITY.ACTIVITY_LOG}#`;

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

/** Date-only values cover that whole UTC day. A full timestamp is used as given. */
function boundIso(value, end) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return end ? `${text}T23:59:59.999Z` : `${text}T00:00:00.000Z`;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw badRequest('Invalid date');
  return date.toISOString();
}

function rangeKeys(from, to) {
  const start = boundIso(from, false);
  const end = boundIso(to, true);
  if (start && end && start > end) throw badRequest('from must be on or before to');
  return {
    fromSk: start ? `${PREFIX}${start}` : PREFIX,
    toSk: end ? `${PREFIX}${end}\uffff` : `${PREFIX}\uffff`,
  };
}

function encodeCursor(key) {
  if (!key) return null;
  return Buffer.from(JSON.stringify({ PK: key.PK, SK: key.SK }), 'utf8').toString('base64url');
}

function decodeCursor(cursor, tenantId) {
  if (!cursor) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
  } catch {
    throw badRequest('Invalid cursor');
  }
  const pk = tenantPk(tenantId);
  if (!parsed || parsed.PK !== pk || typeof parsed.SK !== 'string' || !parsed.SK.startsWith(PREFIX)) {
    throw badRequest('Invalid cursor');
  }
  return { PK: parsed.PK, SK: parsed.SK };
}

function present(item) {
  return {
    id: item.id,
    action: item.action,
    target_id: item.target_id ?? null,
    target_label: item.target_label ?? null,
    user_id: item.user_id ?? null,
    user_email: item.user_email ?? null,
    detail: item.detail ?? null,
    created_at: item.created_at,
  };
}

class ActivityLogDynamoRepository extends BaseDynamoRepository {
  constructor() {
    super(ENTITY.ACTIVITY_LOG);
  }

  async record(tenantId, entry) {
    const createdAt = entry.created_at || new Date().toISOString();
    const suffix = crypto.randomBytes(2).toString('hex');
    const entityId = `${createdAt}#${suffix}`;
    const ttl = Number.isInteger(entry.ttl)
      ? entry.ttl
      : Math.floor(Date.now() / 1000) + RETENTION_SECONDS;
    const item = {
      action: entry.action,
      target_id: entry.target_id,
      target_label: entry.target_label,
      detail: entry.detail,
      user_id: entry.user_id,
      user_email: entry.user_email,
      created_at: createdAt,
      createdAt,
      ttl,
    };
    const compact = Object.fromEntries(
      Object.entries(item).filter(([, value]) => value !== null && value !== undefined && value !== '')
    );
    return this.put(tenantId, entityId, compact);
  }

  /**
   * Newest first. `from`/`to` are ISO dates or timestamps. `action`, `userId` and `email`
   * are equality filters. `cursor` is the previous page's nextCursor.
   */
  async list(tenantId, options = {}) {
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 50));
    const { fromSk, toSk } = rangeKeys(options.from, options.to);
    const startKey = decodeCursor(options.cursor, tenantId);

    const names = {};
    const values = {
      ':pk': this.pk(tenantId),
      ':from': fromSk,
      ':to': toSk,
    };
    const filters = [];
    if (options.action) {
      names['#action'] = 'action';
      values[':action'] = options.action;
      filters.push('#action = :action');
    }
    if (options.userId) {
      names['#user_id'] = 'user_id';
      values[':userId'] = String(options.userId);
      filters.push('#user_id = :userId');
    }
    if (options.email) {
      names['#user_email'] = 'user_email';
      values[':email'] = String(options.email).trim().toLowerCase();
      filters.push('#user_email = :email');
    }

    // A filter drops rows after Dynamo applies Limit, so keep reading until the page is full.
    const collected = [];
    let exclusive = startKey;
    let nextKey = null;
    const maxRounds = 20;
    for (let round = 0; round < maxRounds && collected.length < limit; round += 1) {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
          ExpressionAttributeValues: values,
          ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
          ...(filters.length ? { FilterExpression: filters.join(' AND ') } : {}),
          ScanIndexForward: false,
          Limit: limit - collected.length,
          ...(exclusive ? { ExclusiveStartKey: exclusive } : {}),
        })
      );
      collected.push(...(result.Items || []).map((item) => present(this.fromRecord(item))));
      nextKey = result.LastEvaluatedKey || null;
      if (!nextKey) break;
      exclusive = nextKey;
    }

    return {
      items: collected,
      nextCursor: nextKey ? encodeCursor(nextKey) : null,
    };
  }
}

module.exports = new ActivityLogDynamoRepository();
module.exports.rangeKeys = rangeKeys;
module.exports.RETENTION_SECONDS = RETENTION_SECONDS;
