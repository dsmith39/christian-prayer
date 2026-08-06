/**
 * auth.js
 * --------
 * Handles login and registration form submission for FaithRequest.
 *
 * Shared by two pages via the data-auth-mode attribute on <body>:
 *   <body data-auth-mode="login">    → login.html
 *   <body data-auth-mode="register"> → register.html
 *
 * On page load:
 *   1. Reads the mode from data-auth-mode.
 *   2. If a JWT is already in localStorage, silently verifies it with the
 *      backend. If valid, redirects straight to dashboard.html (auto-login).
 *   3. Renders the form and waits for submission.
 *
 * On submit:
 *   - Validates inputs client-side before hitting the network.
 *   - Calls the appropriate /api/auth endpoint.
 *   - On success, persists the JWT + user object and redirects to dashboard.
 *   - On failure, displays the server error message inline.
 *
 * Session persistence, the fetch wrapper, and HTML escaping all live in
 * session.js (the `Session` global) — load session.js before this file.
 */

/** "login" or "register" — determines which API endpoint to call. */
const mode = document.body.dataset.authMode;
const form = document.getElementById("authForm");
const submitBtn = document.getElementById("submitBtn");
const authMessage = document.getElementById("authMessage");

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Trims and lowercases an email input value for consistent comparison.
 * @param {string} value
 * @returns {string}
 */
function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * Basic email format check. The server validates too; this just avoids an
 * unnecessary round-trip for obviously invalid values.
 * @param {string} value
 * @returns {boolean}
 */
function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Updates the status/error message paragraph visible below the form.
 * @param {string} text
 */
function setMessage(text) {
  authMessage.textContent = text;
}

// ---------------------------------------------------------------------------
// Auto-redirect
// ---------------------------------------------------------------------------

/**
 * Called on page load. If a stored JWT exists, validates it silently with
 * GET /api/auth/me. On success, redirects immediately to the dashboard so
 * logged-in users never see the login/register form.
 */
async function tryAutoRedirect() {
  const stored = Session.readStoredState();
  if (!stored.auth.token) {
    return;
  }

  setMessage("Checking your session...");
  submitBtn.disabled = true;

  try {
    const payload = await Session.apiRequest("/auth/me", { token: stored.auth.token });
    Session.saveSession({ token: stored.auth.token, user: payload.user || stored.auth.user });
    window.location.href = "dashboard.html";
  } catch {
    // Token is expired or invalid — clear it and let the user log in manually.
    Session.clearStoredSession();
    setMessage("Session expired. Please log in again.");
  } finally {
    submitBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Form submission
// ---------------------------------------------------------------------------

/**
 * Handles the auth form submit event for both login and register modes.
 * Validates inputs, calls the API, saves the session, and redirects on success.
 *
 * @param {SubmitEvent} event
 */
async function handleSubmit(event) {
  event.preventDefault();

  submitBtn.disabled = true;

  try {
    if (mode === "login") {
      const email = normalizeEmail(document.getElementById("email").value);
      const password = document.getElementById("password").value;

      if (!isValidEmail(email)) {
        throw new Error("Enter a valid email.");
      }

      if (!password) {
        throw new Error("Password is required.");
      }

      const payload = await Session.apiRequest("/auth/login", {
        method: "POST",
        body: { email, password },
        token: null,
      });

      Session.saveSession({ token: payload.token, user: payload.user });
      window.location.href = "dashboard.html";
      return;
    }

    if (mode === "register") {
      const name = document.getElementById("name").value.trim();
      const email = normalizeEmail(document.getElementById("email").value);
      const password = document.getElementById("password").value;

      if (!name) {
        throw new Error("Name is required.");
      }

      if (!isValidEmail(email)) {
        throw new Error("Enter a valid email.");
      }

      if (password.length < 8) {
        throw new Error("Password must be at least 8 characters.");
      }

      const payload = await Session.apiRequest("/auth/register", {
        method: "POST",
        body: { name, email, password },
        token: null,
      });

      Session.saveSession({ token: payload.token, user: payload.user });
      window.location.href = "dashboard.html";
      return;
    }

    throw new Error("Unknown auth mode.");
  } catch (error) {
    setMessage(error.message || "Could not authenticate.");
  } finally {
    submitBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
if (form) {
  form.addEventListener("submit", handleSubmit);
  tryAutoRedirect();
}
