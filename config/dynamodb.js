const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const databaseConfig = require('./dataStore');

let docClient = null;

function getDynamoClient() {
  if (docClient) return docClient;

  const { region, endpoint, accessKeyId, secretAccessKey } = databaseConfig.dynamodb;
  const clientConfig = { region };

  if (endpoint) {
    clientConfig.endpoint = endpoint;
    clientConfig.credentials = { accessKeyId, secretAccessKey };
  }

  const client = new DynamoDBClient(clientConfig);
  docClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });

  return docClient;
}

module.exports = { getDynamoClient };
