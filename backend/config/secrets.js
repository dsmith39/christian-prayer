/**
 * config/secrets.js
 * -------------------
 * Resolves JWT_SECRET from Secrets Manager for the Lambda deployment.
 *
 * Local dev sets JWT_SECRET directly in .env, so loadSecrets() is a no-op
 * there. In Lambda, only JWT_SECRET_ARN is set; the secret value is fetched
 * once per cold start (see lambda.js) and cached in process.env for the
 * lifetime of the execution environment.
 */
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

async function loadSecrets() {
  if (process.env.JWT_SECRET) {
    return;
  }

  const secretArn = process.env.JWT_SECRET_ARN;
  if (!secretArn) {
    return;
  }

  const client = new SecretsManagerClient({});
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  process.env.JWT_SECRET = result.SecretString;
}

module.exports = { loadSecrets };
