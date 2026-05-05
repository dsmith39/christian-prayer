const STORAGE_KEY = "prayer-keep-auth-v1";
const API_BASE_URL =
  window.APP_CONFIG?.API_BASE_URL ||
  `${window.location.protocol}//${window.location.hostname}:5000/api`;

const ALERT_POLL_INTERVAL_MS = 30_000;
const LIST_DELETE_UNDO_MS = 5_000;
const TOAST_DURATION_MS = 4_500;

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
    localStorage.removeItem(STORAGE_KEY);
  }
}

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

function clearSession() {
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

function redirectToLogin() {
  window.location.href = "login.html";
}

function isAuthenticated() {
  return Boolean(state.auth.token && state.auth.user?._id);
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function computeNextAlertAt(timeValue, fromDate = new Date()) {
  if (!timeValue || !/^\d{2}:\d{2}$/.test(timeValue)) {
    return null;
  }

  const [hour, minute] = timeValue.split(":").map(Number);
  const next = new Date(fromDate);
  next.setHours(hour, minute, 0, 0);

  if (next.getTime() <= fromDate.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next.getTime();
}

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
      clearSession();
      redirectToLogin();
      throw new Error("Your session expired. Please log in again.");
    }

    throw new Error(payload.message || `Request failed with status ${response.status}`);
  }

  return payload;
}

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

function getSelectedList() {
  return (
    state.lists.find(
      (list) => list.id === state.selectedListId && !state.pendingListDeletes[list.id]
    ) || null
  );
}

function getListPrayerCount(listId) {
  return state.prayers.filter((prayer) => prayer.listId === listId && !prayer.answered).length;
}

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

function firstVisibleListId() {
  const list = state.lists.find((item) => !state.pendingListDeletes[item.id]);
  return list ? list.id : null;
}

function formatDeleteCountdownMessage(listName, secondsLeft) {
  return `"${listName}" will be deleted in ${secondsLeft}s.`;
}

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

function render() {
  renderLists();
  renderPrayerPanelHeader();
  renderPrayers();
  updateNotificationButton();
  setFormsEnabled(true);
}

async function hydrateFromServer() {
  const payload = await apiRequest("/auth/me");
  applyUserData(payload.user);
}

function logout() {
  clearSession();
  redirectToLogin();
}

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

function triggerPrayerAlert(prayer) {
  const list = state.lists.find((item) => item.id === prayer.listId);
  const listName = list ? list.name : "Prayer list";
  const message = `Prayer reminder: ${prayer.title} (${listName})`;

  showToast(message);

  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("Prayer Keep Reminder", {
      body: `${prayer.title} from ${listName}`,
      tag: `prayer-${prayer.id}`,
    });
  }
}

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
