/**
 * routes/authRoutes.js
 * ---------------------
 * Authentication endpoints for FaithRequest.
 *
 * All routes are mounted at /api/auth in server.js:
 *   POST /api/auth/register  - Create a new account.
 *   POST /api/auth/login     - Authenticate and receive a JWT.
 *   GET  /api/auth/me        - Validate a token and return current user data.
 *
 * JWTs expire after 7 days. The frontend stores the token in localStorage
 * (see auth.js / app.js) and sends it as "Authorization: Bearer <token>" on
 * every authenticated request.
 *
 * Passwords are hashed with bcryptjs at cost factor 12 before storage.
 * Response objects are always built by hand (never spread from the raw user
 * record), so passwordHash is never returned to the client.
 */
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const authMiddleware = require("../middleware/auth");
const { buildUncategorizedList, ensureUncategorizedList } = require("../utils/uncategorizedList");

const router = express.Router();

/** Max character lengths — mirror the frontend form maxlength attributes. */
const NAME_MAX = 80;
const EMAIL_MAX = 254;

/**
 * Signs and returns a JWT containing the user's ID and email.
 * Token expiry is 7 days; the frontend will redirect to login on 401.
 *
 * @param {object} user - A user record from models/User.js.
 * @returns {string} Signed JWT string.
 */
function signToken(user) {
  return jwt.sign(
    {
      userId: user._id,
      email: user.email,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
    }
  );
}

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------
/**
 * Creates a new user account.
 *
 * Request body: { name, email, password }
 * Success (201): { token, user: { _id, name, email, prayerLists } }
 *
 * A new account is seeded with one system list (Uncategorized) so the user
 * can add prayer requests immediately without creating a list first.
 */
router.post("/register", async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    // Basic presence validation — the frontend also validates, but we must
    // validate on the server too since the API is publicly reachable.
    if (!name || !email || !password) {
      return res.status(400).json({ message: "name, email and password are required" });
    }

    if (name.length > NAME_MAX) {
      return res.status(400).json({ message: `Name must be ${NAME_MAX} characters or fewer` });
    }

    if (email.length > EMAIL_MAX) {
      return res.status(400).json({ message: "Invalid email address" });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: "password must be at least 8 characters" });
    }

    // Return 409 if the email is already registered rather than leaking a DB
    // error to the client. This is a best-effort early check; createUser's
    // transactional email-lock item is the authoritative guard against a
    // concurrent duplicate registration.
    const existing = await User.findByEmail(email);
    if (existing) {
      return res.status(409).json({ message: "A user with this email already exists" });
    }

    // Hash password at cost 12 (~300 ms on commodity hardware) before saving.
    const passwordHash = await bcrypt.hash(password, 12);

    let user;
    try {
      user = await User.createUser({
        name,
        email,
        passwordHash,
        prayerLists: [buildUncategorizedList()],
      });
    } catch (error) {
      if (error.code === "DUPLICATE_EMAIL") {
        return res.status(409).json({ message: "A user with this email already exists" });
      }
      throw error;
    }

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

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
/**
 * Authenticates an existing user with email and password.
 *
 * Request body: { email, password }
 * Success (200): { token, user: { _id, name, email, prayerLists } }
 *
 * Returns the same 401 message for both "user not found" and "wrong password"
 * to avoid revealing which emails are registered (user enumeration).
 */
router.post("/login", async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required" });
    }

    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Repair missing Uncategorized list for accounts created before the
    // system-list feature was introduced.
    const { changed } = ensureUncategorizedList(user);
    if (changed) {
      await User.updateUser(user._id, { prayerLists: user.prayerLists });
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

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
/**
 * Returns the current user's full profile using the Bearer token.
 * Used by the frontend on page load to verify the session is still valid and
 * to hydrate the local state with the latest server data.
 *
 * Success (200): { user: { _id, name, email, prayerLists } }
 */
router.get("/me", authMiddleware, async (req, res, next) => {
  try {
    const user = await User.findById(req.auth.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Self-healing: ensure Uncategorized list exists even for older accounts.
    const { changed } = ensureUncategorizedList(user);
    if (changed) {
      await User.updateUser(user._id, { prayerLists: user.prayerLists });
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

