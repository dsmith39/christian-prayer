/**
 * routes/userRoutes.js
 * ---------------------
 * Authenticated endpoints for managing a user's prayer lists and prayer
 * requests. All routes are mounted at /api/users in server.js and require
 * a valid Bearer JWT (enforced by authMiddleware before this router runs).
 *
 * Route summary:
 *   GET    /api/users/me                                 - Fetch full user profile.
 *   POST   /api/users/lists                              - Create a prayer list.
 *   PATCH  /api/users/lists/:listId                      - Rename / update a list.
 *   DELETE /api/users/lists/:listId                      - Delete a list (and all its prayers).
 *   POST   /api/users/lists/:listId/prayers              - Add a prayer to a specific list.
 *   POST   /api/users/prayers                            - Add a prayer to Uncategorized.
 *   PATCH  /api/users/lists/:listId/prayers/:prayerId    - Update a prayer request.
 *   DELETE /api/users/lists/:listId/prayers/:prayerId    - Delete a prayer request.
 *
 * Every successful response returns { user: <full User document> } so the
 * frontend can replace its entire local state with the authoritative server
 * copy in a single round-trip, avoiding stale-data bugs.
 */
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const User = require("../models/User");
const {
  ensureUncategorizedList,
  findUncategorizedList,
  isUncategorizedList,
} = require("../utils/uncategorizedList");

const router = express.Router();

// ---------------------------------------------------------------------------
// Shared field length limits — mirror the Mongoose schema and frontend forms.
// ---------------------------------------------------------------------------
const PRAYER_TITLE_MAX = 80;
const PRAYER_NOTES_MAX = 240;
const LIST_NAME_MAX = 40;
const LIST_DESCRIPTION_MAX = 90;
/** Valid "HH:MM" alert time format. */
const ALERT_TIME_PATTERN = /^\d{2}:\d{2}$/;

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Shapes the user record into the standard API response object.
 * Only the fields the frontend needs are exposed.
 *
 * @param {object} user - A user record from models/User.js.
 * @returns {object}
 */
function userResponse(user) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    prayerLists: user.prayerLists,
  };
}

/**
 * Loads the user by ID and guarantees the Uncategorized system list exists.
 * Saves automatically if the list had to be created or repaired.
 * Returns null when no matching user document is found.
 *
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
async function findUserWithUncategorized(userId) {
  const user = await User.findById(userId);
  if (!user) {
    return null;
  }

  const { changed } = ensureUncategorizedList(user);
  if (changed) {
    await User.updateUser(userId, { prayerLists: user.prayerLists });
  }

  return user;
}

/**
 * Finds a prayer list by _id within a user's prayerLists array.
 * Replaces the Mongoose subdocument `.id()` helper now that prayerLists is a
 * plain array.
 *
 * @param {object} user
 * @param {string} listId
 * @returns {object|undefined}
 */
function findList(user, listId) {
  return user.prayerLists.find((list) => list._id === listId);
}

/**
 * Finds a prayer by _id within a list's prayers array.
 *
 * @param {object} list
 * @param {string} prayerId
 * @returns {object|undefined}
 */
function findPrayer(list, prayerId) {
  return list.prayers.find((prayer) => prayer._id === prayerId);
}

/**
 * Extracts and sanitizes the prayer request fields from req.body.
 * Unknown priority values fall back to "normal".
 * alertTime is set to null whenever alertEnabled is false or the value
 * doesn't match "HH:MM", preventing bad data from reaching the database.
 *
 * @param {import('express').Request} req
 * @returns {{ title, notes, priority, alertEnabled, alertTime }}
 */
function parsePrayerPayload(req) {
  const title = String(req.body.title || "").trim();
  const notes = String(req.body.notes || "").trim();
  const priority = ["gentle", "normal", "urgent"].includes(req.body.priority)
    ? req.body.priority
    : "normal";
  const alertEnabled = Boolean(req.body.alertEnabled);
  const rawAlertTime = String(req.body.alertTime || "").trim();
  // Only persist alertTime when alerts are on AND the format is valid.
  const alertTime = alertEnabled && ALERT_TIME_PATTERN.test(rawAlertTime) ? rawAlertTime : null;

  return {
    title,
    notes,
    priority,
    alertEnabled,
    alertTime,
  };
}



// ---------------------------------------------------------------------------
// GET /api/users/me
// ---------------------------------------------------------------------------
/**
 * Returns the authenticated user's full profile including all prayer lists
 * and requests. The frontend calls this on dashboard load to hydrate state.
 */
router.get("/me", async (req, res, next) => {
  try {
    const user = await findUserWithUncategorized(req.auth.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({ user: userResponse(user) });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/users/lists
// ---------------------------------------------------------------------------
/**
 * Creates a new prayer list for the authenticated user.
 * Returns the full updated user document so the frontend can re-render.
 */
router.post("/lists", async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const description = String(req.body.description || "").trim();

    if (!name) {
      return res.status(400).json({ message: "List name is required" });
    }

    if (name.length > LIST_NAME_MAX) {
      return res.status(400).json({ message: `List name must be ${LIST_NAME_MAX} characters or fewer` });
    }

    if (description.length > LIST_DESCRIPTION_MAX) {
      return res.status(400).json({ message: `List description must be ${LIST_DESCRIPTION_MAX} characters or fewer` });
    }

    const user = await findUserWithUncategorized(req.auth.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.prayerLists.push({ _id: uuidv4(), name, description, prayers: [] });
    await User.updateUser(user._id, { prayerLists: user.prayerLists });

    return res.status(201).json({ user: userResponse(user) });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/users/lists/:listId
// ---------------------------------------------------------------------------
/**
 * Updates the name and/or description of an existing prayer list.
 * System lists (Uncategorized) cannot be renamed — returns 403.
 *
 * Partial update: sending only `name` leaves `description` unchanged, and
 * vice versa. To clear a description, send description: "".
 */
router.patch("/lists/:listId", async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    // description is allowed to be cleared to "" but not overwritten when absent
    const hasDescription = req.body.description !== undefined;
    const description = hasDescription ? String(req.body.description).trim() : null;

    if (name && name.length > LIST_NAME_MAX) {
      return res.status(400).json({ message: `List name must be ${LIST_NAME_MAX} characters or fewer` });
    }

    if (hasDescription && description.length > LIST_DESCRIPTION_MAX) {
      return res.status(400).json({ message: `List description must be ${LIST_DESCRIPTION_MAX} characters or fewer` });
    }

    const user = await findUserWithUncategorized(req.auth.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const list = findList(user, req.params.listId);
    if (!list) {
      return res.status(404).json({ message: "Prayer list not found" });
    }

    if (isUncategorizedList(list)) {
      return res.status(403).json({ message: "Cannot rename system list" });
    }

    if (name) {
      list.name = name;
    }

    if (hasDescription) {
      list.description = description;
    }

    await User.updateUser(user._id, { prayerLists: user.prayerLists });

    return res.status(200).json({ user: userResponse(user) });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/users/lists/:listId
// ---------------------------------------------------------------------------
/**
 * Permanently deletes a prayer list and all of its prayer requests.
 * The Uncategorized system list cannot be deleted — returns 403.
 * The frontend shows a 5-second undo toast before calling this endpoint.
 */
router.delete("/lists/:listId", async (req, res, next) => {
  try {
    const user = await findUserWithUncategorized(req.auth.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const list = findList(user, req.params.listId);
    if (!list) {
      return res.status(404).json({ message: "Prayer list not found" });
    }

    if (isUncategorizedList(list)) {
      return res.status(403).json({ message: "Uncategorized list cannot be deleted" });
    }

    user.prayerLists = user.prayerLists.filter((item) => item._id !== list._id);
    await User.updateUser(user._id, { prayerLists: user.prayerLists });

    return res.status(200).json({ user: userResponse(user) });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/users/lists/:listId/prayers
// ---------------------------------------------------------------------------
/**
 * Adds a new prayer request to the specified list.
 * The frontend uses this when the user has a list selected in the sidebar.
 */
router.post("/lists/:listId/prayers", async (req, res, next) => {
  try {
    const { title, notes, priority, alertEnabled, alertTime } = parsePrayerPayload(req);

    if (!title) {
      return res.status(400).json({ message: "Prayer title is required" });
    }

    if (title.length > PRAYER_TITLE_MAX) {
      return res.status(400).json({ message: `Prayer title must be ${PRAYER_TITLE_MAX} characters or fewer` });
    }

    if (notes.length > PRAYER_NOTES_MAX) {
      return res.status(400).json({ message: `Prayer notes must be ${PRAYER_NOTES_MAX} characters or fewer` });
    }

    const user = await findUserWithUncategorized(req.auth.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const list = findList(user, req.params.listId);
    if (!list) {
      return res.status(404).json({ message: "Prayer list not found" });
    }

    list.prayers.push({
      _id: uuidv4(),
      title,
      notes,
      priority,
      answered: false,
      alertEnabled,
      alertTime,
    });

    await User.updateUser(user._id, { prayerLists: user.prayerLists });
    return res.status(201).json({ user: userResponse(user) });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/users/prayers
// ---------------------------------------------------------------------------
/**
 * Shortcut route: adds a prayer request directly to the Uncategorized list.
 * Used when no specific list is selected on the dashboard.
 */
router.post("/prayers", async (req, res, next) => {
  try {
    const { title, notes, priority, alertEnabled, alertTime } = parsePrayerPayload(req);

    if (!title) {
      return res.status(400).json({ message: "Prayer title is required" });
    }

    if (title.length > PRAYER_TITLE_MAX) {
      return res.status(400).json({ message: `Prayer title must be ${PRAYER_TITLE_MAX} characters or fewer` });
    }

    if (notes.length > PRAYER_NOTES_MAX) {
      return res.status(400).json({ message: `Prayer notes must be ${PRAYER_NOTES_MAX} characters or fewer` });
    }

    const user = await findUserWithUncategorized(req.auth.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const uncategorizedList = findUncategorizedList(user);
    if (!uncategorizedList) {
      return res.status(500).json({ message: "Could not load Uncategorized list" });
    }

    uncategorizedList.prayers.push({
      _id: uuidv4(),
      title,
      notes,
      priority,
      answered: false,
      alertEnabled,
      alertTime,
    });

    await User.updateUser(user._id, { prayerLists: user.prayerLists });
    return res.status(201).json({ user: userResponse(user) });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/users/lists/:listId/prayers/:prayerId
// ---------------------------------------------------------------------------
/**
 * Partially updates a prayer request. Only fields present in the request
 * body are applied; omitted fields are left unchanged.
 *
 * Supports updating: title, notes, priority, answered, alertEnabled, alertTime.
 * The frontend uses this for "Mark Answered", "Mark Active", and future edit
 * flows.
 */
router.patch("/lists/:listId/prayers/:prayerId", async (req, res, next) => {
  try {
    const user = await findUserWithUncategorized(req.auth.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const list = findList(user, req.params.listId);
    if (!list) {
      return res.status(404).json({ message: "Prayer list not found" });
    }

    const prayer = findPrayer(list, req.params.prayerId);
    if (!prayer) {
      return res.status(404).json({ message: "Prayer request not found" });
    }

    if (req.body.title !== undefined) {
      const title = String(req.body.title || "").trim();
      if (!title) {
        return res.status(400).json({ message: "Prayer title cannot be empty" });
      }
      if (title.length > PRAYER_TITLE_MAX) {
        return res.status(400).json({ message: `Prayer title must be ${PRAYER_TITLE_MAX} characters or fewer` });
      }
      prayer.title = title;
    }

    if (req.body.notes !== undefined) {
      const notes = String(req.body.notes || "").trim();
      if (notes.length > PRAYER_NOTES_MAX) {
        return res.status(400).json({ message: `Prayer notes must be ${PRAYER_NOTES_MAX} characters or fewer` });
      }
      prayer.notes = notes;
    }

    if (["gentle", "normal", "urgent"].includes(req.body.priority)) {
      prayer.priority = req.body.priority;
    }

    if (typeof req.body.answered === "boolean") {
      prayer.answered = req.body.answered;
    }

    if (typeof req.body.alertEnabled === "boolean") {
      prayer.alertEnabled = req.body.alertEnabled;
      const rawAlertTime = String(req.body.alertTime || "").trim();
      prayer.alertTime = req.body.alertEnabled && ALERT_TIME_PATTERN.test(rawAlertTime) ? rawAlertTime : null;
    }

    await User.updateUser(user._id, { prayerLists: user.prayerLists });
    return res.status(200).json({ user: userResponse(user) });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/users/lists/:listId/prayers/:prayerId
// ---------------------------------------------------------------------------
/**
 * Permanently deletes a single prayer request from a list.
 * The frontend confirms with the user before calling this endpoint.
 */
router.delete("/lists/:listId/prayers/:prayerId", async (req, res, next) => {
  try {
    const user = await findUserWithUncategorized(req.auth.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const list = findList(user, req.params.listId);
    if (!list) {
      return res.status(404).json({ message: "Prayer list not found" });
    }

    const prayer = findPrayer(list, req.params.prayerId);
    if (!prayer) {
      return res.status(404).json({ message: "Prayer request not found" });
    }

    list.prayers = list.prayers.filter((item) => item._id !== prayer._id);
    await User.updateUser(user._id, { prayerLists: user.prayerLists });

    return res.status(200).json({ user: userResponse(user) });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/users/me
// ---------------------------------------------------------------------------
/**
 * Permanently deletes the authenticated user's account and all their data.
 */
router.delete("/me", async (req, res, next) => {
  try {
    const deleted = await User.deleteUser(req.auth.userId);
    if (!deleted) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({ message: "Account deleted" });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
