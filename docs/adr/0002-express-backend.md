# ADR-0002: Express.js for the Backend API

**Date:** 2024  
**Status:** Accepted

## Context

FaithRequest needs a backend API to store user accounts and prayer data in MongoDB, issue JWTs, and enforce authentication. The backend is deployed as a container on AWS ECS Fargate.

API framework options considered:
- Express.js
- Fastify
- Hono
- NestJS
- No backend (frontend-only with direct DB SDK)

## Decision

Use Express.js 4.x as the API framework.

## Rationale

- **Ecosystem maturity.** Express has the largest middleware ecosystem in Node.js. express-rate-limit, cors, and dotenv all integrate with zero configuration.
- **Simplicity.** The API has ~10 routes. Express's minimal surface area is appropriate — no need for the abstractions NestJS provides.
- **Team familiarity.** Express is the most widely understood Node.js framework, making it easy to return to after time away.
- **Flexible middleware.** Rate limiting, CORS, JSON body parsing, and auth middleware chain naturally as Express middleware, which makes the security posture easy to read in `server.js`.
- **Containerisation.** An Express app containerises trivially — it's a single `node server.js` process.

## Trade-offs

- **No built-in structure.** Express imposes no convention on project layout. This ADR documents the chosen structure (routes/, middleware/, models/, utils/).
- **Slower than Fastify.** Fastify benchmarks ~2x faster than Express, but this is irrelevant at FaithRequest's traffic levels.
- **Error handling is manual.** Global error handling requires an explicit four-argument middleware. NestJS handles this with decorators.

## Consequences

- Routes are split into `authRoutes.js` and `userRoutes.js`, mounted at `/api/auth` and `/api/users` respectively.
- The `authMiddleware` is applied at the router level in `server.js`, so individual route handlers do not need to check auth.
- Validation is done manually in each route handler using input trimming and length checks. If the API grows, consider a validation library (zod, joi).
