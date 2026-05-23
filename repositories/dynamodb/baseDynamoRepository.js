const {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');
const { getDynamoClient } = require('../../config/dynamodb');
const databaseConfig = require('../../config/dataStore');
const { tenantPk, entitySk } = require('../../utils/tenant');

class BaseDynamoRepository {
  constructor(entityType) {
    this.entityType = entityType;
    this.tableName = databaseConfig.dynamodb.tableName;
    this.client = getDynamoClient();
  }

  pk(tenantId) {
    return tenantPk(tenantId);
  }

  sk(entityId) {
    return entitySk(this.entityType, entityId);
  }

  toRecord(tenantId, entityId, data) {
    const now = new Date().toISOString();
    return {
      PK: this.pk(tenantId),
      SK: this.sk(entityId),
      entityType: this.entityType,
      tenantId,
      entityId: String(entityId),
      ...data,
      createdAt: data.createdAt || data.created_at || now,
      updatedAt: now,
    };
  }

  fromRecord(item) {
    if (!item) return null;
    const { PK, SK, entityType, tenantId, entityId, createdAt, updatedAt, ...rest } = item;
    return {
      id: entityId ?? rest.id,
      tenant_id: tenantId ?? rest.tenant_id,
      created_at: createdAt ?? rest.created_at,
      updated_at: updatedAt ?? rest.updated_at,
      ...rest,
    };
  }

  async create(tenantId, entityId, data) {
    const item = this.toRecord(tenantId, entityId, { ...data, id: String(entityId) });
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      })
    );
    return this.fromRecord(item);
  }

  async getById(tenantId, entityId) {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: this.pk(tenantId), SK: this.sk(entityId) },
      })
    );
    return this.fromRecord(result.Item);
  }

  async queryByTenant(tenantId, options = {}) {
    const prefix = options.skPrefix || `${this.entityType}#`;
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': this.pk(tenantId),
          ':sk': prefix,
        },
      })
    );
    let items = (result.Items || []).map((i) => this.fromRecord(i));
    if (options.filter) items = items.filter(options.filter);
    if (options.sort) items.sort(options.sort);
    return items;
  }

  async update(tenantId, entityId, data) {
    const names = {};
    const values = { ':updatedAt': new Date().toISOString() };
    const sets = ['updatedAt = :updatedAt'];

    Object.entries(data).forEach(([key, value], idx) => {
      if (['PK', 'SK', 'entityType', 'tenantId', 'entityId', 'id'].includes(key)) return;
      const nk = `#k${idx}`;
      const vk = `:v${idx}`;
      names[nk] = key;
      values[vk] = value;
      sets.push(`${nk} = ${vk}`);
    });

    const result = await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: this.pk(tenantId), SK: this.sk(entityId) },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      })
    );
    return this.fromRecord(result.Attributes);
  }

  async delete(tenantId, entityId) {
    await this.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: this.pk(tenantId), SK: this.sk(entityId) },
      })
    );
    return true;
  }

  async put(tenantId, entityId, data) {
    const item = this.toRecord(tenantId, entityId, { ...data, id: String(entityId) });
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      })
    );
    return this.fromRecord(item);
  }
}

module.exports = BaseDynamoRepository;
