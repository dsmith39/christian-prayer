# CLAUDE.md

Guidance for Claude Code (and future contributors) working in this repo. Keep this file up to date — append to the Changelog whenever infrastructure or major architecture changes, rather than rewriting history.

## What this is

FaithRequest (faithrequest.com) — a prayer-request tracker. Users register, organize prayers into lists, mark them answered, and set daily reminders.

- Frontend: static vanilla HTML/CSS/JS (`index.html`, `login.html`, `register.html`, `dashboard.html`, `app.js`, `auth.js`, `styles.css`, `auth-pages.css`, `config.js`). No build step, no framework (ADR-0001).
- Backend: Express API in `backend/`, JWT auth (ADR-0004) with bcryptjs (ADR-0005), rate-limited (ADR-0006).
- Data: one DynamoDB item per user holds their entire `prayerLists[] → prayers[]` tree (ADR-0009, ADR-0013) — no joins, no cross-user queries.
- Full architectural history is in [docs/adr/](docs/adr/README.md); read the index before assuming a decision is still current.

## Architecture (current, as of 2026-07-07)

```
faithrequest.com, www.faithrequest.com  --(Route 53 alias)-->  CloudFront  --(OAC)-->  S3 (private)
api.faithrequest.com                    --(Route 53 alias)-->  API Gateway (HTTP API) --> Lambda (faithrequest-api) --> DynamoDB (faithrequest-users)
```

- **Frontend hosting:** S3 bucket `faithrequest-web-471112617315` (private, no public access), served through CloudFront distribution `E2X988CMP2JGZB` (`d2xjr73u5s6lg1.cloudfront.net`) via Origin Access Control. Alternate domains: `faithrequest.com`, `www.faithrequest.com`.
- **Backend compute:** Lambda function `faithrequest-api` (Node.js 20.x, `lambda.js` entry point, `serverless-http` wrapping the Express app in `app.js`). Fronted by API Gateway HTTP API `1deeiiw8j0`, custom domain `api.faithrequest.com`.
- **Database:** DynamoDB table `faithrequest-users` (PAY_PER_REQUEST). One profile item per user (`pk=USER#<uuid>`, `sk=PROFILE`) plus one email-lock item per user (`pk=EMAIL#<email>`, `sk=PROFILE`) for atomic unique-email enforcement. See ADR-0013.
- **Secrets:** `JWT_SECRET` lives in Secrets Manager as `faithrequest/prod/jwt-secret`; the Lambda resolves it from `JWT_SECRET_ARN` once per cold start (`backend/config/secrets.js`).
- **IAM:** `faithrequest-lambda-execution-role` — CloudWatch Logs (basic execution) + scoped DynamoDB item/transaction actions on `faithrequest-users` + `secretsmanager:GetSecretValue` on the JWT secret only.
- **TLS:** One ACM certificate (us-east-1) covering `faithrequest.com`, `www.faithrequest.com`, `api.faithrequest.com`, DNS-validated via Route 53.
- **DNS:** Route 53 hosted zone `Z00703002A6CLC85D7MT4` (`faithrequest.com`), AWS account `471112617315`.

Redeploying code (not infrastructure) is scripted in `deploy/aws/` — see `deploy/aws/README.md`. Provisioning the resources above was a one-time manual `aws` CLI setup (recorded in the Changelog below); there is currently no IaC (CloudFormation/CDK/Terraform) for this stack.

## Local Development

1. Backend: `cd backend && npm install`, copy `.env.example` to `.env`, set `DYNAMODB_TABLE_NAME` + `AWS_REGION` to a table you have credentials for (the live `faithrequest-users` table works fine for local testing against real data — be careful not to leave test users in it), then `npm run dev`.
2. Frontend: from the repo root, `npm install` then `npm run dev:frontend`, open `http://localhost:5500/index.html`.
3. Full README is at [README.md](README.md).

## Changelog

### 2026-07-07 — Migrated to DynamoDB + Lambda, deployed to faithrequest.com

This was the project's first live AWS deployment — nothing was previously running for this domain.

**Why:** The original plan (ADR-0010, ADR-0012) was MongoDB Atlas + ECS Fargate/ALB. Before first deploy, both were reconsidered: Atlas is an external SaaS needing a NAT Gateway just for IP allowlisting (~$32/mo for that alone), and ECS Fargate + ALB runs ~$30-45/mo fixed regardless of traffic — expensive for a low-traffic personal app. Both were replaced with fully AWS-native, pay-per-request equivalents before going live.

**What changed:**
- Database: MongoDB Atlas/Mongoose → DynamoDB single-table design. See [ADR-0013](docs/adr/0013-dynamodb-single-table.md). `backend/models/User.js` rewritten as a plain DynamoDB data-access module; `backend/config/db.js` replaced by `backend/config/dynamo.js`.
- Compute: ECS Fargate + ALB → Lambda + API Gateway HTTP API. See [ADR-0014](docs/adr/0014-lambda-api-gateway.md). `backend/app.js` now holds the Express app shared by `server.js` (local) and `lambda.js` (deployed); `backend/Dockerfile` and the ECS task definition were removed.
- `deploy/aws/prepare.js`, `deploy.ps1`, and `aws.env.example` updated for the Lambda/S3 workflow.
- Deployed live: DynamoDB table `faithrequest-users`, Lambda `faithrequest-api`, API Gateway `1deeiiw8j0` with custom domain `api.faithrequest.com`, S3 bucket `faithrequest-web-471112617315`, CloudFront distribution `E2X988CMP2JGZB`, ACM cert (us-east-1) for `faithrequest.com`/`www`/`api`, Route 53 records for all three hostnames.
- Verified end-to-end against the live domain: health check, register, login, create list, add prayer, mark answered, delete account all passed through `https://api.faithrequest.com` and `https://faithrequest.com`.

**How to apply:** Any future infra change to this stack should update this section with what changed and why, plus update the resource names above if they change. If re-provisioning from scratch, the one-time setup order was: ACM cert (DNS-validate via Route 53) → DynamoDB table → Secrets Manager secret → IAM role → Lambda function → API Gateway HTTP API + custom domain + Route 53 record → S3 bucket + CloudFront distribution (OAC + bucket policy) → Route 53 apex/www records → sync frontend → smoke test.
