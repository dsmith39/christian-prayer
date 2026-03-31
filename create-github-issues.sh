#!/usr/bin/env bash
# =============================================================================
# create-github-issues.sh
#
# Run this script to create GitHub issues for the improvements and fixes
# identified during code review of the Prayer Keep application.
#
# Usage:
#   gh auth login          # authenticate first if needed
#   bash create-github-issues.sh
#
# Or with an explicit token:
#   GITHUB_TOKEN=<your-token> bash create-github-issues.sh
# =============================================================================

set -euo pipefail

REPO="dsmith39/christian-prayer"

create_issue() {
  local title="$1"
  local body="$2"
  local labels="${3:-}"

  if [[ -n "$labels" ]]; then
    gh issue create --repo "$REPO" --title "$title" --body "$body" --label "$labels"
  else
    gh issue create --repo "$REPO" --title "$title" --body "$body"
  fi
}

echo "Creating GitHub issues for Prayer Keep..."

# ---------------------------------------------------------------------------
# SECURITY ISSUES
# ---------------------------------------------------------------------------

create_issue \
  "Security: API base URL is hardcoded to localhost" \
  "## Problem

The frontend files \`auth.js\` (line 2) and \`app.js\` (line 2) hardcode the API base URL:

\`\`\`js
const API_BASE_URL = \"http://localhost:5000/api\";
\`\`\`

## Impact
- The application cannot be deployed to any production environment without manual file edits.
- Different environments (staging, production) cannot be configured without code changes.

## Suggested Fix
- Read the API URL from an environment variable or derive it dynamically from \`window.location\`.
- Example: \`const API_BASE_URL = window.ENV_API_URL || \"http://localhost:5000/api\";\`
- Or inject the value at build time via a bundler (Vite, Webpack, etc.)." \
  "bug,security"

create_issue \
  "Security: No rate limiting on authentication endpoints" \
  "## Problem

The backend (\`backend/server.js\` and \`backend/routes/authRoutes.js\`) has no rate limiting on the \`/api/auth/login\` and \`/api/auth/register\` endpoints.

## Impact
- The login endpoint is vulnerable to brute-force password attacks.
- The register endpoint is vulnerable to spam account creation.

## Suggested Fix
Install and configure \`express-rate-limit\`:

\`\`\`bash
npm install express-rate-limit
\`\`\`

\`\`\`js
const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { message: 'Too many attempts, please try again later.' },
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
\`\`\`" \
  "bug,security"

create_issue \
  "Security: CORS allows all origins when CLIENT_ORIGIN is not set" \
  "## Problem

In \`backend/server.js\`, when \`CLIENT_ORIGIN\` is not set (empty string), the CORS middleware allows requests from **any** origin:

\`\`\`js
if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
  return callback(null, true);  // allows everything when allowedOrigins is empty
}
\`\`\`

## Impact
- If \`CLIENT_ORIGIN\` is accidentally left unset, the API accepts cross-origin requests from any website.

## Suggested Fix
Either require \`CLIENT_ORIGIN\` to be set in production, or default to a safe value (e.g. same-origin only):

\`\`\`js
if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  console.error('CLIENT_ORIGIN must be set in production.');
  process.exit(1);
}
\`\`\`" \
  "bug,security"

# ---------------------------------------------------------------------------
# BUG FIXES
# ---------------------------------------------------------------------------

create_issue \
  "Bug: Backend missing input length validation on user-supplied strings" \
  "## Problem

The Mongoose schema defines \`maxlength\` constraints on several fields (e.g. prayer title: 80, notes: 240, list name: 40), but the backend route handlers in \`backend/routes/userRoutes.js\` and \`backend/routes/authRoutes.js\` do **not** validate these lengths before attempting to save.

## Impact
- Requests that bypass the frontend can send oversized strings.
- Mongoose will reject them with an unhandled validation error rather than a clean 400 response.

## Suggested Fix
Add explicit length checks in the route handlers that mirror the schema constraints:

\`\`\`js
if (title.length > 80) {
  return res.status(400).json({ message: 'Prayer title must be 80 characters or fewer' });
}
\`\`\`" \
  "bug"

create_issue \
  "Bug: Prayer request PATCH endpoint only allows toggling \`answered\` — full editing not supported" \
  "## Problem

\`PATCH /api/users/lists/:listId/prayers/:prayerId\` (\`backend/routes/userRoutes.js\` lines 181-206) only checks for the \`answered\` boolean field. All other editable fields (title, notes, priority, alertEnabled, alertTime) are silently ignored.

## Impact
- Users cannot edit a prayer request's title, notes, or priority after creation.
- The only workaround is to delete and recreate the request.

## Suggested Fix
Expand the PATCH handler to accept and update all mutable prayer fields:

\`\`\`js
if (req.body.title !== undefined) prayer.title = String(req.body.title).trim();
if (req.body.notes !== undefined) prayer.notes = String(req.body.notes).trim();
if (['gentle','normal','urgent'].includes(req.body.priority)) prayer.priority = req.body.priority;
if (typeof req.body.answered === 'boolean') prayer.answered = req.body.answered;
if (typeof req.body.alertEnabled === 'boolean') {
  prayer.alertEnabled = req.body.alertEnabled;
  prayer.alertTime = req.body.alertEnabled ? (String(req.body.alertTime || '').trim() || null) : null;
}
\`\`\`

The frontend (\`app.js\`) also needs to be updated to expose an edit UI." \
  "bug,enhancement"

create_issue \
  "Bug: No endpoint to rename or update a prayer list" \
  "## Problem

There is no \`PATCH /api/users/lists/:listId\` route to update a list's name or description after creation. Once a list is created, its name and description are immutable.

## Impact
- Users who make typos in list names have no recourse other than deleting and recreating the list (losing all prayers in it).

## Suggested Fix
Add a PATCH route in \`backend/routes/userRoutes.js\`:

\`\`\`js
router.patch('/lists/:listId', async (req, res, next) => {
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim();
  const user = await findUserWithUncategorized(req.auth.userId);
  if (!user) return res.status(404).json({ message: 'User not found' });
  const list = user.prayerLists.id(req.params.listId);
  if (!list) return res.status(404).json({ message: 'Prayer list not found' });
  if (isUncategorizedList(list)) return res.status(403).json({ message: 'Cannot rename system list' });
  if (name) list.name = name;
  list.description = description;
  await user.save();
  return res.status(200).json({ user: userResponse(user) });
});
\`\`\`" \
  "bug,enhancement"

create_issue \
  "Bug: Alert time processing has no input validation" \
  "## Problem

In \`app.js\`, \`computeNextAlertAt()\` parses prayer alert times assuming the format is always \`HH:MM\`. There is no validation that the stored \`alertTime\` string matches this format.

## Impact
- Malformed time strings (e.g. from direct API calls) could cause \`NaN\` comparisons and silent failures in the alert scheduling loop.

## Suggested Fix
Add format validation in \`computeNextAlertAt()\`:

\`\`\`js
function computeNextAlertAt(timeStr) {
  if (!/^\d{2}:\d{2}$/.test(timeStr)) return null;
  // ... rest of function
}
\`\`\`

Also validate on the backend in \`parsePrayerPayload\`." \
  "bug"

# ---------------------------------------------------------------------------
# MISSING FEATURES
# ---------------------------------------------------------------------------

create_issue \
  "Feature: Add account deletion endpoint" \
  "## Problem

Users have no way to delete their account or purge their data from the application.

## Impact
- Potential GDPR / privacy compliance issue.
- Users who want to leave the platform cannot remove their data.

## Suggested Fix
Add \`DELETE /api/users/me\` to \`backend/routes/userRoutes.js\`:

\`\`\`js
router.delete('/me', async (req, res, next) => {
  try {
    await User.findByIdAndDelete(req.auth.userId);
    return res.status(200).json({ message: 'Account deleted' });
  } catch (error) {
    return next(error);
  }
});
\`\`\`

Add a confirmation dialog in the frontend before calling this endpoint." \
  "enhancement"

create_issue \
  "Feature: Add password reset via email" \
  "## Problem

There is no mechanism for users to reset a forgotten password. Once a password is lost the account is permanently inaccessible.

## Suggested Solution
1. Add \`POST /api/auth/forgot-password\` – generates a time-limited reset token and emails it to the user.
2. Add \`POST /api/auth/reset-password\` – accepts the token and a new password, updates the hash.
3. Store the reset token (hashed) and expiry on the User model.
4. Use a transactional email provider (e.g. SendGrid, Resend, Nodemailer + SMTP)." \
  "enhancement"

create_issue \
  "Feature: Add email verification on registration" \
  "## Problem

Users can register with any email address (including invalid or other people's addresses) without any verification step.

## Impact
- Allows spam/throwaway account creation.
- No guarantee the user controls the email on their account.

## Suggested Solution
1. Send a verification email with a one-time link after registration.
2. Mark accounts as \`emailVerified: false\` until the link is clicked.
3. Restrict access to protected routes until email is verified." \
  "enhancement"

create_issue \
  "Feature: Introduce unit and integration tests" \
  "## Problem

Both \`package.json\` files define a \`test\` script that simply exits with an error (\`echo \"Error: no test specified\" && exit 1\`). There are zero automated tests in the project.

## Impact
- Regressions go undetected.
- Refactoring is risky without a safety net.

## Suggested Fix
- **Backend**: Add Jest (or Mocha + Supertest) tests for:
  - Auth routes (\`register\`, \`login\`, \`/me\`)
  - User routes (CRUD for lists and prayers)
  - \`uncategorizedList\` utility functions
- **Frontend**: Add tests for utility functions in \`auth.js\` and \`app.js\` (e.g. \`isValidEmail\`, \`computeNextAlertAt\`, \`escapeHtml\`)." \
  "enhancement,testing"

create_issue \
  "Feature: Add graceful shutdown handling to the backend server" \
  "## Problem

\`backend/server.js\` has no \`SIGTERM\` / \`SIGINT\` handler. When the process is killed (e.g. by a container orchestrator or \`Ctrl-C\`), in-flight requests are dropped and the MongoDB connection is not cleanly closed.

## Suggested Fix

\`\`\`js
const server = app.listen(port, () => { /* ... */ });

async function shutdown(signal) {
  console.log(\`Received \${signal}. Shutting down gracefully...\`);
  server.close(async () => {
    await mongoose.connection.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000); // force-exit after 10 s
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
\`\`\`" \
  "enhancement"

create_issue \
  "Feature: No timezone support for prayer alert times" \
  "## Problem

Alert times are stored as plain \`HH:MM\` strings in the database (\`backend/models/User.js\`). No timezone information is saved. The alert comparison in \`app.js\` uses the browser's local time, but a user travelling across timezones will have alerts fire at the wrong local time.

## Suggested Fix
- Add a \`timezone\` field to the \`UserSchema\` (e.g. an IANA timezone string like \`'America/New_York'\`).
- Allow users to set their timezone in an account settings page.
- Use the \`Intl\` API on the client to convert alert times to the stored timezone before comparison." \
  "enhancement"

# ---------------------------------------------------------------------------
# CODE QUALITY
# ---------------------------------------------------------------------------

create_issue \
  "Code quality: Magic numbers should be extracted to named constants" \
  "## Problem

Several files contain \"magic numbers\" (unexplained inline numeric literals) that make the code harder to read and maintain:

| File | Line | Value | Meaning |
|------|------|-------|---------|
| \`app.js\` | ~778 | \`30000\` | Alert polling interval (30 s) |
| \`app.js\` | ~460 | \`5000\` | Undo window for list deletion (5 s) |
| \`app.js\` | ~156 | \`4500\` | Toast notification display duration |

## Suggested Fix
Define named constants at the top of each file:

\`\`\`js
const ALERT_POLL_INTERVAL_MS = 30_000;
const LIST_DELETE_UNDO_MS    =  5_000;
const TOAST_DURATION_MS      =  4_500;
\`\`\`" \
  "code-quality"

create_issue \
  "Code quality: Add structured logging to replace console.log / console.error calls" \
  "## Problem

The backend uses bare \`console.log\` and \`console.error\` calls throughout. In production this produces unstructured, hard-to-search output with no log levels, timestamps, or correlation IDs.

## Suggested Fix
Replace \`console\` calls with a structured logger such as [pino](https://github.com/pinojs/pino) or [winston](https://github.com/winstonjs/winston):

\`\`\`bash
npm install pino pino-pretty
\`\`\`

\`\`\`js
const logger = require('pino')();
logger.info('Backend running on port %d', port);
logger.error({ err }, 'Unhandled error');
\`\`\`" \
  "code-quality"

create_issue \
  "Code quality: Frontend API base URL should support production deployment" \
  "## Problem

Both \`app.js\` and \`auth.js\` start with \`const API_BASE_URL = \"http://localhost:5000/api\";\`. This is fine for local development, but makes production deployment impossible without editing source files.

## Related
This is connected to the security issue about hardcoded URLs, but this ticket focuses on the developer-experience aspect: how to structure the project so that environment-specific config is cleanly separated from source code.

## Suggested Approach
- Migrate to a bundler (Vite is lightweight and zero-config for vanilla JS).
- Use \`import.meta.env.VITE_API_URL\` for the base URL.
- Provide a \`.env.example\` file for the frontend similar to the one already present in \`backend/\`." \
  "code-quality,enhancement"

echo ""
echo "Done! All issues have been created in $REPO."
