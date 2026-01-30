#!/usr/bin/env node

/**
 * Enhanced Gender Detection with 90K German Names Database
 *
 * Uses MatthiasWinkelmann/firstname-database (90,000+ names)
 * CSV format: name;gender;[country frequencies...]
 * Germany column index: 16
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env.development") });

import Student from "./src/models/Student.js";

// ============================================================================
// LOAD 90K NAMES DATABASE FROM CSV
// ============================================================================

let NAMES_DATABASE = {};
let AMBIGUOUS_NAMES = new Set();

function loadNamesDatabase() {
  console.log("📂 Loading 90K names database from firstnames-database.csv...");

  const csvPath = path.join(__dirname, "firstnames-database.csv");
  if (!fs.existsSync(csvPath)) {
    console.error("❌ Database file not found: firstnames-database.csv");
    console.error("   Please run: curl -L https://raw.githubusercontent.com/MatthiasWinkelmann/firstname-database/master/firstnames.csv -o firstnames-database.csv");
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, "utf-8");
  const lines = csvContent.split("\n");

  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const columns = line.split(";");
    const name = columns[0]?.trim().toLowerCase();
    const gender = columns[1]?.trim();
    const germanyFreq = columns[16]; // Germany column

    if (!name || !gender) continue;

    // Parse gender (M, F, ?M, ?F, ?, 1M, 2F, etc.)
    let parsedGender = null;
    let confidence = 100;

    if (gender === "M" || gender === "1M" || gender === "2M") {
      parsedGender = "männlich";
      confidence = 95;
    } else if (gender === "F" || gender === "1F" || gender === "2F") {
      parsedGender = "weiblich";
      confidence = 95;
    } else if (gender === "?M") {
      parsedGender = "männlich";
      confidence = 70; // Ambiguous, but leans male
    } else if (gender === "?F") {
      parsedGender = "weiblich";
      confidence = 70; // Ambiguous, but leans female
    } else if (gender === "?") {
      // Truly ambiguous
      AMBIGUOUS_NAMES.add(name);
      continue;
    }

    if (!parsedGender) continue;

    // Boost confidence if name is common in Germany
    if (germanyFreq && germanyFreq !== "") {
      const freqValue = parseInt(germanyFreq);
      if (!isNaN(freqValue) && freqValue >= -5) {
        // Frequent in Germany (-5 = 0.03125%, -2 = 0.25%, etc.)
        confidence = Math.min(confidence + 5, 98);
      }
    }

    // Store in database (if name already exists, keep higher confidence)
    if (!NAMES_DATABASE[name] || NAMES_DATABASE[name].confidence < confidence) {
      NAMES_DATABASE[name] = {
        gender: parsedGender,
        confidence,
        germanFrequency: germanyFreq || null
      };
    }
  }

  console.log(`✅ Loaded ${Object.keys(NAMES_DATABASE).length} names`);
  console.log(`⚠️  Found ${AMBIGUOUS_NAMES.size} ambiguous names (gender: ?)`);
  console.log("");
}

// ============================================================================
// GENDER DETECTION FUNCTIONS
// ============================================================================

function normalizeFirstName(name) {
  if (!name) return "";

  // Handle compound names (e.g., "Lara-Marie" → "Lara")
  let normalized = name.trim().toLowerCase();

  // Take first part of hyphenated names
  if (normalized.includes("-")) {
    normalized = normalized.split("-")[0];
  }

  // Remove special characters except German umlauts
  normalized = normalized.replace(/[^a-zäöüß]/gi, "");

  return normalized;
}

function detectGender(firstName) {
  const normalized = normalizeFirstName(firstName);

  if (!normalized) {
    return {
      gender: null,
      confidence: 0,
      reason: "Empty name",
      needsReview: true,
      source: "validation"
    };
  }

  // Check if ambiguous
  if (AMBIGUOUS_NAMES.has(normalized)) {
    return {
      gender: null,
      confidence: 50,
      reason: "Ambiguous name (exists in both genders)",
      needsReview: true,
      source: "ambiguous"
    };
  }

  // Check 90K database
  const dbEntry = NAMES_DATABASE[normalized];
  if (dbEntry) {
    return {
      gender: dbEntry.gender,
      confidence: dbEntry.confidence,
      reason: `Found in 90K database${dbEntry.germanFrequency ? " (common in Germany)" : ""}`,
      needsReview: dbEntry.confidence < 80,
      source: "database-90k"
    };
  }

  // Unknown name
  return {
    gender: null,
    confidence: 0,
    reason: "Name not found in database",
    needsReview: true,
    source: "unknown"
  };
}

// ============================================================================
// MAIN ANALYSIS
// ============================================================================

async function analyzeGender(dryRun = true) {
  try {
    // Load names database first
    loadNamesDatabase();

    const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/tennis-coach";
    await mongoose.connect(mongoUri);
    console.log(`✅ Connected to MongoDB\n`);

    const students = await Student.find({});
    console.log(`📊 Total Students: ${students.length}\n`);

    // Filter students needing gender detection
    const needsGender = students.filter(s => {
      if (s.adult && s.sex && s.sex.trim() !== "") return false; // Adults with sex set
      if (!s.adult && s.sex && s.sex.trim() !== "") return false; // Children with sex set
      return true; // All without sex
    });

    console.log(`⚧️  Students needing gender detection: ${needsGender.length}\n`);
    console.log("═".repeat(80));
    console.log("ENHANCED GENDER DETECTION RESULTS (90K Database)");
    console.log("═".repeat(80));

    const results = {
      highConfidence: [],      // ≥80% confidence
      mediumConfidence: [],    // 60-79% confidence
      needsReview: [],         // <60% or ambiguous
      unknown: []              // Not found
    };

    for (const student of needsGender) {
      const detection = detectGender(student.firstName);

      const result = {
        id: student._id,
        firstName: student.firstName,
        lastName: student.lastName,
        currentSex: student.sex || "(not set)",
        detectedGender: detection.gender,
        confidence: detection.confidence,
        reason: detection.reason,
        adult: student.adult,
        source: detection.source
      };

      if (detection.confidence >= 80 && detection.gender) {
        results.highConfidence.push(result);
      } else if (detection.confidence >= 60 && detection.gender) {
        results.mediumConfidence.push(result);
      } else if (detection.needsReview) {
        results.needsReview.push(result);
      } else {
        results.unknown.push(result);
      }
    }

    // Print results by category
    console.log(`\n✅ HIGH CONFIDENCE (≥80%) - ${results.highConfidence.length} students`);
    console.log("   Auto-assign recommended:\n");
    results.highConfidence.slice(0, 20).forEach(r => {
      console.log(`   ${r.firstName} ${r.lastName} → ${r.detectedGender} (${r.confidence}%)`);
    });
    if (results.highConfidence.length > 20) {
      console.log(`   ... and ${results.highConfidence.length - 20} more`);
    }

    console.log(`\n🟡 MEDIUM CONFIDENCE (60-79%) - ${results.mediumConfidence.length} students`);
    console.log("   Review recommended before applying:\n");
    results.mediumConfidence.forEach(r => {
      console.log(`   ${r.firstName} ${r.lastName} → ${r.detectedGender} (${r.confidence}%) - ${r.reason}`);
    });

    console.log(`\n⚠️  NEEDS MANUAL REVIEW - ${results.needsReview.length} students`);
    console.log("   Ambiguous or uncertain:\n");
    results.needsReview.slice(0, 15).forEach(r => {
      console.log(`   ${r.firstName} ${r.lastName} → ${r.reason}`);
    });
    if (results.needsReview.length > 15) {
      console.log(`   ... and ${results.needsReview.length - 15} more`);
    }

    console.log(`\n❓ UNKNOWN NAMES - ${results.unknown.length} students`);
    console.log("   Not found in 90K database:\n");
    results.unknown.forEach(r => {
      console.log(`   ${r.firstName} ${r.lastName}`);
    });

    // Summary
    console.log("\n" + "═".repeat(80));
    console.log("📊 SUMMARY");
    console.log("═".repeat(80));
    console.log(`Total needing gender: ${needsGender.length}`);
    console.log(`  ✅ High confidence (≥80%): ${results.highConfidence.length} (${((results.highConfidence.length/needsGender.length)*100).toFixed(1)}%)`);
    console.log(`  🟡 Medium confidence (60-79%): ${results.mediumConfidence.length} (${((results.mediumConfidence.length/needsGender.length)*100).toFixed(1)}%)`);
    console.log(`  ⚠️  Manual review needed: ${results.needsReview.length} (${((results.needsReview.length/needsGender.length)*100).toFixed(1)}%)`);
    console.log(`  ❓ Unknown: ${results.unknown.length} (${((results.unknown.length/needsGender.length)*100).toFixed(1)}%)`);

    // Export results
    fs.writeFileSync(
      path.join(__dirname, "gender-detection-enhanced-results.json"),
      JSON.stringify(results, null, 2)
    );
    console.log(`\n✅ Exported to: backend/gender-detection-enhanced-results.json`);

    // Dry run warning
    if (dryRun) {
      console.log("\n" + "═".repeat(80));
      console.log("ℹ️  DRY RUN MODE - No database changes made");
      console.log("═".repeat(80));
      console.log("\nTo apply high-confidence gender assignments:");
      console.log("   node detect-gender-enhanced.mjs --apply\n");
      console.log("To apply both high and medium confidence:");
      console.log("   node detect-gender-enhanced.mjs --apply --include-medium\n");
    } else {
      // Apply assignments
      console.log("\n" + "═".repeat(80));
      console.log("✏️  APPLYING GENDER ASSIGNMENTS");
      console.log("═".repeat(80));

      const includeMedium = process.argv.includes("--include-medium");
      const toUpdate = includeMedium
        ? [...results.highConfidence, ...results.mediumConfidence]
        : results.highConfidence;

      let updated = 0;
      for (const result of toUpdate) {
        await Student.findByIdAndUpdate(result.id, {
          sex: result.detectedGender
        });
        updated++;
        console.log(`   ✅ ${result.firstName} ${result.lastName} → ${result.detectedGender} (${result.confidence}%)`);
      }

      console.log(`\n✅ Updated ${updated} students with gender assignments`);

      if (!includeMedium && results.mediumConfidence.length > 0) {
        console.log(`\nℹ️  ${results.mediumConfidence.length} medium-confidence students not updated`);
        console.log(`   Run with --include-medium to also update 60-79% confidence names\n`);
      }
    }

  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await mongoose.disconnect();
  }
}

// Run with --apply flag to actually update database
const applyChanges = process.argv.includes("--apply");
analyzeGender(!applyChanges);
