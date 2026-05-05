# ADR-0007: localStorage for Frontend Session Persistence

**Date:** 2024  
**Status:** Accepted

## Context

After a user logs in, their JWT and profile must persist across browser tabs and page reloads without forcing a re-login. The options were to store this data in memory only, in sessionStorage, or in localStorage.

Storage options considered:
- `localStorage` — persists across tabs and browser restarts
- `sessionStorage` — per-tab, cleared when tab is closed
- In-memory only — cleared on page refresh
- Secure HttpOnly cookie — set by backend, not accessible to JS

## Decision

Use `localStorage` under the key `faithrequest-auth-v1`. Store the JWT, minimal user profile, and `selectedListId`.

## Rationale

- **Persistence across page loads.** The dashboard is a multi-page app (index, login, register, dashboard are separate HTML files). localStorage is the only mechanism that shares data across navigations within the same origin without a server round-trip.
- **Versioned key prevents stale data conflicts.** The `-v1` suffix means future breaking changes to the stored shape can increment the version, and old keys will simply be ignored rather than causing parse errors.
- **Minimal data stored.** Only the JWT, user's name and email, and the last selected list ID are stored. Full prayer data is always loaded fresh from the server on each page load.
- **Simple implementation.** No external library needed — `JSON.parse` / `JSON.stringify` around `localStorage.getItem` / `setItem`.

## Trade-offs

- **XSS risk.** Data in localStorage is accessible to any JavaScript running on the same origin. A stored XSS attack could steal the JWT. Mitigated by: consistent use of `escapeHtml()` on all user content, a strict Content Security Policy (recommended for production), and the 7-day token lifetime (see ADR-0004).
- **Not accessible to service workers.** If the app later adds offline support via a service worker, the token in localStorage is not directly accessible. Cookies would be a better choice in that scenario.
- **No cross-device sync.** localStorage is per-device and per-browser. The user must log in separately on each device.

## Consequences

- `loadState()`, `saveState()`, and `clearSession()` in `app.js` are the only functions that touch localStorage.
- The same `STORAGE_KEY` constant is used in both `app.js` and `auth.js` to ensure they read and write to the same key.
- On `401` responses, `clearSession()` is called to remove the expired token before redirecting to login.
