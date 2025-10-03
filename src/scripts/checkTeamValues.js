import mongoose from "mongoose";
import Student from "../models/Student.js";
import dotenv from "dotenv";

dotenv.config();

const checkTeamValues = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    const children = await Student.find({ adult: false }).limit(20);

    console.log("Sample children team values:");
    children.forEach(s => {
      console.log(`  ${s.firstName} ${s.lastName}: team=${s.team} (type: ${typeof s.team})`);
    });

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
};

checkTeamValues();
