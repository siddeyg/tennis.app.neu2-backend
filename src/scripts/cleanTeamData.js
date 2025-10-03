import mongoose from "mongoose";
import Student from "../models/Student.js";
import dotenv from "dotenv";

dotenv.config();

const cleanTeamData = async () => {
  try {
    console.log("🔧 Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB");

    console.log("\n📊 Analyzing team field data...");

    // Get all students
    const students = await Student.find({});
    console.log(`Found ${students.length} students`);

    // Analyze current team values
    const teamValues = new Map();
    students.forEach(student => {
      const val = student.team;
      if (val !== null && val !== undefined) {
        const key = String(val);
        teamValues.set(key, (teamValues.get(key) || 0) + 1);
      }
    });

    console.log("\n📋 Current team field values:");
    teamValues.forEach((count, value) => {
      console.log(`  "${value}": ${count} students`);
    });

    // Clean the data
    console.log("\n🧹 Cleaning team data...");
    let updatedCount = 0;

    for (const student of students) {
      let newTeamValue = false;

      // Convert string values to boolean
      if (student.team) {
        const teamStr = String(student.team).toLowerCase().trim();
        // Consider "yes", "ja", "true", "1" as true
        if (["yes", "ja", "true", "1"].includes(teamStr)) {
          newTeamValue = true;
        } else {
          newTeamValue = false;
        }
      } else {
        newTeamValue = false;
      }

      // Update if value changed
      if (student.team !== newTeamValue) {
        await Student.findByIdAndUpdate(student._id, { team: newTeamValue });
        updatedCount++;
      }
    }

    console.log(`✅ Updated ${updatedCount} students`);

    // Verify the results
    console.log("\n✔️ Verification:");
    const verifyStudents = await Student.find({});
    const teamTrue = verifyStudents.filter(s => s.team === true).length;
    const teamFalse = verifyStudents.filter(s => s.team === false).length;
    const teamNull = verifyStudents.filter(s => s.team === null || s.team === undefined).length;

    console.log(`  Team = true: ${teamTrue} students`);
    console.log(`  Team = false: ${teamFalse} students`);
    console.log(`  Team = null/undefined: ${teamNull} students`);

    console.log("\n🎉 Migration complete!");

  } catch (error) {
    console.error("❌ Error during migration:", error);
  } finally {
    await mongoose.connection.close();
    console.log("\n🔌 Disconnected from MongoDB");
    process.exit(0);
  }
};

cleanTeamData();
