const { PutCommand, GetCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const bcrypt = require('bcryptjs');
const { getDynamoClient } = require('../../config/dynamodb');
const databaseConfig = require('../../config/dataStore');
const { tenantPk } = require('../../utils/tenant');
const authConfig = require('../../config/auth');
const { ROLES, normalizeRole } = require('../../config/permissions');
const authDynamo = require('./authDynamoRepository');
const ENTITY = require('../entityTypes');

const PLATFORM_PK = 'PLATFORM#0';
const META_SK = 'METADATA';
const TRIAL_SK = 'TRIAL';
const SUBSCRIPTION_SK = 'SUBSCRIPTION';

const DEFAULT_PLANS = [
  { code: 'trial', name: 'Free Trial', description: '14-day trial for new stores', price_monthly: 0, max_users: 5 },
  { code: 'starter', name: 'Starter', description: 'Small shop plan', price_monthly: 29, max_users: 10 },
  { code: 'business', name: 'Business', description: 'Growing business plan', price_monthly: 79, max_users: 25 },
  { code: 'enterprise', name: 'Enterprise', description: 'Unlimited features', price_monthly: 199, max_users: null },
];

class PlatformDynamoRepository {
  constructor() {
    this.client = getDynamoClient();
    this.tableName = databaseConfig.dynamodb.tableName;
  }

  async _tenantRefPut(tenantId, name, slug, status) {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: PLATFORM_PK,
          SK: `TENANT_REF#${tenantId}`,
          entityType: 'TENANT_REF',
          tenantId: String(tenantId),
          name,
          slug,
          status,
          updatedAt: new Date().toISOString(),
        },
      })
    );
  }

  async _countUsersForTenant(tenantId) {
    const users = await authDynamo.users.queryByTenant(tenantId, {
      filter: (u) => !u.deleted_at,
    });
    return users.length;
  }

  async listTenants() {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': PLATFORM_PK, ':sk': 'TENANT_REF#' },
      })
    );
    const refs = result.Items || [];
    const tenants = await Promise.all(
      refs.map(async (ref) => {
        const tenantId = ref.tenantId;
        const meta = await this.client.send(
          new GetCommand({
            TableName: this.tableName,
            Key: { PK: tenantPk(tenantId), SK: META_SK },
          })
        );
        const sub = await this.client.send(
          new GetCommand({
            TableName: this.tableName,
            Key: { PK: tenantPk(tenantId), SK: SUBSCRIPTION_SK },
          })
        );
        const trial = await this.client.send(
          new GetCommand({
            TableName: this.tableName,
            Key: { PK: tenantPk(tenantId), SK: TRIAL_SK },
          })
        );
        return {
          id: tenantId,
          name: meta.Item?.name || ref.name,
          slug: meta.Item?.slug || ref.slug,
          status: ref.status || meta.Item?.status || 'active',
          plan_code: sub.Item?.plan_code,
          subscription_status: sub.Item?.status,
          subscription_ends_at: sub.Item?.ends_at,
          trial_status: trial.Item?.status,
          trial_ends_at: trial.Item?.ends_at,
          user_count: await this._countUsersForTenant(tenantId),
          created_at: meta.Item?.createdAt,
        };
      })
    );
    return tenants.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  async getTenant(id) {
    const meta = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: tenantPk(id), SK: META_SK },
      })
    );
    if (!meta.Item) return null;
    const sub = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: tenantPk(id), SK: SUBSCRIPTION_SK },
      })
    );
    const branches = await authDynamo.branches.queryByTenant(id);
    return {
      id,
      name: meta.Item.name,
      slug: meta.Item.slug,
      status: meta.Item.status,
      plan_code: sub.Item?.plan_code,
      subscription_status: sub.Item?.status,
      subscription_ends_at: sub.Item?.ends_at,
      branches,
    };
  }

  async createTenant({ name, slug, planCode, adminUsername, adminEmail, adminPassword, adminFullName }) {
    const uniqueSlug = await authDynamo.uniqueSlug(slug || name);
    const plans = await this.listPlans();
    const effectivePlan = plans.find((p) => p.code === (planCode || 'trial'))?.code || 'trial';

    const tenantId = `${Date.now()}`;
    const branchId = `${Date.now()}1`;
    const userId = `${Date.now()}2`;
    const now = new Date().toISOString();
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + authConfig.trialDays);

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: tenantPk(tenantId),
          SK: META_SK,
          entityType: ENTITY.TENANT,
          name,
          slug: uniqueSlug,
          status: 'active',
          tenantId,
          createdAt: now,
        },
      })
    );
    await this._tenantRefPut(tenantId, name, uniqueSlug, 'active');

    await authDynamo.branches.put(tenantId, branchId, {
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
          started_at: now,
          ends_at: endsAt.toISOString(),
          status: effectivePlan === 'trial' ? 'active' : 'converted',
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
          plan_code: effectivePlan,
          status: effectivePlan === 'trial' ? 'trialing' : 'active',
          started_at: now,
          ends_at: endsAt.toISOString(),
        },
      })
    );

    const hash = await bcrypt.hash(adminPassword, authConfig.bcryptRounds);
    await authDynamo.users.put(tenantId, userId, {
      tenant_id: tenantId,
      branch_id: branchId,
      username: adminUsername,
      email: adminEmail || null,
      password: hash,
      full_name: adminFullName || adminUsername,
      role: ROLES.TENANT_ADMIN,
      is_active: 1,
      email_verified_at: now,
    });
    await authDynamo._putLookup('USERNAME', adminUsername, tenantId, userId);
    if (adminEmail) await authDynamo._putLookup('EMAIL', adminEmail, tenantId, userId);

    return { tenantId, branchId, userId, slug: uniqueSlug };
  }

  async assignTenantPlan(tenantId, planCode) {
    const plans = await this.listPlans();
    if (!plans.find((p) => p.code === planCode)) throw new Error('Plan not found');

    const endsAt = new Date();
    endsAt.setMonth(endsAt.getMonth() + 1);
    const now = new Date().toISOString();

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: tenantPk(tenantId),
          SK: SUBSCRIPTION_SK,
          entityType: 'SUBSCRIPTION',
          tenant_id: tenantId,
          plan_code: planCode,
          status: 'active',
          started_at: now,
          ends_at: endsAt.toISOString(),
          updatedAt: now,
        },
      })
    );
    return this.getTenant(tenantId);
  }

  async updateTenantStatus(tenantId, status) {
    const tenant = await this.getTenant(tenantId);
    if (!tenant) throw new Error('Tenant not found');
    const now = new Date().toISOString();

    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: tenantPk(tenantId), SK: META_SK },
        UpdateExpression: 'SET #status = :status, updatedAt = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': status, ':now': now },
      })
    );
    await this._tenantRefPut(tenantId, tenant.name, tenant.slug, status);
    return this.getTenant(tenantId);
  }

  async listPlans() {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': PLATFORM_PK, ':sk': 'SAAS_PLAN#' },
      })
    );
    return (result.Items || [])
      .map((i) => ({
        code: i.code,
        name: i.name,
        description: i.description,
        price_monthly: i.price_monthly,
        max_users: i.max_users,
      }))
      .sort((a, b) => (a.price_monthly || 0) - (b.price_monthly || 0));
  }

  async createPlan({ code, name, description, priceMonthly, maxUsers }) {
    const plan = {
      code,
      name,
      description: description || null,
      price_monthly: priceMonthly ?? 0,
      max_users: maxUsers ?? null,
      is_active: 1,
    };
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: PLATFORM_PK,
          SK: `SAAS_PLAN#${code}`,
          entityType: 'SAAS_PLAN',
          ...plan,
          createdAt: new Date().toISOString(),
        },
      })
    );
    return plan;
  }

  async updatePlan(code, data) {
    const existing = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: PLATFORM_PK, SK: `SAAS_PLAN#${code}` },
      })
    );
    if (!existing.Item) throw new Error('Plan not found');
    const plan = {
      ...existing.Item,
      name: data.name ?? existing.Item.name,
      description: data.description ?? existing.Item.description,
      price_monthly: data.priceMonthly ?? data.price_monthly ?? existing.Item.price_monthly,
      max_users: data.maxUsers ?? data.max_users ?? existing.Item.max_users,
      updatedAt: new Date().toISOString(),
    };
    await this.client.send(
      new PutCommand({ TableName: this.tableName, Item: plan })
    );
    return {
      code: plan.code,
      name: plan.name,
      description: plan.description,
      price_monthly: plan.price_monthly,
      max_users: plan.max_users,
    };
  }

  async listPlatformUsers() {
    const refs = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': PLATFORM_PK, ':sk': 'TENANT_REF#' },
      })
    );
    const tenantIds = (refs.Items || []).map((r) => r.tenantId);
    tenantIds.push(String(0));

    const allUsers = [];
    for (const tenantId of tenantIds) {
      const users = await authDynamo.users.queryByTenant(tenantId, {
        filter: (u) => !u.deleted_at,
      });
      const tenant = tenantId === '0' ? null : await this.getTenant(tenantId);
      users.forEach((u) => {
        const n = authDynamo._normalizeUser(u);
        allUsers.push({
          id: n.id,
          tenant_id: n.tenant_id,
          username: n.username,
          email: n.email,
          full_name: n.full_name,
          role: n.role,
          is_active: n.is_active,
          tenant_name: tenant?.name || 'Platform',
        });
      });
    }
    return allUsers.sort((a, b) =>
      String(a.tenant_name).localeCompare(String(b.tenant_name)) ||
      String(a.username).localeCompare(String(b.username))
    );
  }

  async createPlatformUser({ tenantId, username, email, password, role, fullName, branchId }) {
    const normalized = normalizeRole(role);
    if (normalized === ROLES.SUPER_ADMIN && tenantId) {
      throw new Error('Super admin cannot belong to a tenant');
    }
    const existing = await authDynamo.findUserByUsernameOrEmail(username, tenantId || null);
    if (existing) throw new Error('Username already exists');

    const hash = await bcrypt.hash(password, authConfig.bcryptRounds);
    const tid = tenantId || 0;
    let resolvedBranch = branchId;
    if (tenantId && !resolvedBranch) {
      const branches = await authDynamo.listBranchesForTenant(tenantId);
      resolvedBranch = branches.find((b) => b.is_default)?.id || branches[0]?.id;
    }

    return authDynamo.createStaffUser({
      tenantId: tid,
      branchId: resolvedBranch,
      username,
      email,
      hashedPassword: hash,
      role: normalized,
      fullName: fullName || username,
      isActive: true,
    });
  }

  async updatePlatformUser(id, { role, fullName, isActive, tenantId }) {
    const user = await authDynamo.findUserWithPassword(id);
    if (!user) throw new Error('User not found');
    if (user.role === ROLES.SUPER_ADMIN && role && normalizeRole(role) !== ROLES.SUPER_ADMIN) {
      throw new Error('Cannot change super admin role');
    }
    await authDynamo.updateStaffUser(id, {
      role: role ? normalizeRole(role) : undefined,
      fullName,
      branchId: user.branch_id,
    });
    if (isActive !== undefined) {
      const tid = user.tenant_id ?? 0;
      await authDynamo.users.update(tid, id, { is_active: isActive ? 1 : 0 });
    }
    const updated = await authDynamo.findUserById(id);
    const tenant = updated.tenant_id ? await this.getTenant(updated.tenant_id) : null;
    return {
      ...updated,
      tenant_name: tenant?.name || 'Platform',
    };
  }

  async getReports() {
    const tenants = await this.listTenants();
    const users = await this.listPlatformUsers();
    const byPlan = {};
    tenants.forEach((t) => {
      const code = t.plan_code || 'unknown';
      byPlan[code] = (byPlan[code] || 0) + 1;
    });
    const byRole = {};
    users.forEach((u) => {
      byRole[u.role] = (byRole[u.role] || 0) + 1;
    });
    return {
      tenants: tenants.length,
      activeTenants: tenants.filter((t) => t.status === 'active').length,
      trialing: tenants.filter((t) => t.subscription_status === 'trialing').length,
      users: users.length,
      byPlan: Object.entries(byPlan).map(([plan_code, count]) => ({ plan_code, count })),
      byRole: Object.entries(byRole).map(([role, count]) => ({ role, count })),
      recentTenants: tenants.slice(0, 5).map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        status: t.status,
        created_at: t.created_at,
      })),
    };
  }

  async seedSaasPlans() {
    const existing = await this.listPlans();
    if (existing.length > 0) return false;
    const now = new Date().toISOString();
    for (const plan of DEFAULT_PLANS) {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: PLATFORM_PK,
            SK: `SAAS_PLAN#${plan.code}`,
            entityType: 'SAAS_PLAN',
            ...plan,
            is_active: 1,
            createdAt: now,
          },
        })
      );
    }
    return true;
  }
}

module.exports = new PlatformDynamoRepository();
