/**
 * session.js
 * ----------
 * Shared session/localStorage/API helpers used by both app.js (dashboard)
 * and auth.js (login/register). Load this before either of those files.
 *
 * Exposes a single global: `Session`.
 */
const Session = (function () {
  const STORAGE_KEY = "faithrequest-auth-v1";

  const API_BASE_URL =
    window.APP_CONFIG?.API_BASE_URL ||
    `${window.location.protocol}//${window.location.hostname}:5000/api`;

  /**
   * Reads the persisted session from localStorage.
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
        selectedListId: typeof parsed.selectedListId === "string" ? parsed.selectedListId : null,
        auth: {
          token: typeof parsed.auth?.token === "string" ? parsed.auth.token : null,
          user: parsed.auth?.user || null,
        },
      };
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return { selectedListId: null, auth: { token: null, user: null } };
    }
  }

  /**
   * Writes the full session shape to localStorage.
   * @param {{ selectedListId?: string|null, token?: string|null, user?: object|null }} partial
   */
  function saveSession(partial = {}) {
    const existing = readStoredState();
    const next = {
      selectedListId:
        "selectedListId" in partial ? partial.selectedListId : existing.selectedListId,
      auth: {
        token: "token" in partial ? partial.token : existing.auth.token,
        user: "user" in partial ? partial.user : existing.auth.user,
      },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  /**
   * Clears the auth token/user but preserves selectedListId, so a future
   * login on this browser reopens the same list.
   */
  function clearStoredSession() {
    const existing = readStoredState();
    saveSession({ selectedListId: existing.selectedListId, token: null, user: null });
  }

  /**
   * Escapes HTML special characters to prevent XSS when inserting
   * user-supplied text via innerHTML.
   * @param {string|number} text
   * @returns {string}
   */
  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  /**
   * Shared fetch wrapper for all API calls (authenticated or not).
   *
   * @param {string} path - API path relative to API_BASE_URL.
   * @param {{ method?: string, body?: object|null, token?: string|null, onUnauthorized?: Function }} options
   *   token          - Bearer token to send. Defaults to the token in localStorage.
   *                     Pass null explicitly to send no Authorization header.
   *   onUnauthorized - Called (in addition to throwing) on a 401 response.
   * @returns {Promise<object>}
   * @throws {Error}
   */
  async function apiRequest(path, options = {}) {
    const { method = "GET", body = null, onUnauthorized = null } = options;
    const token = "token" in options ? options.token : readStoredState().auth.token;

    const headers = {};
    if (body !== null && body !== undefined) {
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
        body: body === null || body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (_error) {
      throw new Error("Cannot reach backend. Check your API base URL configuration.");
    }

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401 && typeof onUnauthorized === "function") {
        onUnauthorized();
      }
      throw new Error(payload.message || `Request failed with status ${response.status}`);
    }

    return payload;
  }

  return {
    STORAGE_KEY,
    API_BASE_URL,
    readStoredState,
    saveSession,
    clearStoredSession,
    escapeHtml,
    apiRequest,
  };
})();
