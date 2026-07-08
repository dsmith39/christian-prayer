# ADR-0014: AWS Lambda + API Gateway Replaces ECS Fargate + ALB

**Date:** 2026-07-07
**Status:** Accepted
**Supersedes:** [ADR-0010](0010-docker-ecs-fargate.md)

## Context

ADR-0010 planned ECS Fargate behind an ALB for the backend, and even flagged at the time that "a Lambda function-per-endpoint would be cheaper at very low traffic" and that Fargate "has a per-vCPU/per-GB-memory cost even at low traffic... ~$10-30/month." At actual first deployment, with the database move to DynamoDB (ADR-0013) removing the NAT Gateway requirement, nothing was left tying the backend to a VPC — the case for Fargate's always-on containers weakened further.

## Decision

Run the existing Express app in AWS Lambda (Node.js 20.x), fronted by an API Gateway HTTP API with Lambda proxy integration and a custom domain, `api.faithrequest.com`.

## Rationale

- **Scales to ~$0 at idle.** A personal, low-traffic app pays per invocation instead of a fixed ~$10-30/month for an always-running Fargate task plus ~$16-20/month for the ALB.
- **No container pipeline.** No Dockerfile, no ECR push, no task definition to register — `zip` the `backend/` directory and `aws lambda update-function-code`.
- **Minimal code change.** `serverless-http` wraps the existing Express `app` (`backend/app.js`) unchanged; routes, middleware, and validation logic are untouched. Only the entry point differs: `backend/server.js` (local, `app.listen`) vs. `backend/lambda.js` (`serverlessHttp(app)`).
- **No NAT Gateway.** Combined with ADR-0013's move off MongoDB Atlas, the backend has no outbound-internet dependency at all, so it doesn't need a VPC, subnets, or a NAT Gateway.

## Trade-offs

- **Cold starts.** A cold Lambda invocation pays Node.js init + module load (~200-400ms observed for this app). Acceptable for a personal app; would need provisioned concurrency if traffic grew and this became noticeable.
- **15-minute hard execution limit** (configured here at 15s timeout, well under it) — irrelevant for a request/response CRUD API.
- **Secrets Manager fetch pattern differs from ECS.** ECS could inject a secret directly as a container environment variable via `secrets:` in the task definition. Lambda has no equivalent, so `backend/config/secrets.js` fetches `JWT_SECRET` from Secrets Manager explicitly on cold start and caches it in `process.env` for the lifetime of the execution environment (see `lambda.js`).
- **No load-balancer-level health check.** API Gateway doesn't health-check the Lambda the way an ALB target group did; Lambda's own error handling and CloudWatch alarms are the substitute if monitoring is added later.

## Consequences

- `backend/lambda.js` is the deployed entry point (`handler`); `backend/server.js` remains for local dev only.
- `backend/Dockerfile`, `backend/.dockerignore`, and `deploy/aws/ecs-task-definition.json` are removed.
- `JWT_SECRET_ARN` (not `JWT_SECRET`) is set on the Lambda function's environment in production; `JWT_SECRET` is set directly only for local dev via `.env`.
- The Lambda execution role (`faithrequest-lambda-execution-role`) is scoped to: CloudWatch Logs (basic execution), `dynamodb:*Item`/`TransactWriteItems`/`Query` on the `faithrequest-users` table, and `secretsmanager:GetSecretValue` on the JWT secret ARN only.
- Deploying a new backend version is: `npm ci --omit=dev`, zip `backend/`, `aws lambda update-function-code --function-name faithrequest-api --zip-file fileb://...`.
