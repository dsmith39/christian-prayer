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

if (!process.env.JWT_SECRET) {
  console.error("Missing JWT_SECRET in environment.");
  process.exit(1);
}

const allowedOrigins = (process.env.CLIENT_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
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
app.use(express.json({ limit: "1mb" }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
});

const mutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
});

app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/users", mutationLimiter, authMiddleware, userRoutes);

app.use((_req, res) => {
  res.status(404).json({ message: "Route not found" });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: err.message || "Internal server error" });
});

connectDB()
  .then(() => {
    const server = app.listen(port, () => {
      console.log(`Backend running on http://localhost:${port}`);
    });

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
