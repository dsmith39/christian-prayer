const express = require("express");
const User = require("../models/User");
const {
  ensureUncategorizedList,
  findUncategorizedList,
  isUncategorizedList,
} = require("../utils/uncategorizedList");

const router = express.Router();

function userResponse(user) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    prayerLists: user.prayerLists,
  };
}

async function findUserWithUncategorized(userId) {
  const user = await User.findById(userId);
  if (!user) {
    return null;
  }

  const { changed } = ensureUncategorizedList(user);
  if (changed) {
    await user.save();
  }

  return user;
}

function parsePrayerPayload(req) {
  const title = String(req.body.title || "").trim();
  const notes = String(req.body.notes || "").trim();
  const priority = ["gentle", "normal", "urgent"].includes(req.body.priority)
    ? req.body.priority
    : "normal";
  const alertEnabled = Boolean(req.body.alertEnabled);
  const alertTime = alertEnabled ? String(req.body.alertTime || "").trim() || null : null;

  return {
    title,
    notes,
    priority,
    alertEnabled,
    alertTime,
  };
}

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

router.post("/lists", async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const description = String(req.body.description || "").trim();

    if (!name) {
      return res.status(400).json({ message: "List name is required" });
    }

    const user = await findUserWithUncategorized(req.auth.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.prayerLists.push({ name, description, prayers: [] });
    await user.save();

    return res.status(201).json({ user: userResponse(user) });
  } catch (error) {
    return next(error);
  }
});

router.delete("/lists/:listId", async (req, res, next) => {
  try {
    const user = await findUserWithUncategorized(req.auth.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const list = user.prayerLists.id(req.params.listId);
    if (!list) {
      return res.status(404).json({ message: "Prayer list not found" });
    }

    if (isUncategorizedList(list)) {
      return res.status(403).json({ message: "Uncategorized list cannot be deleted" });
    }

    list.deleteOne();
    await user.save();

    return res.status(200).json({ user: userResponse(user) });
  } catch (error) {
    return next(error);
  }
});

router.post("/lists/:listId/prayers", async (req, res, next) => {
  try {
    const { title, notes, priority, alertEnabled, alertTime } = parsePrayerPayload(req);

    if (!title) {
      return res.status(400).json({ message: "Prayer title is required" });
    }

    const user = await findUserWithUncategorized(req.auth.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const list = user.prayerLists.id(req.params.listId);
    if (!list) {
      return res.status(404).json({ message: "Prayer list not found" });
    }

    list.prayers.push({
      title,
      notes,
      priority,
      answered: false,
      alertEnabled,
      alertTime,
    });

    await user.save();
    return res.status(201).json({ user: userResponse(user) });
  } catch (error) {
    return next(error);
  }
});

router.post("/prayers", async (req, res, next) => {
  try {
    const { title, notes, priority, alertEnabled, alertTime } = parsePrayerPayload(req);

    if (!title) {
      return res.status(400).json({ message: "Prayer title is required" });
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
      title,
      notes,
      priority,
      answered: false,
      alertEnabled,
      alertTime,
    });

    await user.save();
    return res.status(201).json({ user: userResponse(user) });
  } catch (error) {
    return next(error);
  }
});

router.patch("/lists/:listId/prayers/:prayerId", async (req, res, next) => {
  try {
    const user = await findUserWithUncategorized(req.auth.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const list = user.prayerLists.id(req.params.listId);
    if (!list) {
      return res.status(404).json({ message: "Prayer list not found" });
    }

    const prayer = list.prayers.id(req.params.prayerId);
    if (!prayer) {
      return res.status(404).json({ message: "Prayer request not found" });
    }

    if (typeof req.body.answered === "boolean") {
      prayer.answered = req.body.answered;
    }

    await user.save();
    return res.status(200).json({ user: userResponse(user) });
  } catch (error) {
    return next(error);
  }
});

router.delete("/lists/:listId/prayers/:prayerId", async (req, res, next) => {
  try {
    const user = await findUserWithUncategorized(req.auth.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const list = user.prayerLists.id(req.params.listId);
    if (!list) {
      return res.status(404).json({ message: "Prayer list not found" });
    }

    const prayer = list.prayers.id(req.params.prayerId);
    if (!prayer) {
      return res.status(404).json({ message: "Prayer request not found" });
    }

    prayer.deleteOne();
    await user.save();

    return res.status(200).json({ user: userResponse(user) });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
