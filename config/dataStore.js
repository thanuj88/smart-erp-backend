require('dotenv').config();

module.exports = {
  dbType: 'dynamodb',
  readSource: 'dynamodb',
  dynamodb: {
    tableName: process.env.DYNAMODB_TABLE || 'PosBright',
    region: process.env.AWS_REGION || 'us-east-1',
    endpoint: process.env.DYNAMODB_ENDPOINT || undefined,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'local',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'local',
  },
  defaultTenantId: parseInt(process.env.DEFAULT_TENANT_ID || '1', 10),
};
