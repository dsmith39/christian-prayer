const STORAGE_KEY = "prayer-keep-auth-v1";
const API_BASE_URL = "http://localhost:5000/api";

const mode = document.body.dataset.authMode;
const form = document.getElementById("authForm");
const submitBtn = document.getElementById("submitBtn");
const authMessage = document.getElementById("authMessage");

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function setMessage(text) {
  authMessage.textContent = text;
}

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
    localStorage.removeItem(STORAGE_KEY);
    return { selectedListId: null, auth: { token: null, user: null } };
  }
}

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
    throw new Error("Cannot reach backend. Make sure backend server is running on port 5000.");
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.message || `Request failed with status ${response.status}`);
  }

  return payload;
}

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
    clearStoredSession();
    setMessage("Session expired. Please log in again.");
  } finally {
    submitBtn.disabled = false;
  }
}

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

if (form) {
  form.addEventListener("submit", handleSubmit);
  tryAutoRedirect();
}
