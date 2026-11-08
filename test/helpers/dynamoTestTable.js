/**
 * Integration tests run against DynamoDB Local on a throwaway table, never the dev table.
 * Require this BEFORE any repository so the config picks up the test table name.
 */
const net = require('net');

const endpoint = process.env.TEST_DYNAMODB_ENDPOINT || 'http://localhost:8000';
const tableName = `PosBrightTest_${process.pid}_${Date.now()}`;

process.env.DYNAMODB_ENDPOINT = endpoint;
process.env.DYNAMODB_TABLE = tableName;
process.env.AWS_ACCESS_KEY_ID = 'local';
process.env.AWS_SECRET_ACCESS_KEY = 'local';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';

function isReachable() {
  const { hostname, port } = new URL(endpoint);
  return new Promise((resolve) => {
    const socket = net.connect({ host: hostname, port: Number(port) || 8000, timeout: 1000 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function createTable() {
  const { DynamoDBClient, CreateTableCommand } = require('@aws-sdk/client-dynamodb');
  const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    endpoint,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
    })
  );
  return client;
}

async function dropTable(client) {
  const { DeleteTableCommand } = require('@aws-sdk/client-dynamodb');
  await client.send(new DeleteTableCommand({ TableName: tableName })).catch(() => {});
  client.destroy();
}

module.exports = { endpoint, tableName, isReachable, createTable, dropTable };
