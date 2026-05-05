# ADR-0012: MongoDB Atlas as Managed Database Service

**Date:** 2024  
**Status:** Accepted

## Context

FaithRequest needs a MongoDB database that is:
- Accessible from ECS Fargate containers in a VPC
- Backed up automatically
- Operable without managing an EC2 instance

MongoDB hosting options considered:
- MongoDB Atlas (DBaaS)
- Self-hosted MongoDB on EC2
- AWS DocumentDB (MongoDB-compatible)
- Self-hosted MongoDB in a Docker container on ECS

## Decision

Use MongoDB Atlas as the managed database service.

## Rationale

- **Fully managed.** Atlas handles provisioning, patching, backups, and monitoring. There are no MongoDB server processes to operate.
- **Free tier available.** Atlas M0 (512 MB, shared cluster) is free and sufficient for development and early-stage production. The app can be migrated to a paid tier when traffic or storage demands it.
- **Automated backups.** Atlas provides point-in-time recovery on paid tiers and daily snapshots even on the free tier.
- **Connection string simplicity.** The `MONGODB_URI` environment variable is a single `mongodb+srv://` connection string. The app connects with `mongoose.connect(uri)` — no complex VPC peering or IAM roles required.
- **Built-in monitoring and alerts.** Atlas provides query profiling, index suggestions, and email/Slack alerts for high CPU or connection counts.
- **Geographic proximity.** Atlas clusters can be created in `us-east-1` to be close to the ECS Fargate tasks and minimise latency.

## Trade-offs

- **Vendor lock-in.** Data lives on Atlas infrastructure. Migrating to DocumentDB or self-hosted MongoDB requires a `mongodump` / `mongorestore`.
- **Atlas free tier limitations.** The M0 free tier has a 512 MB storage cap and no dedicated RAM. Under sustained load it may exhibit higher latency than a paid cluster.
- **IP allowlisting required.** By default, Atlas requires allowlisting the source IP or CIDR. In ECS Fargate, tasks do not have a fixed IP. The Atlas Network Access must allow the ECS task's NAT Gateway IP or use Atlas VPC peering.
- **Cost at scale.** A dedicated M10 cluster starts at ~$57/month. For a personal app at low traffic, staying on M0 with a backup strategy (Atlas free-tier snapshots) is appropriate.

## Consequences

- The `MONGODB_URI` value is stored in AWS Secrets Manager as `faithrequest/mongodb-uri` and injected into the ECS task as an environment variable.
- `backend/config/db.js` calls `mongoose.connect(process.env.MONGODB_URI)` with the standard Mongoose connection event handlers.
- The Atlas cluster should be in the same AWS region (`us-east-1`) as the ECS cluster to minimise round-trip latency.
- The Atlas Network Access must include the NAT Gateway Elastic IP assigned to the ECS VPC, or VPC peering should be configured for production use.
