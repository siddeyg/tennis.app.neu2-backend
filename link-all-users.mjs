import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.development by default (can be overridden with --production flag)
const isProduction = process.argv.includes('--production');
const envFile = isProduction ? '.env.production' : '.env.development';
dotenv.config({ path: path.resolve(__dirname, envFile) });

console.log(`\n🔧 Environment: ${isProduction ? 'PRODUCTION (Server)' : 'DEVELOPMENT (Local)'}`);
console.log(`📁 Using: ${envFile}\n`);

import User from "./src/models/User.js";
import Coach from "./src/models/Coach.js";
import Student from "./src/models/Student.js";

async function linkAllUsers() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB connected\n");

    // Find all users
    const allUsers = await User.find();
    console.log(`📊 Total users in database: ${allUsers.length}\n`);

    // Find users without links
    const unlinkedUsers = allUsers.filter(user => !user.coachId && !user.studentId);
    console.log(`🔍 Users without links: ${unlinkedUsers.length}\n`);

    if (unlinkedUsers.length === 0) {
      console.log("✅ All users are already linked! Nothing to do.\n");
      process.exit(0);
    }

    console.log("═══════════════════════════════════════════════════════════\n");

    let linkedToCoach = 0;
    let linkedToStudent = 0;
    let notFound = 0;

    for (const user of unlinkedUsers) {
      console.log(`👤 Processing: ${user.firstName} ${user.lastName} (${user.email})`);

      // Try to find matching coach first
      const matchingCoach = await Coach.findOne({
        firstName: user.firstName,
        lastName: user.lastName
      });

      if (matchingCoach) {
        // Link to coach
        await User.updateOne(
          { _id: user._id },
          { $set: { coachId: matchingCoach._id } }
        );
        console.log(`   ✅ Linked to COACH: ${matchingCoach.firstName} ${matchingCoach.lastName} (${matchingCoach._id})\n`);
        linkedToCoach++;
        continue;
      }

      // If no coach found, try to find matching student
      const matchingStudent = await Student.findOne({
        firstName: user.firstName,
        lastName: user.lastName
      });

      if (matchingStudent) {
        // Link to student
        await User.updateOne(
          { _id: user._id },
          { $set: { studentId: matchingStudent._id } }
        );
        console.log(`   ✅ Linked to STUDENT: ${matchingStudent.firstName} ${matchingStudent.lastName} (${matchingStudent._id})\n`);
        linkedToStudent++;
        continue;
      }

      // No match found
      console.log(`   ⚠️  No matching coach or student found\n`);
      notFound++;
    }

    console.log("═══════════════════════════════════════════════════════════\n");
    console.log("📋 SUMMARY:");
    console.log(`   Total users processed: ${unlinkedUsers.length}`);
    console.log(`   ✅ Linked to coaches: ${linkedToCoach}`);
    console.log(`   ✅ Linked to students: ${linkedToStudent}`);
    console.log(`   ⚠️  Not found: ${notFound}`);
    console.log("\n");

    // Show verification
    if (linkedToCoach > 0 || linkedToStudent > 0) {
      console.log("═══════════════════════════════════════════════════════════\n");
      console.log("🔍 VERIFICATION - Linked Users:\n");

      const linkedUsers = await User.find({
        $or: [
          { coachId: { $ne: null } },
          { studentId: { $ne: null } }
        ]
      });

      for (const user of linkedUsers) {
        console.log(`   👤 ${user.firstName} ${user.lastName} (${user.email})`);
        if (user.coachId) {
          const coach = await Coach.findById(user.coachId);
          console.log(`      🎾 Coach: ${coach ? coach.firstName + ' ' + coach.lastName : 'NOT FOUND'}`);
        }
        if (user.studentId) {
          const student = await Student.findById(user.studentId);
          console.log(`      🎓 Student: ${student ? student.firstName + ' ' + student.lastName : 'NOT FOUND'}`);
        }
        console.log("");
      }
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

linkAllUsers();
