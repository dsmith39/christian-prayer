/**
 * server.js
 * ----------
 * Local development entry point. Starts the Express app built in app.js on
 * a plain HTTP listener. Deployed environments use lambda.js instead.
 */
require("dotenv").config();

const app = require("./app");
const port = Number(process.env.PORT) || 5000;

const server = app.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});

/**
 * Graceful shutdown handler. Stops accepting new connections and waits for
 * in-flight requests to finish before exiting.
 *
 * @param {string} signal - The OS signal name ("SIGTERM" | "SIGINT").
 */
function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  server.close(() => process.exit(0));
  setTimeout(() => {
    console.error("Graceful shutdown timed out. Forcing exit.");
    process.exit(1);
  }, 10_000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
