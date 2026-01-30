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

async function checkNicoleLink() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB connected\n");

    // Find Nicole as a coach
    const nicole = await Coach.findOne({
      firstName: "Nicole",
      lastName: "Kreienborg"
    });

    console.log("🎾 Coach Nicole Kreienborg:");
    if (!nicole) {
      console.log("❌ NOT FOUND in coaches collection");
      process.exit(0);
    }

    console.log(`   _id: ${nicole._id}`);
    console.log(`   Name: ${nicole.firstName} ${nicole.lastName}`);
    console.log(`   Email: ${nicole.email || "N/A"}\n`);

    // Find Nicole's user account
    const nicoleUser = await User.findOne({
      firstName: "Nicole",
      lastName: "Kreienborg"
    });

    console.log("👤 User account for Nicole Kreienborg:");
    if (!nicoleUser) {
      console.log("❌ NOT FOUND in users collection");
      console.log("\n⚠️  PROBLEM: Nicole has NO user account!");
      process.exit(0);
    }

    console.log(`   _id: ${nicoleUser._id}`);
    console.log(`   Email: ${nicoleUser.email}`);
    console.log(`   Role: ${nicoleUser.role}`);
    console.log(`   coachId: ${nicoleUser.coachId || "❌ NOT SET"}`);
    console.log(`   studentId: ${nicoleUser.studentId || "null"}`);
    console.log(`   isActive: ${nicoleUser.isActive}`);
    console.log(`   lastLogin: ${nicoleUser.lastLogin || "Never"}`);
    console.log(`   lastActivity: ${nicoleUser.lastActivity || "Never"}\n`);

    // Check if linked correctly
    if (!nicoleUser.coachId) {
      console.log("❌ PROBLEM: User account exists but coachId is NOT SET!");
      console.log(`\n🔧 FIX: User._id ${nicoleUser._id} needs coachId = ${nicole._id}`);
    } else if (String(nicoleUser.coachId) === String(nicole._id)) {
      console.log("✅ CORRECTLY LINKED: User.coachId matches Coach._id");
    } else {
      console.log(`❌ WRONG LINK: User.coachId (${nicoleUser.coachId}) doesn't match Coach._id (${nicole._id})`);
    }

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

checkNicoleLink();
