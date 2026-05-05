/**
 * server.js
 * ----------
 * Entry point for the FaithRequest Express API.
 *
 * Responsibilities:
 *   - Loads environment variables from .env via dotenv.
 *   - Configures CORS so only whitelisted origins can call the API.
 *   - Attaches rate limiters to prevent brute-force and abuse.
 *   - Registers route modules under /api.
 *   - Connects to MongoDB, then starts the HTTP listener.
 *   - Handles SIGTERM / SIGINT for graceful shutdown (needed for ECS Fargate
 *     drain events and local Ctrl-C without leaving dangling DB connections).
 *
 * Environment variables (see backend/.env.example):
 *   PORT            - HTTP port (default 5000).
 *   JWT_SECRET      - Secret used to sign/verify JWT tokens. Required.
 *   CLIENT_ORIGIN   - Comma-separated list of allowed CORS origins.
 *                     If empty, all origins are allowed (dev-only behaviour).
 *   MONGODB_URI     - MongoDB connection string. Required.
 */
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");
const connectDB = require("./config/db");
const userRoutes = require("./routes/userRoutes");
const authRoutes = require("./routes/authRoutes");
const authMiddleware = require("./middleware/auth");

const app = express();
const port = Number(process.env.PORT) || 5000;

// Fail fast at boot if the JWT secret is missing — every protected endpoint
// depends on it, so running without it would silently break auth.
if (!process.env.JWT_SECRET) {
  console.error("Missing JWT_SECRET in environment.");
  process.exit(1);
}

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
  windowMs: 15 * 60 * 1000,  // 15-minute window
  max: 20,                    // max 20 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
});

// Data-mutation endpoints (list/prayer CRUD) get a more lenient limit since
// legitimate users can create or update many items in a session.
const mutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15-minute window
  max: 100,                   // max 100 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
// Health check — used by the ALB target group and ECS container health check.
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

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
connectDB()
  .then(() => {
    const server = app.listen(port, () => {
      console.log(`Backend running on http://localhost:${port}`);
    });

    /**
     * Graceful shutdown handler.
     * Stops accepting new connections, waits for in-flight requests to finish,
     * then closes the MongoDB connection before exiting. ECS Fargate sends
     * SIGTERM when draining a task; the 10-second timeout matches the ECS
     * deregistration delay.
     *
     * @param {string} signal - The OS signal name ("SIGTERM" | "SIGINT").
     */
    function shutdown(signal) {
      console.log(`Received ${signal}. Shutting down gracefully...`);
      server.close(async () => {
        await mongoose.connection.close();
        process.exit(0);
      });
      setTimeout(() => {
        console.error("Graceful shutdown timed out. Forcing exit.");
        process.exit(1);
      }, 10_000);
    }

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  })
  .catch((error) => {
    console.error("Failed to connect to MongoDB:", error.message);
    process.exit(1);
  });

