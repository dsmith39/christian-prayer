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
 * Session data is stored in localStorage under STORAGE_KEY so it survives
 * page refreshes. The key must match the one used in app.js.
 */

/** localStorage key — must match the constant in app.js. */
const STORAGE_KEY = "faithrequest-auth-v1";

/**
 * Backend API base URL. Reads from window.APP_CONFIG (set in config.js) so
 * the same auth.js works in both dev and production without modification.
 */
const API_BASE_URL =
  window.APP_CONFIG?.API_BASE_URL ||
  `${window.location.protocol}//${window.location.hostname}:5000/api`;

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
// localStorage session management
// ---------------------------------------------------------------------------

/**
 * Reads the persisted session state from localStorage.
 * Returns safe defaults on missing or corrupt data.
 *
 * @returns {{ selectedListId: string|null, auth: { token: string|null, user: object|null } }}
 */
function readStoredState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { selectedListId: null, auth: { token: null, user: null } };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      selectedListId: parsed.selectedListId || null,
      auth: {
        token: parsed.auth?.token || null,
        user: parsed.auth?.user || null,
      },
    };
  } catch {
    // Corrupt data — remove it so the user can start fresh.
    localStorage.removeItem(STORAGE_KEY);
    return { selectedListId: null, auth: { token: null, user: null } };
  }
}

/**
 * Persists a new JWT and user object while preserving the previously selected
 * list so the dashboard reopens on the same list after login.
 *
 * @param {string} token - Signed JWT from the server.
 * @param {object} user  - User object from the server response.
 */
function saveSession(token, user) {
  const existing = readStoredState();
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      selectedListId: existing.selectedListId,
      auth: {
        token,
        user,
      },
    })
  );
}

/**
 * Clears the auth token and user from localStorage without touching the
 * selectedListId, so after re-login the dashboard reopens on the last list.
 */
function clearStoredSession() {
  const existing = readStoredState();
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      selectedListId: existing.selectedListId,
      auth: {
        token: null,
        user: null,
      },
    })
  );
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/**
 * Minimal fetch wrapper used only on auth pages. Throws on network error or
 * non-2xx responses, so callers can use try/catch.
 *
 * @param {string} path           - API path relative to API_BASE_URL.
 * @param {{ method?, body?, token? }} options
 * @returns {Promise<object>}     - Parsed JSON response body.
 */
async function request(path, options = {}) {
  const { method = "GET", body = null, token = null } = options;
  const headers = {};

  if (body) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (_error) {
    throw new Error("Cannot reach backend. Check your API base URL configuration.");
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.message || `Request failed with status ${response.status}`);
  }

  return payload;
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
  const stored = readStoredState();
  if (!stored.auth.token) {
    return;
  }

  setMessage("Checking your session...");
  submitBtn.disabled = true;

  try {
    const payload = await request("/auth/me", { token: stored.auth.token });
    saveSession(stored.auth.token, payload.user || stored.auth.user);
    window.location.href = "dashboard.html";
  } catch {
    // Token is expired or invalid — clear it and let the user log in manually.
    clearStoredSession();
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

      const payload = await request("/auth/login", {
        method: "POST",
        body: { email, password },
      });

      saveSession(payload.token, payload.user);
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

      const payload = await request("/auth/register", {
        method: "POST",
        body: { name, email, password },
      });

      saveSession(payload.token, payload.user);
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

