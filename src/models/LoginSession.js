import mongoose from "mongoose";

/**
 * LoginSession model
 * Tracks user login history
 * Keeps last 30 logins per user (older ones automatically deleted)
 */
const loginSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true, // Index for faster queries by userId
  },
  loginTime: {
    type: Date,
    required: true,
    default: Date.now,
  },
  userAgent: {
    type: String,
    default: "",
  },
}, {
  timestamps: true, // Adds createdAt and updatedAt
});

// Compound index for efficient querying: find sessions by user, sorted by time
loginSessionSchema.index({ userId: 1, loginTime: -1 });

// Static method to create session and maintain limit of 30 per user
loginSessionSchema.statics.createSession = async function(userId, userAgent) {
  try {
    // Create new session
    const session = await this.create({
      userId,
      loginTime: new Date(),
      userAgent: userAgent || "Unknown",
    });

    // Count total sessions for this user
    const sessionCount = await this.countDocuments({ userId });

    // If more than 30, delete oldest ones
    if (sessionCount > 30) {
      const sessionsToDelete = sessionCount - 30;

      // Find oldest sessions to delete
      const oldestSessions = await this.find({ userId })
        .sort({ loginTime: 1 }) // Oldest first
        .limit(sessionsToDelete)
        .select('_id');

      const idsToDelete = oldestSessions.map(s => s._id);

      await this.deleteMany({ _id: { $in: idsToDelete } });
    }

    return session;
  } catch (error) {
    console.error("Error creating login session:", error);
    throw error;
  }
};

// Static method to get last N sessions for a user
loginSessionSchema.statics.getRecentSessions = async function(userId, limit = 30) {
  try {
    return await this.find({ userId })
      .sort({ loginTime: -1 }) // Most recent first
      .limit(limit)
      .lean(); // Return plain objects (faster)
  } catch (error) {
    console.error("Error fetching login sessions:", error);
    throw error;
  }
};

const LoginSession = mongoose.model("LoginSession", loginSessionSchema);

export default LoginSession;
