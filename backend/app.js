/**
 * app.js
 * -------
 * Builds and configures the FaithRequest Express application.
 *
 * Shared by both entry points so route/middleware configuration only lives
 * in one place:
 *   - server.js  - local dev, runs this app on a plain HTTP listener.
 *   - lambda.js  - production, wraps this app with serverless-http for
 *                  API Gateway.
 *
 * Environment variables (see backend/.env.example):
 *   JWT_SECRET         - Secret used to sign/verify JWT tokens. Required.
 *   CLIENT_ORIGIN      - Comma-separated list of allowed CORS origins.
 *                        If empty, all origins are allowed (dev-only behaviour).
 *   DYNAMODB_TABLE_NAME - DynamoDB table name (read by config/dynamo.js). Required.
 */
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const userRoutes = require("./routes/userRoutes");
const authRoutes = require("./routes/authRoutes");
const authMiddleware = require("./middleware/auth");

// Fail fast at load if the JWT secret is missing — every protected endpoint
// depends on it, so running without it would silently break auth. Both
// entry points guarantee this is set (via .env or Secrets Manager) before
// requiring this module.
if (!process.env.JWT_SECRET) {
  throw new Error("Missing JWT_SECRET in environment.");
}

const app = express();

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
// Parse CLIENT_ORIGIN into an array. An empty array means "allow all", which
// is intentional for local development but should never reach production.
const allowedOrigins = (process.env.CLIENT_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow server-to-server requests that send no Origin header.
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
  })
);

// Limit request body size to 1 MB to guard against payload attacks.
app.use(express.json({ limit: "1mb" }));

// ---------------------------------------------------------------------------
// Rate limiters
// ---------------------------------------------------------------------------
// Auth endpoints (register/login) are limited more aggressively because they
// are the primary target for brute-force credential attacks.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15-minute window
  max: 20, // max 20 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
});

// Data-mutation endpoints (list/prayer CRUD) get a more lenient limit since
// legitimate users can create or update many items in a session.
const mutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15-minute window
  max: 100, // max 100 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
// Health check — used to confirm the API is reachable through API Gateway.
app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Auth routes: /api/auth/register, /api/auth/login, /api/auth/me
app.use("/api/auth", authLimiter, authRoutes);

// User data routes (all require a valid Bearer token via authMiddleware):
// /api/users/me, /api/users/lists/*, /api/users/prayers/*
app.use("/api/users", mutationLimiter, authMiddleware, userRoutes);

// ---------------------------------------------------------------------------
// Error handlers
// ---------------------------------------------------------------------------
// 404 catch-all — must come after all route registrations.
app.use((_req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Global error handler — Express calls this when next(error) is invoked.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: err.message || "Internal server error" });
});

module.exports = app;
