import mongoose from "mongoose";

/**
 * User model to store additional user data linked to Clerk authentication
 * The clerkUserId links this record to the authenticated Clerk user
 */
const userSchema = new mongoose.Schema({
  clerkUserId: { type: String, required: true, unique: true }, // Links to Clerk user
  email: String,
  role: {
    type: String,
    enum: ["admin", "coach", "student"],
    default: "student"
  }, // User role for authorization
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model("User", userSchema);
