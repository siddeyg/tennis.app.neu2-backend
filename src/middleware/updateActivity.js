import User from "../models/User.js";

/**
 * Middleware to update user's lastActivity timestamp
 * Updates every 5 minutes to avoid excessive database writes
 */
const updateActivity = async (req, res, next) => {
  try {
    // Only update if user is authenticated
    if (req.user && req.user._id) {
      const now = new Date();
      const user = await User.findById(req.user._id);

      if (user) {
        // Only update if lastActivity is older than 5 minutes (300000ms)
        // This prevents excessive database writes
        const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

        if (!user.lastActivity || user.lastActivity < fiveMinutesAgo) {
          // Use updateOne to avoid triggering pre-save hooks
          await User.updateOne(
            { _id: user._id },
            { $set: { lastActivity: now } }
          );
        }
      }
    }
  } catch (error) {
    // Don't break the request if activity update fails
    console.error("Error updating user activity:", error);
  }

  next();
};

export default updateActivity;
