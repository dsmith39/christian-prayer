/**
 * config.production.example.js
 * ------------------------------
 * Example production config. Copy/rename to config.js and update the URL
 * before deploying static files to S3.
 *
 * The aws:prepare npm script replaces config.js automatically in the build
 * output at deploy/aws/out/frontend/ using the API_BASE_URL value from
 * deploy/aws/aws.env.
 */
window.APP_CONFIG = {
  // Production API URL for faithrequest.com.
  // Replace with your actual deployed backend domain before uploading to S3.
  API_BASE_URL: "https://api.faithrequest.com/api",
};
