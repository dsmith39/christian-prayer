const mongoose = require("mongoose");

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
    alertTime: {
      type: String,
      default: null,
    },
  },
  { _id: true, timestamps: true }
);

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
    isSystem: {
      type: Boolean,
      default: false,
    },
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
      unique: true,
      index: true,
    },
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
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model("User", UserSchema);
