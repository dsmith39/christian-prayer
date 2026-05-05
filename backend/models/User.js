/**
 * models/User.js
 * ---------------
 * Mongoose schema definitions for the FaithRequest data model.
 *
 * Data model hierarchy (all stored inside one User document):
 *
 *   User
 *   └─ prayerLists[]   (PrayerListSchema)
 *      └─ prayers[]    (PrayerRequestSchema)
 *
 * Embedding lists and prayers directly in the User document means a single
 * MongoDB read/write covers all of a user's data — no joins needed. This
 * is a good fit for a personal app where one user's data is always accessed
 * together. See ADR-009 for the trade-off discussion.
 *
 * Field length limits mirror the maxlength constraints in the frontend forms
 * so validation is consistent at both layers.
 */
const mongoose = require("mongoose");

/**
 * A single prayer request inside a PrayerList.
 *
 * Fields:
 *   title       - Short label shown on the prayer card (max 80 chars).
 *   notes       - Optional longer description (max 240 chars).
 *   priority    - Visual urgency indicator: "gentle" | "normal" | "urgent".
 *   answered    - Flipped to true when the user marks the request answered.
 *                 Answered requests sort to the bottom of the list.
 *   alertEnabled - Whether a daily reminder should fire for this request.
 *   alertTime   - "HH:MM" (24-hour) string used by the frontend to compute
 *                 the next browser notification time. Null when alerts are off.
 */
const PrayerRequestSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 240,
      default: "",
    },
    priority: {
      type: String,
      enum: ["gentle", "normal", "urgent"],
      default: "normal",
    },
    answered: {
      type: Boolean,
      default: false,
    },
    alertEnabled: {
      type: Boolean,
      default: false,
    },
    /** "HH:MM" 24-hour time string, or null when alerts are disabled. */
    alertTime: {
      type: String,
      default: null,
    },
  },
  { _id: true, timestamps: true }
);

/**
 * A named collection of prayer requests belonging to one user.
 *
 * Fields:
 *   name        - Display name (max 40 chars).
 *   description - Optional subtitle shown under the list name (max 90 chars).
 *   isSystem    - True for built-in lists (Uncategorized) that cannot be
 *                 deleted or renamed.
 *   systemKey   - Machine-readable key for system lists (e.g. "uncategorized").
 *                 Used instead of name comparisons to be rename-safe.
 *   prayers     - Embedded array of PrayerRequestSchema documents.
 */
const PrayerListSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 90,
      default: "",
    },
    /** True for system-managed lists the user cannot delete. */
    isSystem: {
      type: Boolean,
      default: false,
    },
    /** Stable identifier for system lists (e.g. "uncategorized"). */
    systemKey: {
      type: String,
      trim: true,
      default: "",
    },
    prayers: {
      type: [PrayerRequestSchema],
      default: [],
    },
  },
  { _id: true, timestamps: true }
);

/**
 * A registered FaithRequest user account.
 *
 * Fields:
 *   name         - Display name (max 80 chars).
 *   email        - Unique login identifier, stored lowercase.
 *   passwordHash - bcrypt hash of the user's password.
 *                  select: false means it is NEVER returned in API responses
 *                  unless explicitly requested with .select("+passwordHash").
 *   prayerLists  - All of the user's prayer lists and their requests.
 *
 * versionKey: false removes the __v field from API responses.
 */
const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,   // Enforced by a MongoDB unique index.
      index: true,
    },
    /** bcrypt hash — never returned in API responses (select: false). */
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    prayerLists: {
      type: [PrayerListSchema],
      default: [],
    },
  },
  {
    timestamps: true,   // Adds createdAt and updatedAt automatically.
    versionKey: false,  // Suppresses __v in API responses.
  }
);

module.exports = mongoose.model("User", UserSchema);

