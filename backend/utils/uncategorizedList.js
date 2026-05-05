/**
 * utils/uncategorizedList.js
 * ---------------------------
 * Helpers for the built-in "Uncategorized" system prayer list.
 *
 * Every user account has exactly one Uncategorized list. It is:
 *   - Created automatically on registration.
 *   - Re-created on login/me if somehow missing (data-migration safety net).
 *   - Protected from deletion and renaming through the API.
 *
 * Identification relies on the `systemKey` field (preferred) with a
 * case-insensitive name fallback for older documents created before
 * systemKey was introduced.
 */

/** Stable identifier stored on the Mongoose document. Never changes. */
const UNCATEGORIZED_SYSTEM_KEY = "uncategorized";

/** Display name shown in the UI. */
const UNCATEGORIZED_LIST_NAME = "Uncategorized";

/**
 * Returns the plain object used when inserting a new Uncategorized list
 * into a user's prayerLists array.
 *
 * @returns {object}
 */
function buildUncategorizedList() {
  return {
    name: UNCATEGORIZED_LIST_NAME,
    description: "Auto-created list for uncategorized prayer requests",
    isSystem: true,
    systemKey: UNCATEGORIZED_SYSTEM_KEY,
    prayers: [],
  };
}

/**
 * Returns true when the given list document is the Uncategorized system list.
 * Checks systemKey first; falls back to a name comparison for legacy data.
 *
 * @param {object|null} list  - A prayerLists subdocument.
 * @returns {boolean}
 */
function isUncategorizedList(list) {
  if (!list) {
    return false;
  }

  const normalizedName = String(list.name || "").trim().toLowerCase();
  return list.systemKey === UNCATEGORIZED_SYSTEM_KEY || normalizedName === "uncategorized";
}

/**
 * Finds and returns the Uncategorized list from the user's prayerLists array,
 * or null if none exists.
 *
 * @param {object} user  - A Mongoose User document.
 * @returns {object|null}
 */
function findUncategorizedList(user) {
  if (!user?.prayerLists) {
    return null;
  }

  return user.prayerLists.find((list) => isUncategorizedList(list)) || null;
}

/**
 * Guarantees the user has a correctly configured Uncategorized list.
 * Repairs missing or partially-migrated documents in-place.
 * The caller is responsible for calling user.save() when changed === true.
 *
 * @param {object} user  - A Mongoose User document (mutated in place).
 * @returns {{ list: object, changed: boolean }}
 */
function ensureUncategorizedList(user) {
  let changed = false;
  let list = findUncategorizedList(user);

  if (!list) {
    // List is completely missing — create it.
    user.prayerLists.push(buildUncategorizedList());
    list = user.prayerLists[user.prayerLists.length - 1];
    changed = true;
  }

  // Repair fields that may be wrong on legacy documents.
  if (!list.isSystem) {
    list.isSystem = true;
    changed = true;
  }

  if (list.systemKey !== UNCATEGORIZED_SYSTEM_KEY) {
    list.systemKey = UNCATEGORIZED_SYSTEM_KEY;
    changed = true;
  }

  if (!String(list.name || "").trim()) {
    list.name = UNCATEGORIZED_LIST_NAME;
    changed = true;
  }

  return { list, changed };
}

module.exports = {
  UNCATEGORIZED_SYSTEM_KEY,
  UNCATEGORIZED_LIST_NAME,
  buildUncategorizedList,
  isUncategorizedList,
  findUncategorizedList,
  ensureUncategorizedList,
};
