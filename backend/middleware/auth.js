/**
 * middleware/auth.js
 * -------------------
 * Express middleware that enforces JWT authentication on protected routes.
 *
 * Expects the client to send a Bearer token in the Authorization header:
 *   Authorization: Bearer <jwt>
 *
 * On success, attaches `req.auth = { userId, email }` for downstream handlers.
 * On failure, responds with 401 so the client knows to log in again.
 *
 * JWT_SECRET is loaded from the environment — never hard-coded.
 */
const jwt = require("jsonwebtoken");

/**
 * Reads the Bearer token from the Authorization header, verifies it against
 * JWT_SECRET, and populates req.auth. Returns 401 for any failure.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    // Strip the "Bearer " prefix to get the raw token string.
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ message: "Authentication required" });
    }

    // jwt.verify throws if the token is expired, tampered, or signed with a
    // different secret — all handled by the catch block below.
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.auth = {
      userId: payload.userId,
      email: payload.email,
    };

    return next();
  } catch (_error) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

module.exports = authMiddleware;
