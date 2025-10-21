import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.development
dotenv.config({ path: path.resolve(__dirname, ".env.development") });

import User from "./src/models/User.js";
import Coach from "./src/models/Coach.js";

async function fixNicoleLink() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB connected\n");

    // Find Nicole as a coach
    const nicole = await Coach.findOne({
      firstName: "Nicole",
      lastName: "Kreienborg"
    });

    if (!nicole) {
      console.log("❌ Coach Nicole Kreienborg not found");
      process.exit(1);
    }

    console.log(`🎾 Found Coach: ${nicole.firstName} ${nicole.lastName} (_id: ${nicole._id})\n`);

    // Find Nicole's user account
    const nicoleUser = await User.findOne({
      firstName: "Nicole",
      lastName: "Kreienborg"
    });

    if (!nicoleUser) {
      console.log("❌ User account for Nicole not found");
      process.exit(1);
    }

    console.log(`👤 Found User: ${nicoleUser.email} (_id: ${nicoleUser._id})`);
    console.log(`   Current coachId: ${nicoleUser.coachId || "NOT SET"}\n`);

    // Update the link
    console.log(`🔧 Setting User.coachId = ${nicole._id}...`);

    const result = await User.updateOne(
      { _id: nicoleUser._id },
      { $set: { coachId: nicole._id } }
    );

    if (result.modifiedCount > 0) {
      console.log("✅ SUCCESS! Link updated.\n");

      // Verify
      const updated = await User.findById(nicoleUser._id);
      console.log("📋 Verification:");
      console.log(`   User: ${updated.firstName} ${updated.lastName}`);
      console.log(`   coachId: ${updated.coachId}`);
      console.log(`   Matches Coach._id: ${String(updated.coachId) === String(nicole._id) ? "✅ YES" : "❌ NO"}`);
    } else {
      console.log("⚠️  No changes made (already linked?)");
    }

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

fixNicoleLink();
