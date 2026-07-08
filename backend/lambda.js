/**
 * lambda.js
 * ----------
 * AWS Lambda entry point. Wraps the shared Express app (app.js) with
 * serverless-http so API Gateway HTTP API events are translated to/from
 * standard Express req/res.
 *
 * JWT_SECRET is not set directly in the Lambda environment — only
 * JWT_SECRET_ARN is. loadSecrets() resolves it from Secrets Manager once per
 * cold start and caches it in process.env for the lifetime of the execution
 * environment (see config/secrets.js), so warm invocations skip the fetch.
 */
const serverlessHttp = require("serverless-http");
const { loadSecrets } = require("./config/secrets");

let handlerPromise;

async function buildHandler() {
  await loadSecrets();
  const app = require("./app");
  return serverlessHttp(app);
}

module.exports.handler = async (event, context) => {
  if (!handlerPromise) {
    handlerPromise = buildHandler();
  }

  const serverlessHandler = await handlerPromise;
  return serverlessHandler(event, context);
};
