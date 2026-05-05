# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for FaithRequest.

An ADR documents a significant architectural or technology choice made in the project — what was decided, why it was chosen over alternatives, and what the trade-offs are.

## Index

| # | Title | Status |
|---|---|---|
| [0001](0001-vanilla-js-no-framework.md) | Vanilla JavaScript Frontend (No Framework) | Accepted |
| [0002](0002-express-backend.md) | Express.js for the Backend API | Accepted |
| [0003](0003-mongodb-mongoose.md) | MongoDB with Mongoose for Data Persistence | Accepted |
| [0004](0004-jwt-authentication.md) | JWT for Stateless Authentication | Accepted |
| [0005](0005-bcryptjs-password-hashing.md) | bcryptjs for Password Hashing | Accepted |
| [0006](0006-express-rate-limit.md) | Rate Limiting on Auth and Mutation Endpoints | Accepted |
| [0007](0007-localstorage-session.md) | localStorage for Frontend Session Persistence | Accepted |
| [0008](0008-web-notifications-api.md) | Web Notifications API for Prayer Reminders | Accepted |
| [0009](0009-embedded-document-model.md) | Embedded Document Model (Single User Document) | Accepted |
| [0010](0010-docker-ecs-fargate.md) | Docker + AWS ECS Fargate for Backend Deployment | Accepted |
| [0011](0011-s3-cloudfront-frontend.md) | S3 + CloudFront for Frontend Deployment | Accepted |
| [0012](0012-mongodb-atlas.md) | MongoDB Atlas as Managed Database Service | Accepted |

## ADR Format

Each ADR follows this structure:

- **Context** — Why is this decision needed? What problem does it solve?
- **Decision** — What was chosen?
- **Rationale** — Why was this chosen over alternatives?
- **Trade-offs** — What does this choice give up?
- **Consequences** — How does this affect the codebase going forward?
