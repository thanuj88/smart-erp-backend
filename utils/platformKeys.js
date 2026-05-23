const { tenantPk } = require('./tenant');

/** Platform-wide index partition (RBAC, SaaS plans, tenant registry). */
const PLATFORM_INDEX_PK = 'PLATFORM#0';

/** Legacy partition used before platform index was unified. */
const LEGACY_PLATFORM_INDEX_PK = tenantPk(0);

const PLATFORM_INDEX_PKS = [PLATFORM_INDEX_PK, LEGACY_PLATFORM_INDEX_PK];

module.exports = {
  PLATFORM_INDEX_PK,
  LEGACY_PLATFORM_INDEX_PK,
  PLATFORM_INDEX_PKS,
};
