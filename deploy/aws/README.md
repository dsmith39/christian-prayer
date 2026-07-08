AWS deployment assets for FaithRequest (faithrequest.com).

Stack: S3 + CloudFront (frontend), Lambda + API Gateway HTTP API (backend), DynamoDB (data). See [ADR-0013](../../docs/adr/0013-dynamodb-single-table.md) and [ADR-0014](../../docs/adr/0014-lambda-api-gateway.md).

Files:
- aws.env.example: copy to `aws.env` and fill in your environment-specific values.
- prepare.js: stages the production frontend bundle (with `config.js` pointing at `API_BASE_URL`) and writes the exact deploy commands to `out/next-steps.txt`.
- deploy.ps1: one-command Windows PowerShell deploy script — installs prod backend deps, zips `backend/`, updates the Lambda function code, syncs the frontend to S3, and invalidates CloudFront.
- out/: generated directory (staged frontend files + next-steps.txt).

How to use:
1. Copy `aws.env.example` to `aws.env`.
2. Fill in AWS account/region, the Lambda function name, DynamoDB table name, JWT secret ARN, S3 bucket, and CloudFront distribution ID for your environment.
3. Run `npm run aws:deploy` from the project root (or `npm run aws:deploy:dry-run` to print every command without changing AWS resources).
4. `powershell -ExecutionPolicy Bypass -File ./deploy/aws/deploy.ps1 -SkipFrontend` deploys only the backend; `-SkipBackend` deploys only the frontend.

One-time infrastructure setup (DynamoDB table, IAM role, Secrets Manager secret, Lambda function, API Gateway custom domain, S3 bucket + CloudFront distribution, Route 53 records) is not scripted here — it's a one-time `aws` CLI setup documented in the root [CLAUDE.md](../../CLAUDE.md) changelog. This generator only handles repeatable code/asset deploys against infrastructure that already exists.
