import mongoose from "mongoose";

/**
 * UserSettings model
 * Stores individual user preferences/settings
 * Each user has their own settings independent of other users
 */
const userSettingsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true, // One settings document per user
    index: true,
  },
  allowResetSchedule: {
    type: Boolean,
    default: true, // By default, users CAN click "Plan generieren"
  },
  allowNotifyStudents: {
    type: Boolean,
    default: true, // By default, users CAN click "Schüler benachrichtigen"
  },
  // Future user-specific settings can be added here
  // e.g., theme, notifications, defaultView, etc.
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update the updatedAt timestamp on save
userSettingsSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

const UserSettings = mongoose.model("UserSettings", userSettingsSchema);

export default UserSettings;
