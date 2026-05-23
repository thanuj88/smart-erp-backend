const { PutCommand, GetCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { getDynamoClient } = require('../../config/dynamodb');
const databaseConfig = require('../../config/dataStore');
const {
  PERMISSION_CATALOG,
  DEFAULT_ROLE_PERMISSIONS,
  ROLE_CATALOG,
} = require('../../config/permissionCatalog');

const PLATFORM_PK = 'PLATFORM#0';

function permissionSk(code) {
  return `PERMISSION#${code}`;
}

function roleSk(code) {
  return `ROLE#${code}`;
}

class RbacDynamoRepository {
  constructor() {
    this.client = getDynamoClient();
    this.tableName = databaseConfig.dynamodb.tableName;
  }

  async listPermissions() {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': PLATFORM_PK, ':sk': 'PERMISSION#' },
      })
    );
    return (result.Items || [])
      .map((i) => ({ code: i.code, name: i.name, category: i.category }))
      .sort((a, b) => `${a.category}${a.code}`.localeCompare(`${b.category}${b.code}`));
  }

  async listRoles() {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': PLATFORM_PK, ':sk': 'ROLE#' },
      })
    );
    return (result.Items || [])
      .map((i) => ({
        code: i.code,
        name: i.name,
        description: i.description,
        system: !!i.system,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  async getPermissionCodesForRole(roleCode) {
    const res = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: PLATFORM_PK, SK: roleSk(roleCode) },
      })
    );
    return res.Item?.permissions || [];
  }

  async setRolePermissions(roleCode, permissionCodes) {
    if (roleCode === 'SUPER_ADMIN') {
      throw new Error('SUPER_ADMIN permissions cannot be modified');
    }
    const roleRes = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: PLATFORM_PK, SK: roleSk(roleCode) },
      })
    );
    if (!roleRes.Item) {
      throw new Error(`Role not found: ${roleCode}`);
    }

    const version = (roleRes.Item.version || 0) + 1;
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...roleRes.Item,
          permissions: permissionCodes,
          version,
          updatedAt: new Date().toISOString(),
        },
      })
    );
    return permissionCodes;
  }

  async createPermission({ code, name, category }) {
    const now = new Date().toISOString();
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: PLATFORM_PK,
          SK: permissionSk(code),
          entityType: 'PERMISSION',
          code,
          name,
          category: category || 'custom',
          createdAt: now,
        },
      })
    );
    return { code, name, category: category || 'custom' };
  }

  async createRole({ code, name, description }) {
    if (code === 'SUPER_ADMIN') throw new Error('Cannot create SUPER_ADMIN role');
    const now = new Date().toISOString();
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: PLATFORM_PK,
          SK: roleSk(code),
          entityType: 'ROLE',
          code,
          name,
          description,
          system: false,
          permissions: [],
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
      })
    );
    return { code, name, description, system: false };
  }

  async seedFromCatalog() {
    const existing = await this.listPermissions();
    if (existing.length > 0) return false;

    const now = new Date().toISOString();
    for (const perm of PERMISSION_CATALOG) {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: PLATFORM_PK,
            SK: permissionSk(perm.code),
            entityType: 'PERMISSION',
            code: perm.code,
            name: perm.name,
            category: perm.category,
            createdAt: now,
          },
        })
      );
    }

    for (const role of ROLE_CATALOG) {
      const permissions = DEFAULT_ROLE_PERMISSIONS[role.code] || [];
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: PLATFORM_PK,
            SK: roleSk(role.code),
            entityType: 'ROLE',
            code: role.code,
            name: role.name,
            description: role.description,
            system: role.system,
            permissions,
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
        })
      );
    }

    return true;
  }
}

module.exports = new RbacDynamoRepository();
