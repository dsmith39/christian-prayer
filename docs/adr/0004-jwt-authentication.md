# ADR-0004: JWT for Stateless Authentication

**Date:** 2024  
**Status:** Accepted

## Context

FaithRequest must authenticate every API call to ensure users can only access their own data. The backend runs on ECS Fargate, which can scale to multiple containers, so session state cannot be stored in memory on a single process.

Authentication options considered:
- JWT (JSON Web Tokens) — stateless
- Session cookies + server-side session store (Redis / DB)
- HTTP Basic Auth
- OAuth2 / third-party identity (Google, Auth0)

## Decision

Use JWT issued by the backend at login/register, stored in the browser's localStorage, and sent as a `Bearer` token in the `Authorization` header on every request.

## Rationale

- **Stateless — works with horizontal scaling.** Any ECS container can validate a JWT without talking to a shared session store. Adding more containers requires no infrastructure changes.
- **Simple implementation.** The `jsonwebtoken` library (`jwt.sign` / `jwt.verify`) handles all cryptographic operations with the `JWT_SECRET` environment variable.
- **No session database.** Eliminates the need to run and manage a Redis cluster or session table in MongoDB.
- **7-day expiry.** Long enough that users are not frequently logged out; short enough to limit the impact of a stolen token.

## Trade-offs

- **Token cannot be invalidated early.** Once issued, a JWT remains valid until expiry. If a user wants to log out of all devices or if a token is compromised, there is no built-in revocation mechanism. Mitigated by the 7-day window — a compromised token has limited lifetime.
- **localStorage is accessible to JavaScript.** Storing tokens in localStorage means any XSS vulnerability could steal the token. The current app uses `escapeHtml()` on all user content to prevent XSS, but this requires ongoing discipline.
- **No refresh token.** After 7 days the user must log in again. A refresh-token flow would allow silent renewal but adds implementation complexity.

## Consequences

- The `JWT_SECRET` environment variable must be set in production (AWS Secrets Manager). The backend will throw on startup if it is missing.
- The `authMiddleware` in `backend/middleware/auth.js` is applied to all `/api/users` routes.
- `401` responses from the API cause `app.js` to clear localStorage and redirect to `login.html`.
- The `STORAGE_KEY` constant (`faithrequest-auth-v1`) namespaces the token in localStorage to avoid collisions with other apps on the same origin during development.
