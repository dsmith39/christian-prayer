/**
 * app.js
 * -------
 * Main application script for the FaithRequest dashboard (dashboard.html).
 *
 * Architecture overview:
 *   - Pure vanilla JS, no framework. All state lives in the `state` object.
 *   - On load, reads any cached auth/session data from localStorage, then
 *     fetches the full user profile from the backend to hydrate state.
 *   - Every mutation (create/update/delete list or prayer) calls the REST API,
 *     then calls applyUserData() with the returned user object to replace the
 *     entire local state, keeping the UI in sync with the server.
 *   - DOM is re-rendered from scratch on every state change (render()).
 *     Performance is fine at the scale of prayer lists.
 *   - Browser notifications are optional. The app still works with in-app
 *     toast messages if the user denies notification permission.
 *
 * Key concepts:
 *   state         - Single source of truth for lists, prayers, and auth.
 *   dom           - Cached references to DOM elements (queried once on load).
 *   STORAGE_KEY   - localStorage key for persisting session between page loads.
 *   apiRequest()  - Fetch wrapper: attaches Bearer token, parses JSON, handles
 *                   401 (session expired → redirect to login).
 *   applyUserData()- Transforms the server User document into local state shape.
 *   render()      - Reads state and rebuilds the DOM.
 *   init()        - Entry point, called on DOMContentLoaded.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** localStorage key — must match the constant in auth.js. */
const STORAGE_KEY = "faithrequest-auth-v1";

/**
 * Backend API base URL. Reads from window.APP_CONFIG (set in config.js) so
 * the same app.js works in dev and production without modification.
 */
const API_BASE_URL =
  window.APP_CONFIG?.API_BASE_URL ||
  `${window.location.protocol}//${window.location.hostname}:5000/api`;

/** How often (ms) the alert scheduler runs to check if a prayer reminder is due. */
const ALERT_POLL_INTERVAL_MS = 30_000;
/** How long (ms) the user has to undo a list deletion before it's committed. */
const LIST_DELETE_UNDO_MS = 5_000;
/** How long (ms) a standard toast notification stays visible. */
const TOAST_DURATION_MS = 4_500;

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------

/**
 * Single source of truth for the entire dashboard.
 *
 * lists[]            - Flat array of prayer list objects (derived from server).
 * prayers[]          - Flat array of prayer request objects (derived from server).
 * selectedListId     - ID of the list currently shown in the prayer panel.
 * pendingListDeletes - Map of listId → undo state for lists queued for deletion.
 * auth.token         - JWT for authenticating API requests.
 * auth.user          - Minimal user profile (id, name, email).
 */
const state = {
  lists: [],
  prayers: [],
  selectedListId: null,
  pendingListDeletes: {},
  auth: {
    token: null,
    user: null,
  },
};

// ---------------------------------------------------------------------------
// DOM element cache
// ---------------------------------------------------------------------------

/**
 * All DOM references are queried once here rather than inside render loops.
 * If a new element is added to dashboard.html, add it here too.
 */
const dom = {
  listForm: document.getElementById("listForm"),
  prayerForm: document.getElementById("prayerForm"),
  listContainer: document.getElementById("listContainer"),
  prayerGrid: document.getElementById("prayerGrid"),
  activeListTitle: document.getElementById("activeListTitle"),
  activeListDescription: document.getElementById("activeListDescription"),
  addPrayerBtn: document.getElementById("addPrayerBtn"),
  requestCount: document.getElementById("requestCount"),
  enableNotificationsBtn: document.getElementById("enableNotificationsBtn"),
  toastRegion: document.getElementById("toastRegion"),
  listName: document.getElementById("listName"),
  listDescription: document.getElementById("listDescription"),
  prayerTitle: document.getElementById("prayerTitle"),
  prayerNotes: document.getElementById("prayerNotes"),
  priority: document.getElementById("priority"),
  alertEnabled: document.getElementById("alertEnabled"),
  alertTime: document.getElementById("alertTime"),
  accountNameText: document.getElementById("accountNameText"),
  accountEmailText: document.getElementById("accountEmailText"),
  authStatus: document.getElementById("authStatus"),
  logoutBtn: document.getElementById("logoutBtn"),
};

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

/**
 * Reads the persisted session from localStorage and seeds `state` with it.
 * Only restores selectedListId and auth — lists and prayers always come from
 * the server on each load.
 */
function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    state.selectedListId = typeof parsed.selectedListId === "string" ? parsed.selectedListId : null;
    state.auth.token = typeof parsed.auth?.token === "string" ? parsed.auth.token : null;
    state.auth.user = parsed.auth?.user || null;
  } catch {
    // Corrupt data — remove it so the app starts clean.
    localStorage.removeItem(STORAGE_KEY);
  }
}

/**
 * Writes the minimal session fields to localStorage.
 * Called after every mutation that changes selectedListId or auth.
 */
function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      selectedListId: state.selectedListId,
      auth: {
        token: state.auth.token,
        user: state.auth.user,
      },
    })
  );
}

/**
 * Clears the authenticated session from both memory and localStorage.
 * Also cancels any in-progress list-deletion timers to avoid orphaned state.
 * Called on logout and on 401 responses from the API.
 */
function clearSession() {
  // Clean up pending deletion timers so they don't fire after logout.
  Object.values(state.pendingListDeletes).forEach((entry) => {
    clearTimeout(entry.timeoutId);
    clearInterval(entry.countdownIntervalId);
    clearTimeout(entry.toastRemoveTimerId);
    entry.toastEl?.remove();
  });

  state.pendingListDeletes = {};
  state.auth.token = null;
  state.auth.user = null;
  state.lists = [];
  state.prayers = [];
  state.selectedListId = null;
  saveState();
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/** Redirects the browser to login.html. */
function redirectToLogin() {
  window.location.href = "login.html";
}

/**
 * Returns true when the in-memory state has a token AND a user ID,
 * indicating the session is at least nominally valid.
 * The actual server-side check happens in hydrateFromServer().
 *
 * @returns {boolean}
 */
function isAuthenticated() {
  return Boolean(state.auth.token && state.auth.user?._id);
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/**
 * Escapes HTML special characters to prevent XSS when inserting user-supplied
 * text via innerHTML. Use this on every piece of user content rendered into
 * the DOM with innerHTML or template literals.
 *
 * @param {string|number} text
 * @returns {string} HTML-safe string.
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
 * Calculates the Unix timestamp (ms) of the next occurrence of the given
 * "HH:MM" time, relative to `fromDate`. If the time has already passed today,
 * returns tomorrow's occurrence.
 *
 * @param {string} timeValue - "HH:MM" 24-hour time string.
 * @param {Date}   fromDate  - Reference date (default: now).
 * @returns {number|null}    - Timestamp in ms, or null if timeValue is invalid.
 */
function computeNextAlertAt(timeValue, fromDate = new Date()) {
  if (!timeValue || !/^\d{2}:\d{2}$/.test(timeValue)) {
    return null;
  }

  const [hour, minute] = timeValue.split(":").map(Number);
  const next = new Date(fromDate);
  next.setHours(hour, minute, 0, 0);

  // If the computed time is in the past, schedule for tomorrow.
  if (next.getTime() <= fromDate.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next.getTime();
}

/**
 * Formats a Unix timestamp as a human-readable short date/time string.
 * Returns "No alert" when the timestamp is falsy.
 *
 * @param {number|null} timestamp
 * @returns {string} e.g. "Mon, 9:00 AM"
 */
function formatDateTime(timestamp) {
  if (!timestamp) {
    return "No alert";
  }

  return new Date(timestamp).toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Toast notification system
// ---------------------------------------------------------------------------

/**
 * Displays a temporary toast message in the aria-live toast region.
 * Supports an optional action button (e.g. "Undo") for reversible operations.
 *
 * @param {string} message             - Text to display.
 * @param {{ durationMs?, actionText?, onAction? }} options
 *   durationMs  - How long the toast stays visible (default: TOAST_DURATION_MS).
 *   actionText  - Label for the optional action button.
 *   onAction    - Callback invoked when the action button is clicked.
 */
function showToast(message, options = {}) {
  const { durationMs = TOAST_DURATION_MS, actionText = null, onAction = null } = options;
  const toast = document.createElement("div");
  toast.className = "toast";

  const messageSpan = document.createElement("span");
  messageSpan.className = "toast-message";
  messageSpan.textContent = message;
  toast.appendChild(messageSpan);

  if (actionText && typeof onAction === "function") {
    const actionButton = document.createElement("button");
    actionButton.type = "button";
    actionButton.className = "toast-action";
    actionButton.textContent = actionText;
    actionButton.addEventListener("click", () => {
      onAction();
      toast.remove();
    });
    toast.appendChild(actionButton);
  }

  dom.toastRegion.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, durationMs);
}

// ---------------------------------------------------------------------------
// API layer
// ---------------------------------------------------------------------------

/**
 * Fetch wrapper for all authenticated API calls.
 *
 * - Attaches the Bearer token from state.auth.token.
 * - Serializes body as JSON when provided.
 * - Automatically handles 401 (session expired): clears session and redirects.
 * - Throws descriptive errors for all non-2xx responses so callers can
 *   display them via showToast().
 *
 * @param {string} path                  - API path relative to API_BASE_URL.
 * @param {{ method?, body? }} options
 * @returns {Promise<object>}            - Parsed JSON response body.
 * @throws {Error}                       - On network failure or non-2xx status.
 */
async function apiRequest(path, options = {}) {
  const { method = "GET", body = null } = options;
  const headers = {
    Authorization: `Bearer ${state.auth.token}`,
  };

  if (body !== null) {
    headers["Content-Type"] = "application/json";
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
    });
  } catch (_error) {
    throw new Error("Cannot reach backend. Check your API base URL configuration.");
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      // Token is expired or revoked — clear the session and send the user
      // back to the login page.
      clearSession();
      redirectToLogin();
      throw new Error("Your session expired. Please log in again.");
    }

    throw new Error(payload.message || `Request failed with status ${response.status}`);
  }

  return payload;
}

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

/**
 * Replaces the entire local lists/prayers state with the data returned by the
 * server after any successful API call. This is the single function that keeps
 * the frontend in sync with the backend.
 *
 * Converts the nested server shape (User → prayerLists[] → prayers[]) into
 * two flat arrays (state.lists and state.prayers) for easier rendering and
 * lookup. Also restores the previously selected list when possible.
 *
 * @param {object} user - The full User document from the API response.
 */


function applyUserData(user) {
  const previousSelected = state.selectedListId;
  const nextLists = [];
  const nextPrayers = [];

  const prayerLists = Array.isArray(user?.prayerLists) ? user.prayerLists : [];

  prayerLists.forEach((list) => {
    const listId = String(list._id);
    const systemKey = typeof list.systemKey === "string" ? list.systemKey : "";
    const isSystem = Boolean(list.isSystem) || systemKey === "uncategorized";

    nextLists.push({
      id: listId,
      name: list.name || "Untitled List",
      description: list.description || "",
      createdAt: new Date(list.createdAt || Date.now()).getTime(),
      isSystem,
      systemKey,
    });

    const prayers = Array.isArray(list.prayers) ? list.prayers : [];
    prayers.forEach((prayer) => {
      const alertEnabled = Boolean(prayer.alertEnabled);
      const answered = Boolean(prayer.answered);
      const alertTime = alertEnabled ? prayer.alertTime || null : null;

      nextPrayers.push({
        id: String(prayer._id),
        listId,
        title: prayer.title || "Untitled Request",
        notes: prayer.notes || "",
        priority: prayer.priority || "normal",
        answered,
        alertEnabled,
        alertTime,
        nextAlertAt:
          alertEnabled && !answered && alertTime ? computeNextAlertAt(alertTime) : null,
        createdAt: new Date(prayer.createdAt || Date.now()).getTime(),
      });
    });
  });

  state.lists = nextLists;
  state.prayers = nextPrayers;

  if (previousSelected && nextLists.some((list) => list.id === previousSelected)) {
    state.selectedListId = previousSelected;
  } else {
    state.selectedListId = nextLists[0]?.id || null;
  }

  state.auth.user = {
    _id: String(user._id),
    name: user.name || "",
    email: user.email || "",
  };

  dom.accountNameText.textContent = state.auth.user.name || "-";
  dom.accountEmailText.textContent = state.auth.user.email || "-";
  dom.authStatus.textContent = `Logged in as ${state.auth.user.name} (${state.auth.user.email})`;

  saveState();
}

/**
 * Returns the currently selected list, or null if nothing is selected or the
 * selected list is pending deletion.
 *
 * @returns {object|null}
 */
function getSelectedList() {
  return (
    state.lists.find(
      (list) => list.id === state.selectedListId && !state.pendingListDeletes[list.id]
    ) || null
  );
}

/**
 * Counts active (non-answered) prayer requests in the given list.
 * Used to show the badge count on each list button.
 *
 * @param {string} listId
 * @returns {number}
 */
function getListPrayerCount(listId) {
  return state.prayers.filter((prayer) => prayer.listId === listId && !prayer.answered).length;
}

/**
 * Enables or disables all form inputs and submit buttons.
 * Called with false during async operations to prevent double-submit,
 * and with true after the operation completes.
 *
 * @param {boolean} enabled
 */
function setFormsEnabled(enabled) {
  dom.listName.disabled = !enabled;
  dom.listDescription.disabled = !enabled;
  dom.listForm.querySelector("button[type='submit']").disabled = !enabled;

  dom.prayerTitle.disabled = !enabled;
  dom.prayerNotes.disabled = !enabled;
  dom.priority.disabled = !enabled;
  dom.alertEnabled.disabled = !enabled;
  dom.alertTime.disabled = !enabled;
  dom.addPrayerBtn.disabled = !enabled || !getSelectedList();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Rebuilds the list sidebar from state.lists.
 * System lists show a lock badge and no delete button.
 * Lists pending deletion are hidden until the undo window expires.
 */
function renderLists() {
  dom.listContainer.innerHTML = "";

  const visibleLists = state.lists.filter((list) => !state.pendingListDeletes[list.id]);

  if (visibleLists.length === 0) {
    dom.listContainer.innerHTML =
      '<div class="empty">No lists yet. Create your first prayer list.</div>';
    return;
  }

  visibleLists.forEach((list) => {
    const isLockedList = Boolean(list.isSystem) || list.systemKey === "uncategorized";

    const row = document.createElement("div");
    row.className = "list-item-row";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "list-item";

    if (state.selectedListId === list.id) {
      button.classList.add("active");
    }

    const count = getListPrayerCount(list.id);
    button.innerHTML = `
      <strong>
        ${escapeHtml(list.name)}
        ${isLockedList ? '<span class="system-lock-badge" aria-label="Protected list" title="Protected list">Lock</span>' : ""}
      </strong>
      <small>${escapeHtml(list.description || "No description")}</small>
      ${isLockedList ? '<small>Default list</small>' : ""}
      <small>${count} active request${count === 1 ? "" : "s"}</small>
    `;

    button.addEventListener("click", () => {
      state.selectedListId = list.id;
      saveState();
      render();
    });

    row.appendChild(button);

    if (!isLockedList) {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "list-delete-btn";
      deleteButton.textContent = "Delete";
      deleteButton.title = `Delete ${list.name}`;
      deleteButton.addEventListener("click", async () => {
        await queueListDeletion(list.id, list.name);
      });
      row.appendChild(deleteButton);
    }

    dom.listContainer.appendChild(row);
  });
}

/**
 * Returns the ID of the first list that is not pending deletion,
 * used to auto-select a new list when the selected one is queued for delete.
 *
 * @returns {string|null}
 */
function firstVisibleListId() {
  const list = state.lists.find((item) => !state.pendingListDeletes[item.id]);
  return list ? list.id : null;
}

/** Formats the countdown message shown in the delete undo toast. */
function formatDeleteCountdownMessage(listName, secondsLeft) {
  return `"${listName}" will be deleted in ${secondsLeft}s.`;
}

/**
 * Creates and mounts a toast with a live countdown and an Undo button.
 * Returns references to the DOM element and timer IDs so they can be
 * cancelled if the user presses Undo or the page unmounts.
 *
 * @param {string} listId
 * @param {string} listName
 * @param {number} totalSeconds
 * @returns {{ toastEl, countdownIntervalId, toastRemoveTimerId }}
 */
function showDeleteCountdownToast(listId, listName, totalSeconds) {
  const toast = document.createElement("div");
  toast.className = "toast";

  const messageSpan = document.createElement("span");
  messageSpan.className = "toast-message";
  let secondsLeft = totalSeconds;
  messageSpan.textContent = formatDeleteCountdownMessage(listName, secondsLeft);

  const actionButton = document.createElement("button");
  actionButton.type = "button";
  actionButton.className = "toast-action";
  actionButton.textContent = "Undo";
  actionButton.addEventListener("click", () => {
    undoListDeletion(listId);
  });

  toast.appendChild(messageSpan);
  toast.appendChild(actionButton);
  dom.toastRegion.appendChild(toast);

  const countdownIntervalId = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      clearInterval(countdownIntervalId);
      return;
    }
    messageSpan.textContent = formatDeleteCountdownMessage(listName, secondsLeft);
  }, 1000);

  const toastRemoveTimerId = setTimeout(() => {
    toast.remove();
  }, totalSeconds * 1000 + 300);

  return {
    toastEl: toast,
    countdownIntervalId,
    toastRemoveTimerId,
  };
}

/**
 * Cancels the pending deletion for a list and restores it in the UI.
 * Called when the user clicks the Undo button in the countdown toast.
 *
 * @param {string} listId
 */
function undoListDeletion(listId) {
  const pending = state.pendingListDeletes[listId];
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeoutId);
  clearInterval(pending.countdownIntervalId);
  clearTimeout(pending.toastRemoveTimerId);
  pending.toastEl?.remove();

  delete state.pendingListDeletes[listId];

  if (!state.selectedListId) {
    state.selectedListId = listId;
  }

  render();
  showToast("List deletion canceled.");
}

/**
 * Called when the LIST_DELETE_UNDO_MS window expires.
 * Sends the DELETE request to the server and updates state.
 *
 * @param {string} listId
 * @param {string} listName
 */
async function commitListDeletion(listId, listName) {
  const pending = state.pendingListDeletes[listId];
  if (!pending) {
    return;
  }

  clearInterval(pending.countdownIntervalId);
  clearTimeout(pending.toastRemoveTimerId);
  pending.toastEl?.remove();
  delete state.pendingListDeletes[listId];

  try {
    const payload = await apiRequest(`/users/lists/${encodeURIComponent(listId)}`, {
      method: "DELETE",
    });
    applyUserData(payload.user);
    render();
    showToast(`Deleted \"${listName}\".`);
  } catch (error) {
    showToast(error.message || "Could not delete prayer list.");
    render();
  }
}

/**
 * Begins the soft-delete flow for a prayer list:
 *   1. Confirms with the user via window.confirm.
 *   2. Marks the list as pending deletion so it disappears from the UI.
 *   3. Starts a LIST_DELETE_UNDO_MS countdown toast with an Undo button.
 *   4. On expiry, calls commitListDeletion() to hit the DELETE API.
 *
 * Prevents duplicate deletion of the same list if already queued.
 * System lists (Uncategorized) are blocked from deletion.
 *
 * @param {string} listId
 * @param {string} listName
 */
async function queueListDeletion(listId, listName) {
  if (state.pendingListDeletes[listId]) {
    return;
  }

  const targetList = state.lists.find((item) => item.id === listId);
  if (targetList && (targetList.isSystem || targetList.systemKey === "uncategorized")) {
    showToast("Uncategorized list cannot be deleted.");
    return;
  }

  const confirmed = window.confirm(
    `Delete the prayer list \"${listName}\" and all its prayer requests?`
  );
  if (!confirmed) {
    return;
  }

  const timeoutId = setTimeout(() => {
    commitListDeletion(listId, listName);
  }, LIST_DELETE_UNDO_MS);

  const toastState = showDeleteCountdownToast(listId, listName, LIST_DELETE_UNDO_MS / 1000);

  state.pendingListDeletes[listId] = {
    listName,
    timeoutId,
    ...toastState,
  };

  if (state.selectedListId === listId) {
    state.selectedListId = firstVisibleListId();
  }

  render();
}

/**
 * Updates the title and description above the prayer grid based on the
 * currently selected list. Shows a prompt when nothing is selected.
 */
function renderPrayerPanelHeader() {
  const selectedList = getSelectedList();
  if (!selectedList) {
    dom.activeListTitle.textContent = "Create your first list";
    dom.activeListDescription.textContent =
      "Use the list form to create a prayer list, then add requests here.";
    return;
  }

  dom.activeListTitle.textContent = selectedList.name;
  dom.activeListDescription.textContent =
    selectedList.description || "Add requests and set daily alerts.";
}

/**
 * Rebuilds the prayer grid for the selected list.
 *
 * Sort order: active prayers (newest first) → answered prayers.
 * Each card renders the title, notes, priority tag, alert info, and
 * action buttons (Mark Answered/Active + Delete) via data attributes.
 * All user-supplied text is passed through escapeHtml() before injection.
 */
function renderPrayers() {
  dom.prayerGrid.innerHTML = "";

  const selectedList = getSelectedList();
  if (!selectedList) {
    dom.requestCount.textContent = "0 active requests";
    dom.prayerGrid.innerHTML =
      '<div class="empty">Create a list to begin tracking prayer requests.</div>';
    return;
  }

  const prayers = state.prayers.filter((item) => item.listId === selectedList.id);
  const activeCount = prayers.filter((item) => !item.answered).length;
  dom.requestCount.textContent = `${activeCount} active request${activeCount === 1 ? "" : "s"}`;

  if (prayers.length === 0) {
    dom.prayerGrid.innerHTML = '<div class="empty">No requests yet. Add one above.</div>';
    return;
  }

  prayers
    .sort((a, b) => {
      if (a.answered !== b.answered) {
        return a.answered ? 1 : -1;
      }
      return b.createdAt - a.createdAt;
    })
    .forEach((item, index) => {
      const card = document.createElement("article");
      card.className = "prayer-card";
      card.style.animationDelay = `${index * 40}ms`;

      const priorityLabel =
        item.priority === "urgent" ? "Urgent" : item.priority === "gentle" ? "Gentle" : "Normal";
      card.innerHTML = `
        <h4>${escapeHtml(item.title)}</h4>
        <p>${escapeHtml(item.notes || "No notes provided.")}</p>
        <div class="tag-row">
          <span class="tag ${item.priority === "urgent" ? "urgent" : ""}">${priorityLabel}</span>
          ${item.answered ? '<span class="tag answered">Answered</span>' : ""}
          <span class="tag">${item.alertEnabled ? `Alert: ${escapeHtml(item.alertTime || "Not set")}` : "Alert off"}</span>
        </div>
        <small>Next reminder: ${escapeHtml(formatDateTime(item.nextAlertAt))}</small>
        <div class="card-actions">
          <button type="button" class="secondary" data-action="toggle" data-id="${item.id}">
            ${item.answered ? "Mark Active" : "Mark Answered"}
          </button>
          <button type="button" class="warn" data-action="delete" data-id="${item.id}">Delete</button>
        </div>
      `;

      dom.prayerGrid.appendChild(card);
    });
}

/**
 * Master render function. Re-runs every render sub-function from state.
 * Called after every state mutation.
 */
function render() {
  renderLists();
  renderPrayerPanelHeader();
  renderPrayers();
  updateNotificationButton();
  setFormsEnabled(true);
}

/**
 * Fetches the current user's full profile from GET /api/auth/me and applies
 * it to local state. Called once on init to get authoritative server data.
 */
async function hydrateFromServer() {
  const payload = await apiRequest("/auth/me");
  applyUserData(payload.user);
}

/** Clears the session and redirects to the login page. */
function logout() {
  clearSession();
  redirectToLogin();
}

// ---------------------------------------------------------------------------
// Form submit handlers
// ---------------------------------------------------------------------------

/**
 * Handles the "Create List" form submission.
 * After creating the list, auto-selects it in the sidebar.
 *
 * @param {SubmitEvent} event
 */
async function createList(event) {
  event.preventDefault();

  const name = dom.listName.value.trim();
  const description = dom.listDescription.value.trim();

  if (!name) {
    return;
  }

  try {
    const payload = await apiRequest("/users/lists", {
      method: "POST",
      body: { name, description },
    });

    const latestList = payload.user?.prayerLists?.[payload.user.prayerLists.length - 1];
    applyUserData(payload.user);

    if (latestList?._id) {
      state.selectedListId = String(latestList._id);
      saveState();
    }

    dom.listForm.reset();
    render();
  } catch (error) {
    showToast(error.message || "Could not create list.");
  }
}

/**
 * Handles the "Add Prayer Request" form submission.
 * Falls back to the Uncategorized list when nothing is selected so the user
 * can always add a prayer even before creating a custom list.
 *
 * @param {SubmitEvent} event
 */
async function createPrayer(event) {
  event.preventDefault();

  const selectedList = getSelectedList();
  const uncategorizedList =
    state.lists.find((list) => list.systemKey === "uncategorized") ||
    state.lists.find((list) => list.isSystem);
  const targetList = selectedList || uncategorizedList;

  if (!targetList) {
    showToast("Could not find your Uncategorized list. Please log out and log in again.");
    return;
  }

  const title = dom.prayerTitle.value.trim();
  const notes = dom.prayerNotes.value.trim();
  const priority = dom.priority.value;
  const alertEnabled = dom.alertEnabled.checked;
  const alertTime = dom.alertTime.value;

  if (!title) {
    return;
  }

  if (alertEnabled && !alertTime) {
    showToast("Choose a daily alert time or disable alerts for this request.");
    return;
  }

  try {
    const payload = await apiRequest(`/users/lists/${encodeURIComponent(targetList.id)}/prayers`, {
      method: "POST",
      body: {
        title,
        notes,
        priority,
        alertEnabled,
        alertTime: alertEnabled ? alertTime : null,
      },
    });

    applyUserData(payload.user);
    state.selectedListId = targetList.id;
    saveState();

    dom.prayerForm.reset();
    dom.alertEnabled.checked = true;
    render();

    if (alertEnabled && "Notification" in window && Notification.permission === "default") {
      showToast("Tip: enable notifications to receive browser alerts.");
    }
  } catch (error) {
    showToast(error.message || "Could not create prayer request.");
  }
}

/**
 * Event delegation handler for buttons inside the prayer grid.
 * Reads data-action ("toggle" | "delete") and data-id from the clicked button.
 *
 *   toggle - Flips the answered state of the prayer request.
 *   delete - Permanently removes the prayer request.
 *
 * @param {MouseEvent} event
 */
async function handlePrayerGridClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const prayerId = button.getAttribute("data-id");
  const action = button.getAttribute("data-action");
  const prayer = state.prayers.find((item) => item.id === prayerId);

  if (!prayer) {
    return;
  }

  try {
    if (action === "toggle") {
      const payload = await apiRequest(
        `/users/lists/${encodeURIComponent(prayer.listId)}/prayers/${encodeURIComponent(prayer.id)}`,
        {
          method: "PATCH",
          body: { answered: !prayer.answered },
        }
      );
      applyUserData(payload.user);
    }

    if (action === "delete") {
      const payload = await apiRequest(
        `/users/lists/${encodeURIComponent(prayer.listId)}/prayers/${encodeURIComponent(prayer.id)}`,
        {
          method: "DELETE",
        }
      );
      applyUserData(payload.user);
    }

    render();
  } catch (error) {
    showToast(error.message || "Could not update prayer request.");
  }
}

// ---------------------------------------------------------------------------
// Browser notification system
// ---------------------------------------------------------------------------

/**
 * Updates the Enable Notifications button text/state based on the current
 * Notification.permission value. Called inside render().
 */
function updateNotificationButton() {
  if (!("Notification" in window)) {
    dom.enableNotificationsBtn.disabled = true;
    dom.enableNotificationsBtn.textContent = "Notifications not supported";
    return;
  }

  if (Notification.permission === "granted") {
    dom.enableNotificationsBtn.disabled = true;
    dom.enableNotificationsBtn.textContent = "Notifications enabled";
    return;
  }

  dom.enableNotificationsBtn.disabled = false;
  dom.enableNotificationsBtn.textContent = "Enable Notifications";
}

/**
 * Requests browser notification permission from the user.
 * Shows a toast regardless of the outcome so the user knows what happened.
 */
async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    showToast("Browser notifications are not supported here.");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    showToast("Browser alerts are enabled.");
  } else {
    showToast("Notifications were not enabled. You can continue with in-app alerts.");
  }

  updateNotificationButton();
}

/**
 * Fires an in-app toast AND a browser notification (if permission granted)
 * for a prayer request whose alert time has passed.
 *
 * @param {object} prayer - A prayer object from state.prayers.
 */
function triggerPrayerAlert(prayer) {
  const list = state.lists.find((item) => item.id === prayer.listId);
  const listName = list ? list.name : "Prayer list";
  const message = `Prayer reminder: ${prayer.title} (${listName})`;

  showToast(message);

  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("FaithRequest Reminder", {
      body: `${prayer.title} from ${listName}`,
      tag: `prayer-${prayer.id}`,
    });
  }
}

/**
 * Checks all prayers with alertEnabled=true to see if their nextAlertAt
 * timestamp has passed. Fires alerts and reschedules to the next day.
 * Called on an ALERT_POLL_INTERVAL_MS interval by init().
 */
function processAlerts() {
  const now = Date.now();

  state.prayers.forEach((prayer) => {
    if (!prayer.alertEnabled || prayer.answered || !prayer.nextAlertAt) {
      return;
    }

    if (prayer.nextAlertAt <= now) {
      triggerPrayerAlert(prayer);
      prayer.nextAlertAt = computeNextAlertAt(prayer.alertTime, new Date(now + 60 * 1000));
    }
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Bootstraps the dashboard:
 *   1. Loads cached session from localStorage.
 *   2. Redirects to login if not authenticated.
 *   3. Attaches all event listeners.
 *   4. Fetches the latest user data from the server (hydrateFromServer).
 *   5. Renders the initial UI.
 *   6. Starts the alert polling interval.
 */
async function init() {
  loadState();

  if (!isAuthenticated()) {
    redirectToLogin();
    return;
  }

  dom.listForm.addEventListener("submit", createList);
  dom.prayerForm.addEventListener("submit", createPrayer);
  dom.enableNotificationsBtn.addEventListener("click", requestNotificationPermission);
  dom.prayerGrid.addEventListener("click", handlePrayerGridClick);
  dom.logoutBtn.addEventListener("click", logout);

  try {
    await hydrateFromServer();
  } catch (error) {
    showToast(error.message || "Could not load your account.");
    return;
  }

  setInterval(processAlerts, ALERT_POLL_INTERVAL_MS);
  processAlerts();
  render();
}

init();
