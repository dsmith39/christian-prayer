# ADR-0006: Rate Limiting on Auth and Mutation Endpoints

**Date:** 2024  
**Status:** Accepted

## Context

Public API endpoints can be brute-forced or abused. The auth endpoints (`/api/auth/register`, `/api/auth/login`) are especially sensitive because unlimited login attempts could be used to guess passwords. Mutation endpoints could be abused to inflate database costs.

Options considered:
- Application-level rate limiting (`express-rate-limit`)
- AWS WAF rules in front of the ALB
- Nginx rate limiting in a reverse proxy layer
- No rate limiting

## Decision

Use `express-rate-limit` middleware applied at the Express application layer with two rate limit policies:

| Policy | Window | Max requests | Applied to |
|---|---|---|---|
| `authLimiter` | 15 min | 20 | `/api/auth/*` |
| `mutationLimiter` | 15 min | 100 | POST/PATCH/DELETE on `/api/users/*` |

## Rationale

- **Zero infrastructure overhead.** No additional AWS service cost or configuration. The middleware runs inside the existing Express process.
- **Targets the right surfaces.** Auth endpoints (credential attacks) and mutation endpoints (write abuse) are rate-limited; GET requests (reads) are not, since they are already behind auth and do not cause write load.
- **express-rate-limit is purpose-built.** It handles the window, counter, and response formatting. Custom implementation would be error-prone.
- **Good enough at current scale.** For a single ECS task, in-memory rate limiting is accurate and sufficient. If multiple tasks run simultaneously, counters are not shared (see Trade-offs).

## Trade-offs

- **Not shared across ECS tasks.** `express-rate-limit` stores counters in-process memory by default. If ECS scales to multiple containers, each container maintains its own counter, so a single user could make 20 × N requests across N containers. A shared store (Redis) would fix this but adds infrastructure.
- **IP-based limiting only.** The limiter identifies clients by IP address. Clients behind shared NAT (e.g., a school or corporate network) share a limit.
- **Does not replace AWS WAF.** For production at scale, AWS WAF layer rules should be considered in addition to application-level limiting.

## Consequences

- `authLimiter` and `mutationLimiter` are defined and applied in `backend/server.js`.
- Clients that exceed the limit receive `429 Too Many Requests`.
- The `X-RateLimit-*` response headers inform clients of their remaining quota.
