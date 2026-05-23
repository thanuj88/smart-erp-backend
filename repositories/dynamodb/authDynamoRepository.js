const { PutCommand, GetCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { getDynamoClient } = require('../../config/dynamodb');
const databaseConfig = require('../../config/dataStore');
const { tenantPk, entitySk } = require('../../utils/tenant');
const {
  PLATFORM_INDEX_PK,
  PLATFORM_INDEX_PKS,
} = require('../../utils/platformKeys');
const { hashToken } = require('../../utils/tokens');
const authConfig = require('../../config/auth');
const { ROLES } = require('../../config/permissions');
const ENTITY = require('../entityTypes');
const BaseDynamoRepository = require('./baseDynamoRepository');

const PLATFORM_TENANT = 0;
const META_SK = 'METADATA';
const TRIAL_SK = 'TRIAL';
const SUBSCRIPTION_SK = 'SUBSCRIPTION';

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'store';
}

function lookupSk(type, value) {
  return `LOOKUP#${type}#${String(value).toLowerCase()}`;
}

class AuthDynamoRepository {
  constructor() {
    this.client = getDynamoClient();
    this.tableName = databaseConfig.dynamodb.tableName;
    this.users = new BaseDynamoRepository(ENTITY.USER);
    this.branches = new BaseDynamoRepository(ENTITY.BRANCH);
    this.refreshTokens = new BaseDynamoRepository('REFRESH_TOKEN');
    this.verifyTokens = new BaseDynamoRepository('VERIFY_TOKEN');
    this.resetTokens = new BaseDynamoRepository('RESET_TOKEN');
    this.auditLogs = new BaseDynamoRepository('AUDIT_LOG');
  }

  _platformPk() {
    return PLATFORM_INDEX_PK;
  }

  async _getLookup(type, value) {
    const sk = lookupSk(type, value);
    for (const pk of PLATFORM_INDEX_PKS) {
      const res = await this.client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { PK: pk, SK: sk },
        })
      );
      if (res.Item) return res.Item;
    }
    return null;
  }

  async _putLookup(type, value, tenantId, userId = null) {
    const item = {
      PK: PLATFORM_INDEX_PK,
      SK: lookupSk(type, value),
      entityType: 'LOOKUP',
      lookupType: type,
      lookupValue: String(value).toLowerCase(),
      tenantId,
    };
    if (userId != null) item.userId = String(userId);
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      })
    );
  }

  async _slugExists(slug) {
    const sk = lookupSk('SLUG', slug);
    for (const pk of PLATFORM_INDEX_PKS) {
      const item = await this.client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { PK: pk, SK: sk },
        })
      );
      if (item.Item) return true;
    }
    return false;
  }

  async uniqueSlug(base) {
    let slug = slugify(base);
    let n = 0;
    while (await this._slugExists(slug)) {
      n += 1;
      slug = `${slugify(base)}-${n}`;
    }
    return slug;
  }

  _normalizeUser(item) {
    if (!item) return null;
    const id = item.entityId || item.id;
    return {
      id,
      tenant_id: item.tenant_id ?? item.tenantId,
      branch_id: item.branch_id ?? item.branchId,
      username: item.username,
      email: item.email,
      password: item.password ?? item.password_hash ?? item.passwordHash,
      pin_hash: item.pin_hash ?? item.pinHash,
      full_name: item.full_name ?? item.fullName,
      role: item.role,
      is_active: item.is_active ?? item.isActive,
      email_verified_at: item.email_verified_at ?? item.emailVerifiedAt,
      failed_login_attempts: item.failed_login_attempts ?? 0,
      locked_until: item.locked_until ?? item.lockedUntil,
      deleted_at: item.deleted_at ?? item.deletedAt,
      created_at: item.created_at ?? item.createdAt,
      updated_at: item.updated_at ?? item.updatedAt,
    };
  }

  async findUserByUsernameOrEmail(identifier, tenantId = null) {
    if (tenantId) {
      const users = await this.users.queryByTenant(tenantId, {
        filter: (u) =>
          !u.deleted_at &&
          (u.username === identifier || u.email === identifier),
      });
      return users[0] ? this._normalizeUser(users[0]) : null;
    }

    const byUser = await this._getLookup('USERNAME', identifier);
    const byEmail = await this._getLookup('EMAIL', identifier);
    const ref = byUser || byEmail;
    if (!ref) {
      const users = await this.users.queryByTenant(databaseConfig.defaultTenantId, {
        filter: (u) =>
          !u.deleted_at &&
          (u.username === identifier || u.email === identifier),
      });
      return users[0] ? this._normalizeUser(users[0]) : null;
    }
    return this.findUserWithPassword(ref.userId, ref.tenantId);
  }

  async findUserById(id, tenantIdHint = null) {
    if (tenantIdHint != null) {
      const u = await this.users.getById(tenantIdHint, id);
      if (u && !u.deleted_at) return this._normalizeUser(u);
      return null;
    }
    const tenants = [databaseConfig.defaultTenantId, PLATFORM_TENANT];
    for (const t of tenants) {
      const u = await this.users.getById(t, id);
      if (u && !u.deleted_at) return this._normalizeUser(u);
    }
    const all = await this.users.queryByTenant(databaseConfig.defaultTenantId);
    const found = all.find((u) => String(u.id) === String(id) && !u.deleted_at);
    return found ? this._normalizeUser(found) : null;
  }

  async findUserWithPassword(id, tenantIdHint = null) {
    if (tenantIdHint != null) {
      const full = await this.users.getById(tenantIdHint, id);
      return full && !full.deleted_at ? this._normalizeUser(full) : null;
    }
    const user = await this.findUserById(id);
    if (!user) return null;
    const tenantId = user.tenant_id ?? PLATFORM_TENANT;
    const full = await this.users.getById(tenantId, id);
    return full ? this._normalizeUser(full) : user;
  }

  async getTrialForTenant(tenantId) {
    const res = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: tenantPk(tenantId), SK: TRIAL_SK },
      })
    );
    return res.Item || null;
  }

  async isTrialExpired(tenantId) {
    const trial = await this.getTrialForTenant(tenantId);
    if (!trial) return false;
    if (trial.status === 'expired') return true;
    return new Date(trial.ends_at) < new Date();
  }

  async registerTenantOwner({ businessName, fullName, email, username, passwordHash }) {
    const slug = await this.uniqueSlug(businessName || email);
    const tenantId = `${Date.now()}`;
    const branchId = `${Date.now()}1`;
    const userId = `${Date.now()}2`;

    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + authConfig.trialDays);

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: tenantPk(tenantId),
          SK: META_SK,
          entityType: ENTITY.TENANT,
          name: businessName || 'My Store',
          slug,
          status: 'active',
          tenantId,
        },
      })
    );

    await this._putLookup('SLUG', slug, tenantId, null);

    await this.branches.put(tenantId, branchId, {
      name: 'Main Branch',
      code: 'MAIN',
      is_default: 1,
    });

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: tenantPk(tenantId),
          SK: TRIAL_SK,
          entityType: 'TRIAL',
          tenant_id: tenantId,
          started_at: new Date().toISOString(),
          ends_at: endsAt.toISOString(),
          status: 'active',
        },
      })
    );

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: tenantPk(tenantId),
          SK: SUBSCRIPTION_SK,
          entityType: 'SUBSCRIPTION',
          tenant_id: tenantId,
          plan_code: 'trial',
          status: 'trialing',
          started_at: new Date().toISOString(),
          ends_at: endsAt.toISOString(),
        },
      })
    );

    await this.users.put(tenantId, userId, {
      tenant_id: tenantId,
      branch_id: branchId,
      username,
      email,
      password: passwordHash,
      full_name: fullName,
      role: ROLES.TENANT_ADMIN,
      is_active: 0,
    });

    await this._putLookup('USERNAME', username, tenantId, userId);
    await this._putLookup('EMAIL', email, tenantId, userId);

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: PLATFORM_INDEX_PK,
          SK: `TENANT_REF#${tenantId}`,
          entityType: 'TENANT_REF',
          tenantId: String(tenantId),
          name: businessName || 'My Store',
          slug,
          status: 'active',
          createdAt: new Date().toISOString(),
        },
      })
    );

    return { tenantId, branchId, userId, trialEndsAt: endsAt.toISOString() };
  }

  async _resolveTenantIdForUser(userId) {
    const user = await this.findUserWithPassword(userId);
    if (user?.tenant_id != null) return user.tenant_id;

    const tenants = await this._listTenantIds();
    for (const tid of tenants) {
      const u = await this.users.getById(tid, userId);
      if (u && !u.deleted_at) return tid;
    }
    return PLATFORM_TENANT;
  }

  async createVerificationToken(userId, rawToken, tenantIdHint = null) {
    const tenantId =
      tenantIdHint != null ? tenantIdHint : await this._resolveTenantIdForUser(userId);
    const expires = new Date();
    expires.setHours(expires.getHours() + authConfig.verificationTokenHours);
    const tokenId = hashToken(rawToken).slice(0, 32);
    await this.verifyTokens.put(tenantId, tokenId, {
      user_id: String(userId),
      tenant_id: String(tenantId),
      token_hash: hashToken(rawToken),
      expires_at: expires.toISOString(),
    });
    return expires;
  }

  async _activateVerifiedUser(userId, tenantIdHint = null) {
    const userTenantId =
      tenantIdHint != null ? tenantIdHint : await this._resolveTenantIdForUser(userId);
    const verifiedAt = new Date().toISOString();
    await this.users.update(userTenantId, userId, {
      is_active: 1,
      email_verified_at: verifiedAt,
    });
    return { user_id: userId, tenant_id: userTenantId };
  }

  async consumeVerificationToken(rawToken) {
    const hash = hashToken(rawToken);
    const tenants = await this._listTenantIds();
    let matchedRow = null;
    let matchedTenantPk = null;

    for (const tenantId of tenants) {
      const tokens = await this.verifyTokens.queryByTenant(tenantId, {
        filter: (t) => t.token_hash === hash,
      });
      const active = tokens.find(
        (t) => !t.used_at && new Date(t.expires_at) > new Date()
      );
      if (active) {
        matchedRow = active;
        matchedTenantPk = tenantId;
        break;
      }
      if (!matchedRow && tokens.length) {
        matchedRow = tokens[0];
        matchedTenantPk = tenantId;
      }
    }

    if (!matchedRow) return null;

    const userTenantId =
      matchedRow.tenant_id ??
      matchedRow.tenantId ??
      (await this._resolveTenantIdForUser(matchedRow.user_id));

    if (!matchedRow.used_at) {
      await this.verifyTokens.update(matchedTenantPk, matchedRow.id, {
        used_at: new Date().toISOString(),
      });
    }

    return this._activateVerifiedUser(matchedRow.user_id, userTenantId);
  }

  async createPasswordResetToken(userId, rawToken, tenantIdHint = null) {
    const tenantId =
      tenantIdHint != null ? tenantIdHint : await this._resolveTenantIdForUser(userId);
    const expires = new Date();
    expires.setHours(expires.getHours() + authConfig.resetTokenHours);
    const tokenId = hashToken(rawToken).slice(0, 32);
    await this.resetTokens.put(tenantId, tokenId, {
      user_id: String(userId),
      tenant_id: String(tenantId),
      token_hash: hashToken(rawToken),
      expires_at: expires.toISOString(),
    });
    return expires;
  }

  async consumePasswordResetToken(rawToken) {
    const hash = hashToken(rawToken);
    const tenants = await this._listTenantIds();
    for (const tenantId of tenants) {
      const tokens = await this.resetTokens.queryByTenant(tenantId, {
        filter: (t) => t.token_hash === hash && !t.used_at && new Date(t.expires_at) > new Date(),
      });
      if (tokens.length) {
        const row = tokens[0];
        await this.resetTokens.update(tenantId, row.id, { used_at: new Date().toISOString() });
        return { user_id: row.user_id };
      }
    }
    return null;
  }

  async _listTenantIds() {
    const ids = new Set([String(databaseConfig.defaultTenantId), String(PLATFORM_TENANT)]);

    for (const pk of PLATFORM_INDEX_PKS) {
      const refs = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': pk,
            ':sk': 'TENANT_REF#',
          },
        })
      );
      (refs.Items || []).forEach((i) => {
        if (i.tenantId != null) ids.add(String(i.tenantId));
      });
    }

    const res = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': tenantPk(databaseConfig.defaultTenantId),
          ':sk': `${ENTITY.USER}#`,
        },
      })
    );
    (res.Items || []).forEach((i) => ids.add(String(i.tenantId || i.tenant_id)));
    return [...ids];
  }

  async updatePassword(userId, passwordHash) {
    const user = await this.findUserWithPassword(userId);
    const tenantId = user.tenant_id ?? PLATFORM_TENANT;
    await this.users.update(tenantId, userId, {
      password: passwordHash,
      failed_login_attempts: 0,
      locked_until: null,
    });
  }

  async recordFailedLogin(userId) {
    const user = await this.findUserWithPassword(userId);
    if (!user) return;
    const attempts = (user.failed_login_attempts || 0) + 1;
    let lockedUntil = null;
    if (attempts >= authConfig.maxLoginAttempts) {
      const lock = new Date();
      lock.setMinutes(lock.getMinutes() + authConfig.lockoutMinutes);
      lockedUntil = lock.toISOString();
    }
    const tenantId = user.tenant_id ?? PLATFORM_TENANT;
    await this.users.update(tenantId, userId, {
      failed_login_attempts: attempts,
      locked_until: lockedUntil,
    });
  }

  async clearFailedLogins(userId) {
    const user = await this.findUserWithPassword(userId);
    if (!user) return;
    const tenantId = user.tenant_id ?? PLATFORM_TENANT;
    await this.users.update(tenantId, userId, {
      failed_login_attempts: 0,
      locked_until: null,
    });
  }

  async listBranchesForTenant(tenantId) {
    return this.branches.queryByTenant(tenantId, {
      filter: (b) => !b.deleted_at,
    });
  }

  async findUserForPinLogin(username, tenantId, branchId) {
    const tid = tenantId || databaseConfig.defaultTenantId;
    const users = await this.users.queryByTenant(tid, {
      filter: (u) =>
        !u.deleted_at &&
        u.username === username &&
        u.role === ROLES.TELLER &&
        u.is_active &&
        u.email_verified_at &&
        u.pin_hash &&
        (!branchId || !u.branch_id || String(u.branch_id) === String(branchId)),
    });
    return users[0] ? this._normalizeUser(users[0]) : null;
  }

  async setUserPin(userId, pinHash) {
    const user = await this.findUserWithPassword(userId);
    const tenantId = user.tenant_id ?? PLATFORM_TENANT;
    await this.users.update(tenantId, userId, { pin_hash: pinHash });
  }

  async storeRefreshToken(userId, refreshToken, meta = {}) {
    const user = await this.findUserWithPassword(userId);
    const tenantId = user?.tenant_id ?? PLATFORM_TENANT;
    const tokenHash = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + authConfig.refreshTokenExpiryMs).toISOString();
    const tokenId = tokenHash.slice(0, 32);
    await this.refreshTokens.put(tenantId, tokenId, {
      user_id: userId,
      token_hash: tokenHash,
      device_name: meta.deviceName || null,
      device_info: meta.deviceInfo ? JSON.stringify(meta.deviceInfo) : null,
      ip_address: meta.ipAddress || null,
      expires_at: expiresAt,
    });
    return tokenId;
  }

  async findRefreshToken(refreshToken) {
    const tokenHash = hashToken(refreshToken);
    const tenants = await this._listTenantIds();
    for (const tenantId of tenants) {
      const tokens = await this.refreshTokens.queryByTenant(tenantId, {
        filter: (t) =>
          t.token_hash === tokenHash &&
          !t.revoked_at &&
          new Date(t.expires_at) > new Date(),
      });
      if (tokens.length) {
        const rt = tokens[0];
        const user = await this.findUserWithPassword(rt.user_id);
        if (!user) return null;
        return {
          ...rt,
          user_id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          tenant_id: user.tenant_id,
          branch_id: user.branch_id,
          is_active: user.is_active,
          email_verified_at: user.email_verified_at,
          deleted_at: user.deleted_at,
        };
      }
    }
    return null;
  }

  async revokeRefreshToken(refreshToken) {
    const stored = await this.findRefreshToken(refreshToken);
    if (!stored) return;
    const tenantId = stored.tenant_id ?? PLATFORM_TENANT;
    await this.refreshTokens.update(tenantId, stored.id, {
      revoked_at: new Date().toISOString(),
    });
  }

  async revokeRefreshTokenById(id, userId) {
    const user = await this.findUserWithPassword(userId);
    const tenantId = user?.tenant_id ?? PLATFORM_TENANT;
    await this.refreshTokens.update(tenantId, id, {
      revoked_at: new Date().toISOString(),
    });
  }

  async listUserSessions(userId) {
    const user = await this.findUserWithPassword(userId);
    const tenantId = user?.tenant_id ?? PLATFORM_TENANT;
    return this.refreshTokens.queryByTenant(tenantId, {
      filter: (t) => String(t.user_id) === String(userId),
    });
  }

  async logAuthEvent({ tenantId, userId, eventType, eventData, ipAddress, userAgent }) {
    const tid = tenantId ?? PLATFORM_TENANT;
    const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    await this.auditLogs.put(tid, id, {
      tenant_id: tenantId,
      user_id: userId,
      event_type: eventType,
      event_data: eventData ? JSON.stringify(eventData) : null,
      ip_address: ipAddress,
      user_agent: userAgent,
    });
  }

  async getStaffUsers(tenantId) {
    const users = await this.users.queryByTenant(tenantId, {
      filter: (u) => !u.deleted_at,
    });
    return users.map((u) => this._normalizeUser(u));
  }

  async createStaffUser({ tenantId, branchId, username, email, hashedPassword, role, fullName, pinHash, isActive }) {
    const userId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    await this.users.put(tenantId, userId, {
      tenant_id: tenantId,
      branch_id: branchId,
      username,
      email,
      password: hashedPassword,
      full_name: fullName || username,
      role,
      pin_hash: pinHash,
      is_active: isActive ? 1 : 0,
      email_verified_at: isActive ? new Date().toISOString() : null,
    });
    await this._putLookup('USERNAME', username, tenantId, userId);
    if (email) await this._putLookup('EMAIL', email, tenantId, userId);
    return this.findUserById(userId);
  }

  async updateStaffUser(id, { username, role, fullName, branchId, pinHash }) {
    const user = await this.findUserWithPassword(id);
    if (!user) return null;
    const tenantId = user.tenant_id ?? PLATFORM_TENANT;
    const data = {
      username: username ?? user.username,
      role: role ?? user.role,
      full_name: fullName ?? user.full_name,
      branch_id: branchId !== undefined ? branchId : user.branch_id,
    };
    if (pinHash !== undefined) data.pin_hash = pinHash;
    await this.users.update(tenantId, id, data);
    return this.findUserById(id);
  }

  async softDeleteStaffUser(id) {
    const user = await this.findUserWithPassword(id);
    if (!user) return;
    const tenantId = user.tenant_id ?? PLATFORM_TENANT;
    await this.users.update(tenantId, id, { deleted_at: new Date().toISOString() });
  }
}

module.exports = new AuthDynamoRepository();
