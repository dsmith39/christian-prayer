# ADR-0010: Docker + AWS ECS Fargate for Backend Deployment

**Date:** 2024  
**Status:** Accepted

## Context

The Express.js backend must be deployed to a publicly accessible HTTPS endpoint (`https://api.faithrequest.com`). It needs to be:
- Reproducible (same environment in dev and production)
- Scalable (can add capacity without infrastructure changes)
- Low maintenance (no EC2 instances to patch)

Infrastructure options considered:
- AWS EC2 (manual instance management)
- AWS Elastic Beanstalk
- AWS ECS Fargate (serverless containers)
- AWS Lambda (serverless functions)
- Heroku / Railway / Render (PaaS)

## Decision

Containerise the backend with Docker and deploy it to AWS ECS Fargate behind an Application Load Balancer (ALB). The container image is stored in ECR (Elastic Container Registry).

## Rationale

- **Reproducible builds.** Docker guarantees the same Node.js version, OS libraries, and `node_modules` in every environment. No "works on my machine" issues.
- **Fargate removes server management.** AWS manages the underlying EC2 instances. The operator only needs to define CPU/memory and the container image.
- **ALB handles TLS termination.** The ALB presents the ACM certificate for `api.faithrequest.com`. The Express app itself speaks plain HTTP inside the VPC, simplifying the server code.
- **Scales horizontally.** Increasing the ECS desired task count is a one-line change. Multiple tasks behind the ALB provide high availability with no code changes.
- **ECR is tightly integrated.** Pushing to ECR and triggering a new ECS deployment is the entire CD pipeline — no separate container registry to manage.

## Trade-offs

- **Cold start latency.** If all Fargate tasks are stopped (e.g., zero-scale), the first request after scale-out waits for a container to start (~30s). Maintaining at least one running task avoids this.
- **Minimum cost.** Fargate has a per-vCPU/per-GB-memory cost even at low traffic. For a personal app, this is ~$10–30/month depending on task size. A Lambda function-per-endpoint would be cheaper at very low traffic.
- **Deploy complexity.** Deploying requires: building a Docker image, pushing to ECR, updating the ECS task definition, and triggering a new deployment. The `deploy.ps1` script automates this.
- **No Lambda cold-start advantage.** Lambda auto-scales to zero and costs nothing at zero traffic, but adapting Express to Lambda (via `@vendia/serverless-express`) adds a dependency and latency.

## Consequences

- `backend/Dockerfile` defines the production container.
- The ECS task definition is in `deploy/aws/ecs-task-definition.json`.
- Secrets (`JWT_SECRET`, `MONGODB_URI`) are injected as environment variables from AWS Secrets Manager at task launch.
- The ALB health check hits `GET /api/health` on the container. This endpoint must remain fast and stateless.
- `deploy/aws/deploy.ps1` is the deployment script for Windows developers.
