/**
 * db.js
 * ------
 * Connects to MongoDB using Mongoose.
 *
 * Reads MONGODB_URI from the environment. The connection is established
 * once at server start-up (see server.js → connectDB()). Mongoose then
 * manages the connection pool automatically for the lifetime of the process.
 *
 * autoIndex: true  – Mongoose will build any indexes declared in schemas on
 *                    start-up. Acceptable for a low-volume app; disable in
 *                    high-write production if index builds cause contention.
 */
const mongoose = require("mongoose");

/**
 * Opens a Mongoose connection to the URI stored in MONGODB_URI.
 * Throws if the env var is missing so the process fails fast at boot.
 */
async function connectDB() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error("MONGODB_URI is missing. Add it to your .env file.");
  }

  await mongoose.connect(mongoUri, {
    autoIndex: true,
  });

  console.log("MongoDB connected");
}

module.exports = connectDB;
