/**
 * config.js
 * ----------
 * Runtime configuration for the FaithRequest frontend.
 *
 * This file is loaded by every HTML page before app.js and auth.js so that
 * the API base URL is available as window.APP_CONFIG.API_BASE_URL before
 * any fetch calls are made.
 *
 * LOCAL DEV: the default points to the Express server at localhost:5000.
 * PRODUCTION: replace this file's content with the production URL before
 *             uploading static files to S3. See config.production.example.js
 *             and the aws:prepare npm script, which does this automatically.
 *
 * Never hard-code the URL directly in app.js or auth.js — keeping it in a
 * separate file makes it easy to swap without touching application logic.
 */
window.APP_CONFIG = {
  // Local development default. Change to https://api.faithrequest.com/api for production.
  API_BASE_URL: "http://localhost:5000/api",
};
