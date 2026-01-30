#!/usr/bin/env node

/**
 * Analyze Missing Student Attributes
 *
 * Identifies missing data fields and suggests how to obtain them:
 * - gender (sex field for adults, missing for children)
 * - birthDate
 * - email
 * - phone
 * - adress
 * - comment fields
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, ".env.development") });

// Models
import Student from "./src/models/Student.js";

async function analyzeDatabase() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/tennis-coach";
    await mongoose.connect(mongoUri);
    console.log(`✅ Connected to MongoDB: ${mongoUri}\n`);

    // Fetch all students
    const students = await Student.find({});
    console.log(`📊 Total Students: ${students.length}\n`);

    // === ANALYSIS 1: Missing Core Attributes ===
    console.log("═".repeat(80));
    console.log("📋 MISSING CORE ATTRIBUTES ANALYSIS");
    console.log("═".repeat(80));

    const missingBirthDate = students.filter(s => !s.birthDate || s.birthDate.trim() === "");
    const missingEmail = students.filter(s => !s.email || s.email.trim() === "");
    const missingPhone = students.filter(s => !s.phone || s.phone.trim() === "");
    const missingAddress = students.filter(s => !s.adress || s.adress.trim() === "");

    console.log(`\n1️⃣  BIRTHDATE (Geburtsdatum):`);
    console.log(`   Missing: ${missingBirthDate.length}/${students.length} (${((missingBirthDate.length/students.length)*100).toFixed(1)}%)`);
    if (missingBirthDate.length > 0) {
      console.log(`   Examples: ${missingBirthDate.slice(0, 5).map(s => s.firstName + " " + s.lastName).join(", ")}`);
    }

    console.log(`\n2️⃣  EMAIL:`);
    console.log(`   Missing: ${missingEmail.length}/${students.length} (${((missingEmail.length/students.length)*100).toFixed(1)}%)`);
    if (missingEmail.length > 0) {
      console.log(`   Examples: ${missingEmail.slice(0, 5).map(s => s.firstName + " " + s.lastName).join(", ")}`);
    }

    console.log(`\n3️⃣  PHONE (Telefonnummer):`);
    console.log(`   Missing: ${missingPhone.length}/${students.length} (${((missingPhone.length/students.length)*100).toFixed(1)}%)`);
    if (missingPhone.length > 0) {
      console.log(`   Examples: ${missingPhone.slice(0, 5).map(s => s.firstName + " " + s.lastName).join(", ")}`);
    }

    console.log(`\n4️⃣  ADDRESS (Adresse):`);
    console.log(`   Missing: ${missingAddress.length}/${students.length} (${((missingAddress.length/students.length)*100).toFixed(1)}%)`);
    if (missingAddress.length > 0) {
      console.log(`   Examples: ${missingAddress.slice(0, 5).map(s => s.firstName + " " + s.lastName).join(", ")}`);
    }

    // === ANALYSIS 2: Gender (Sex) Field ===
    console.log("\n" + "═".repeat(80));
    console.log("⚧️  GENDER (SEX) FIELD ANALYSIS");
    console.log("═".repeat(80));

    const adults = students.filter(s => s.adult === true);
    const children = students.filter(s => s.adult === false);

    console.log(`\nAdults: ${adults.length}`);
    const adultsMissingSex = adults.filter(s => !s.sex || s.sex.trim() === "");
    console.log(`   Missing sex: ${adultsMissingSex.length}/${adults.length} (${((adultsMissingSex.length/adults.length)*100).toFixed(1)}%)`);
    if (adultsMissingSex.length > 0) {
      console.log(`   Examples: ${adultsMissingSex.slice(0, 5).map(s => s.firstName + " " + s.lastName).join(", ")}`);
    }

    console.log(`\nChildren: ${children.length}`);
    console.log(`   ⚠️  Schema does NOT have 'sex' field for children (only for adults)`);
    console.log(`   Children without any gender info: ${children.length} (100%)`);

    // === ANALYSIS 3: Unique First Names for Gender Detection ===
    console.log("\n" + "═".repeat(80));
    console.log("👤 FIRST NAMES FOR GENDER DETECTION");
    console.log("═".repeat(80));

    // All first names
    const allFirstNames = new Set(students.map(s => s.firstName?.trim()).filter(Boolean));
    console.log(`\nTotal unique first names: ${allFirstNames.size}`);

    // Children first names (need gender detection)
    const childFirstNames = new Set(children.map(s => s.firstName?.trim()).filter(Boolean));
    console.log(`Children first names needing gender: ${childFirstNames.size}`);
    console.log(`Examples: ${Array.from(childFirstNames).slice(0, 10).join(", ")}`);

    // Adults with known gender
    const adultsWithSex = adults.filter(s => s.sex && s.sex.trim() !== "");
    const maleNames = new Set(
      adultsWithSex
        .filter(s => s.sex === "männlich")
        .map(s => s.firstName?.trim())
        .filter(Boolean)
    );
    const femaleNames = new Set(
      adultsWithSex
        .filter(s => s.sex === "weiblich")
        .map(s => s.firstName?.trim())
        .filter(Boolean)
    );

    console.log(`\nFrom adults with known gender:`);
    console.log(`   Male names (${maleNames.size}): ${Array.from(maleNames).slice(0, 10).join(", ")}`);
    console.log(`   Female names (${femaleNames.size}): ${Array.from(femaleNames).slice(0, 10).join(", ")}`);

    // === ANALYSIS 4: Comment Fields Usage ===
    console.log("\n" + "═".repeat(80));
    console.log("💬 COMMENT FIELDS USAGE");
    console.log("═".repeat(80));

    const withComment = students.filter(s => s.comment && s.comment.trim() !== "");
    const withComment2 = students.filter(s => s.comment2 && s.comment2.trim() !== "");

    console.log(`\nComment (general): ${withComment.length}/${students.length} (${((withComment.length/students.length)*100).toFixed(1)}%)`);
    if (withComment.length > 0) {
      console.log(`   Examples:`);
      withComment.slice(0, 3).forEach(s => {
        console.log(`      ${s.firstName} ${s.lastName}: "${s.comment.slice(0, 60)}..."`);
      });
    }

    console.log(`\nComment2 (training goal for adults): ${withComment2.length}/${students.length} (${((withComment2.length/students.length)*100).toFixed(1)}%)`);
    if (withComment2.length > 0) {
      console.log(`   Examples:`);
      withComment2.slice(0, 3).forEach(s => {
        console.log(`      ${s.firstName} ${s.lastName}: "${s.comment2}"`);
      });
    }

    // === SUMMARY & RECOMMENDATIONS ===
    console.log("\n" + "═".repeat(80));
    console.log("💡 RECOMMENDATIONS: HOW TO OBTAIN MISSING DATA");
    console.log("═".repeat(80));

    console.log(`\n1️⃣  GENDER (Sex) - ${children.length + adultsMissingSex.length} students missing`);
    console.log(`
   OPTION A: First Name Analysis (Automatic)
   ----------------------------------------
   ✅ Use German first name database to detect gender
   ✅ Databases available:
      • https://github.com/MatthiasWinkelmann/firstname-database (90K German names)
      • https://www.github.com/datasets/gender-names (95K international names)
      • API: genderize.io (100 free requests/day, then €9/month)
   ✅ Implementation:
      • Download CSV/JSON database
      • Match firstName against database
      • Set confidence threshold (>80% = auto-assign, <80% = manual review)
   ⚠️  Accuracy: ~90-95% for German names
   ⚠️  Ambiguous names need manual review (Andrea, Kim, Luca, etc.)

   OPTION B: Manual Entry
   ----------------------
   ✅ Add gender field to StudentForm for children
   ✅ Ask during registration/import
   ✅ Bulk update via admin interface

   OPTION C: Inference from Training Groups (Heuristic)
   -----------------------------------------------------
   ⚠️  NOT RECOMMENDED - gender doesn't correlate with training level`);

    console.log(`\n2️⃣  BIRTHDATE - ${missingBirthDate.length} students missing`);
    console.log(`
   ✅ Required for:
      • Age-based training group assignment
      • Insurance requirements
      • Competition eligibility

   HOW TO OBTAIN:
   • Contact parents/students via email (template provided)
   • Add "required" validation to registration form
   • Bulk import from existing club records
   • Estimate from training group (Kinderland = 4-6 years, etc.)`);

    console.log(`\n3️⃣  CONTACT INFO (Email/Phone/Address) - ${Math.max(missingEmail.length, missingPhone.length, missingAddress.length)} students missing`);
    console.log(`
   ✅ Email: ${missingEmail.length} missing - Used for notifications, schedule updates
   ✅ Phone: ${missingPhone.length} missing - Emergency contact, cancellations
   ✅ Address: ${missingAddress.length} missing - Invoicing, marketing, carpooling

   HOW TO OBTAIN:
   • Send email request with web form link
   • Phone call campaign for missing contacts
   • Request during next training session
   • Make mandatory for new registrations`);

    console.log(`\n4️⃣  COMMENT FIELDS - ${students.length - withComment.length} students without notes`);
    console.log(`
   ✅ Currently used by ${withComment.length} students (${((withComment.length/students.length)*100).toFixed(1)}%)
   ✅ Could track:
      • Health conditions / allergies
      • Special needs / accommodations
      • Parent communication preferences
      • Payment status / billing notes

   HOW TO IMPROVE:
   • Add structured fields (health, notes, preferences)
   • Prompt coaches to add observations
   • Auto-populate from registration forms`);

    // === EXPORT NAME LISTS ===
    console.log("\n" + "═".repeat(80));
    console.log("📁 EXPORT NAME LISTS FOR MANUAL PROCESSING");
    console.log("═".repeat(80));

    // Export children names for gender detection
    const childrenForGender = children.map(s => ({
      firstName: s.firstName,
      lastName: s.lastName,
      trainigGroup: s.trainigGroup,
      suggestedGender: "" // To be filled manually or by script
    }));

    console.log(`\n✅ Exported to: backend/missing-gender-children.json (${childrenForGender.length} students)`);

    // Export students missing birthDate
    const studentsNeedingBirthDate = missingBirthDate.map(s => ({
      firstName: s.firstName,
      lastName: s.lastName,
      email: s.email || "",
      phone: s.phone || "",
      adult: s.adult,
      trainigGroup: s.trainigGroup || s.skillLevel,
      birthDate: "" // To be filled
    }));

    console.log(`✅ Exported to: backend/missing-birthdate.json (${studentsNeedingBirthDate.length} students)`);

    // Write files
    const fs = await import('fs');
    fs.writeFileSync(
      path.join(__dirname, "missing-gender-children.json"),
      JSON.stringify(childrenForGender, null, 2)
    );
    fs.writeFileSync(
      path.join(__dirname, "missing-birthdate.json"),
      JSON.stringify(studentsNeedingBirthDate, null, 2)
    );

    console.log("\n✅ Analysis complete!\n");

  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await mongoose.disconnect();
  }
}

analyzeDatabase();
