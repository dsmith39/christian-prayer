const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const authMiddleware = require("../middleware/auth");
const { buildUncategorizedList, ensureUncategorizedList } = require("../utils/uncategorizedList");

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    {
      userId: String(user._id),
      email: user.email,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
    }
  );
}

router.post("/register", async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!name || !email || !password) {
      return res.status(400).json({ message: "name, email and password are required" });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: "password must be at least 8 characters" });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: "A user with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      name,
      email,
      passwordHash,
      prayerLists: [buildUncategorizedList()],
    });

    const token = signToken(user);

    return res.status(201).json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        prayerLists: user.prayerLists,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required" });
    }

    const user = await User.findOne({ email }).select("+passwordHash");
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const { changed } = ensureUncategorizedList(user);
    if (changed) {
      await user.save();
    }

    const token = signToken(user);

    return res.status(200).json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        prayerLists: user.prayerLists,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/me", authMiddleware, async (req, res, next) => {
  try {
    const user = await User.findById(req.auth.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const { changed } = ensureUncategorizedList(user);
    if (changed) {
      await user.save();
    }

    return res.status(200).json({
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        prayerLists: user.prayerLists,
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
