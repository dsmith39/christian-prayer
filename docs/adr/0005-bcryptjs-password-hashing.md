# ADR-0005: bcryptjs for Password Hashing

**Date:** 2024  
**Status:** Accepted

## Context

User passwords must be stored in a way that they cannot be recovered even if the database is compromised.

Password hashing options considered:
- bcryptjs (pure JS)
- bcrypt (native C++ binding)
- argon2
- scrypt (Node.js built-in)
- SHA-256/MD5 (not suitable — fast and unsalted)

## Decision

Use `bcryptjs` with a cost factor of 12.

## Rationale

- **Industry standard for Node.js.** bcrypt is well understood, widely audited, and recommended by OWASP for password storage.
- **bcryptjs over native bcrypt.** `bcryptjs` is a pure-JavaScript implementation with no native build dependencies. This simplifies the Docker image (no need for `node-gyp`, Python, or build tools in the container). The performance trade-off is acceptable — password hashing is not on the hot path.
- **Cost factor 12.** OWASP recommends a cost factor high enough that one hash takes ~100–300 ms on the target hardware. Cost 12 is in this range on modern hardware and is a reasonable default that balances security and response time. If the deployment hardware changes significantly, the cost factor should be re-evaluated.
- **Built-in salting.** bcrypt generates a unique salt per hash, so identical passwords produce different hashes.

## Trade-offs

- **bcryptjs is ~3x slower than native bcrypt.** Not a concern at current request rates. If the app grows to high-volume registration flows, native `bcrypt` should be reconsidered.
- **bcrypt has a 72-byte input limit.** Passwords longer than 72 bytes are silently truncated. This is a known bcrypt limitation. Users are unlikely to hit this in practice.
- **No pepper.** A server-side secret (pepper) is not applied before hashing. Adding a pepper would require re-hashing all passwords on any deployment or key rotation event — complexity not warranted at this scale.

## Consequences

- Password hashing occurs in `backend/routes/authRoutes.js` at registration.
- Password comparison occurs at login using `bcryptjs.compare()`.
- Plaintext passwords are never stored in the database or logged.
