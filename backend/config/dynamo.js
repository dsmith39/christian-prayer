/**
 * config/dynamo.js
 * ------------------
 * Shared DynamoDB Document Client for the FaithRequest data layer.
 *
 * Unlike Mongoose, the AWS SDK v3 client is stateless and lazy — there is no
 * connect step. The client is created once per process (Lambda cold start or
 * local `node server.js`) and reused for every request.
 *
 * DYNAMODB_TABLE_NAME is required. AWS_REGION is provided automatically by
 * the Lambda runtime; for local development it must be set in .env.
 */
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME;

if (!TABLE_NAME) {
  throw new Error("DYNAMODB_TABLE_NAME is missing. Add it to your .env file.");
}

const client = new DynamoDBClient({});

const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

module.exports = { ddb, TABLE_NAME };
