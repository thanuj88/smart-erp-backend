const databaseConfig = require('../config/dataStore');

function resolveTenantId(reqOrValue) {
  if (reqOrValue == null) return databaseConfig.defaultTenantId;
  if (typeof reqOrValue === 'number') return reqOrValue;
  if (typeof reqOrValue === 'string' && /^\d+$/.test(reqOrValue)) {
    return parseInt(reqOrValue, 10);
  }
  if (reqOrValue.user) {
    return reqOrValue.user.tenantId ?? reqOrValue.user.tenant_id ?? databaseConfig.defaultTenantId;
  }
  return databaseConfig.defaultTenantId;
}

function tenantPk(tenantId) {
  return `TENANT#${tenantId}`;
}

function entitySk(entityType, entityId) {
  return `${entityType}#${entityId}`;
}

module.exports = { resolveTenantId, tenantPk, entitySk };
