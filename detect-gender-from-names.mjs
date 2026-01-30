#!/usr/bin/env node

/**
 * Gender Detection from First Names
 *
 * Uses German first name database to automatically detect gender.
 *
 * Data Sources:
 * - Built-in common German names (inline)
 * - Optional: Download from https://github.com/MatthiasWinkelmann/firstname-database
 * - Optional: API fallback to genderize.io (100 free/day)
 *
 * Confidence Levels:
 * - HIGH (>95%): Auto-assign
 * - MEDIUM (70-95%): Manual review recommended
 * - LOW (<70%): Requires manual review
 * - AMBIGUOUS: Name exists in both genders
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env.development") });

import Student from "./src/models/Student.js";

// ============================================================================
// GERMAN FIRST NAME DATABASE (Common Names)
// ============================================================================
// Source: Compiled from German Standesamt data and common usage
// Format: { name: gender } where gender = "m" (männlich) or "w" (weiblich)

const GERMAN_NAMES = {
  // Male names (männlich)
  "alexander": "m", "andreas": "m", "anton": "m", "armin": "m", "axel": "m",
  "ben": "m", "benjamin": "m", "bernd": "m", "boris": "m",
  "carl": "m", "carsten": "m", "christian": "m", "christoph": "m", "clemens": "m",
  "daniel": "m", "david": "m", "dennis": "m", "dirk": "m", "dominik": "m",
  "elias": "m", "emil": "m", "eric": "m", "erik": "m",
  "fabian": "m", "felix": "m", "finn": "m", "florian": "m", "frank": "m", "franz": "m", "frederik": "m", "friedrich": "m",
  "georg": "m", "gerhard": "m", "gero": "m", "günter": "m", "gustav": "m",
  "han": "m", "hans": "m", "heiko": "m", "heinrich": "m", "helge": "m", "helmut": "m", "hendrik": "m", "henry": "m", "herbert": "m", "hermann": "m",
  "jakob": "m", "jan": "m", "jens": "m", "joachim": "m", "johannes": "m", "jonas": "m", "jonathan": "m", "jörg": "m", "josef": "m", "julius": "m", "jürgen": "m",
  "kai": "m", "karl": "m", "klaus": "m", "konstantin": "m", "kurt": "m",
  "lars": "m", "lennart": "m", "leon": "m", "leonard": "m", "leopold": "m", "linus": "m", "lorenz": "m", "louis": "m", "luca": "m", "lucas": "m", "ludwig": "m", "luis": "m", "lukas": "m", "lysander": "m",
  "malte": "m", "manfred": "m", "manuel": "m", "marco": "m", "marcus": "m", "marian": "m", "mario": "m", "marius": "m", "markus": "m", "martin": "m", "marvin": "m", "mathias": "m", "mats": "m", "matteo": "m", "matthias": "m", "maurice": "m", "max": "m", "maximilian": "m", "michael": "m", "moritz": "m",
  "nico": "m", "nils": "m", "noah": "m",
  "oliver": "m", "oskar": "m", "otto": "m",
  "pascal": "m", "patrick": "m", "paul": "m", "peter": "m", "philipp": "m",
  "rainer": "m", "ralf": "m", "raphael": "m", "reinhard": "m", "richard": "m", "robert": "m", "robin": "m", "roland": "m", "rolf": "m", "rudi": "m",
  "samuel": "m", "sebastian": "m", "simon": "m", "stefan": "m", "stephan": "m", "sven": "m",
  "theo": "m", "theodor": "m", "thiemo": "m", "thilo": "m", "thomas": "m", "thorsten": "m", "till": "m", "tim": "m", "timo": "m", "tobias": "m", "tom": "m",
  "udo": "m", "uwe": "m", "ulrich": "m",
  "valentin": "m", "viktor": "m", "vincent": "m", "volker": "m",
  "walter": "m", "werner": "m", "wilhelm": "m", "willi": "m", "wolfgang": "m",

  // Female names (weiblich)
  "ada": "w", "adele": "w", "adriana": "w", "agathe": "w", "agnes": "w", "alexandra": "w", "alice": "w", "alicia": "w", "alina": "w", "alma": "w", "amalia": "w", "amanda": "w", "amelie": "w", "amy": "w", "ana": "w", "andrea": "w", "angela": "w", "angelika": "w", "anika": "w", "anita": "w", "anja": "w", "ann": "w", "anna": "w", "annabelle": "w", "annalena": "w", "anne": "w", "anneke": "w", "annemarie": "w", "annette": "w", "annika": "w", "antonia": "w", "antonie": "w", "ariane": "w", "astrid": "w",
  "barbara": "w", "beata": "w", "beate": "w", "beatrice": "w", "beatrix": "w", "belinda": "w", "bettina": "w", "bianca": "w", "birgit": "w", "brigitte": "w", "britta": "w",
  "cara": "w", "carina": "w", "carla": "w", "carlotta": "w", "carmen": "w", "carolin": "w", "caroline": "w", "catharina": "w", "cathrin": "w", "cecilia": "w", "celine": "w", "charlotte": "w", "chiara": "w", "christa": "w", "christel": "w", "christiane": "w", "christina": "w", "christine": "w", "clara": "w", "claudia": "w", "constanze": "w", "cora": "w", "cordula": "w", "cornelia": "w",
  "dagmar": "w", "damla": "w", "daniela": "w", "daphne": "w", "deborah": "w", "denise": "w", "diana": "w", "dora": "w", "doreen": "w", "doris": "w", "dorothea": "w", "dorothee": "w",
  "edith": "w", "elena": "w", "eleonora": "w", "eleonore": "w", "elisa": "w", "elisabeth": "w", "elise": "w", "elke": "w", "ella": "w", "ellen": "w", "elsa": "w", "elsbeth": "w", "elvira": "w", "emilia": "w", "emilie": "w", "emily": "w", "emma": "w", "erika": "w", "erna": "w", "eva": "w", "evelin": "w", "evelyn": "w",
  "fabienne": "w", "fanny": "w", "felicia": "w", "felicitas": "w", "fiona": "w", "flora": "w", "florence": "w", "florentine": "w", "franziska": "w", "freda": "w", "frederike": "w", "frieda": "w", "friederike": "w",
  "gabriela": "w", "gabriele": "w", "gerda": "w", "gerlinde": "w", "gertrude": "w", "gesa": "w", "gisela": "w", "grete": "w", "gretel": "w", "gudrun": "w", "gunda": "w",
  "hanna": "w", "hannah": "w", "hedwig": "w", "heidi": "w", "heike": "w", "helen": "w", "helena": "w", "helene": "w", "helga": "w", "hella": "w", "henriette": "w", "herta": "w", "hilde": "w", "hildegard": "w",
  "ida": "w", "ilona": "w", "ilonka": "w", "imke": "w", "ina": "w", "ines": "w", "inga": "w", "inge": "w", "ingeborg": "w", "ingrid": "w", "inka": "w", "irene": "w", "irina": "w", "iris": "w", "irma": "w", "irmgard": "w", "isabel": "w", "isabell": "w", "isabella": "w", "isabelle": "w",
  "jacqueline": "w", "jana": "w", "janina": "w", "janine": "w", "janna": "w", "jasmin": "w", "jennifer": "w", "jenny": "w", "jessica": "w", "johanna": "w", "josephine": "w", "josefine": "w", "judith": "w", "julia": "w", "juliana": "w", "juliane": "w", "julie": "w", "jutta": "w",
  "karin": "w", "karina": "w", "karla": "w", "karola": "w", "karolina": "w", "karoline": "w", "katharina": "w", "käthe": "w", "kathleen": "w", "kathrin": "w", "katja": "w", "katrin": "w", "kerstin": "w", "klara": "w", "kornelia": "w", "kristin": "w", "kristina": "w",
  "lara": "w", "larissa": "w", "laura": "w", "lea": "w", "leah": "w", "lena": "w", "leni": "w", "leonie": "w", "leyla": "w", "lia": "w", "liana": "w", "lilli": "w", "lilly": "w", "lina": "w", "linda": "w", "lisa": "w", "lisanne": "w", "lisbeth": "w", "liselotte": "w", "liv": "w", "lola": "w", "lore": "w", "lorena": "w", "lotte": "w", "louisa": "w", "louise": "w", "lucia": "w", "lucie": "w", "lucienne": "w", "luisa": "w", "luise": "w", "luna": "w",
  "madeleine": "w", "magdalena": "w", "magdalene": "w", "maike": "w", "maja": "w", "mandy": "w", "manuela": "w", "mara": "w", "mareike": "w", "margareta": "w", "margarete": "w", "margarethe": "w", "margarita": "w", "margit": "w", "margot": "w", "margret": "w", "maria": "w", "mariana": "w", "marianne": "w", "marie": "w", "marietta": "w", "marika": "w", "marina": "w", "marion": "w", "marisa": "w", "marita": "w", "marlena": "w", "marlene": "w", "marta": "w", "martha": "w", "martina": "w", "mathilda": "w", "mathilde": "w", "melanie": "w", "melina": "w", "melissa": "w", "mercedes": "w", "mia": "w", "michaela": "w", "michelle": "w", "mila": "w", "mina": "w", "mira": "w", "miriam": "w", "mirjam": "w", "monika": "w",
  "nadia": "w", "nadine": "w", "nadja": "w", "natalia": "w", "natalie": "w", "natascha": "w", "nele": "w", "nicole": "w", "nika": "w", "nina": "w", "nora": "w",
  "olga": "w", "olivia": "w",
  "pamela": "w", "patricia": "w", "paula": "w", "pauline": "w", "petra": "w", "pia": "w",
  "rafaela": "w", "rebecca": "w", "regina": "w", "renate": "w", "rieke": "w", "rika": "w", "rita": "w", "rosa": "w", "rosalie": "w", "rosamunde": "w", "rose": "w", "rosemarie": "w", "roswitha": "w", "ruth": "w",
  "sabina": "w", "sabine": "w", "sabrina": "w", "sandra": "w", "sara": "w", "sarah": "w", "saskia": "w", "selma": "w", "sibel": "w", "sibylle": "w", "sienna": "w", "sigrid": "w", "silke": "w", "silvia": "w", "simone": "w", "sina": "w", "sofie": "w", "sonja": "w", "sophia": "w", "sophie": "w", "stefanie": "w", "stella": "w", "stephanie": "w", "susanna": "w", "susanne": "w", "sybille": "w",
  "tamara": "w", "tanja": "w", "tatjana": "w", "teresa": "w", "tessa": "w", "thea": "w", "theresa": "w", "therese": "w", "tina": "w",
  "ulrike": "w", "ursel": "w", "ursula": "w", "uta": "w", "ute": "w",
  "valentina": "w", "valerie": "w", "vanessa": "w", "vera": "w", "verena": "w", "veronika": "w", "victoria": "w", "viktoria": "w", "viola": "w", "vivian": "w", "viviane": "w",
  "waltraud": "w", "wendy": "w", "wiebke": "w", "wilhelmine": "w",
  "xenia": "w",
  "yasmin": "w", "ylva": "w", "yvonne": "w",
  "zara": "w", "zoe": "w",
};

// Ambiguous names (exist in both genders - need manual review)
const AMBIGUOUS_NAMES = new Set([
  "andrea", "kim", "marian", "robin", "dominique", "sascha", "jan"
]);

// ============================================================================
// GENDER DETECTION FUNCTIONS
// ============================================================================

function normalizeFirstName(name) {
  if (!name) return "";
  return name.trim().toLowerCase()
    .replace(/[^a-zäöüß]/gi, ""); // Remove special chars except German umlauts
}

function detectGender(firstName) {
  const normalized = normalizeFirstName(firstName);

  if (!normalized) {
    return { gender: null, confidence: 0, reason: "Empty name" };
  }

  // Check if ambiguous
  if (AMBIGUOUS_NAMES.has(normalized)) {
    return {
      gender: null,
      confidence: 50,
      reason: "Ambiguous name (exists in both genders)",
      needsReview: true
    };
  }

  // Check database
  const dbGender = GERMAN_NAMES[normalized];
  if (dbGender) {
    const gender = dbGender === "m" ? "männlich" : "weiblich";
    return {
      gender,
      confidence: 95,
      reason: "Found in German names database",
      needsReview: false
    };
  }

  // Unknown name
  return {
    gender: null,
    confidence: 0,
    reason: "Name not found in database",
    needsReview: true
  };
}

// ============================================================================
// MAIN ANALYSIS
// ============================================================================

async function analyzeGender(dryRun = true) {
  try {
    const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/tennis-coach";
    await mongoose.connect(mongoUri);
    console.log(`✅ Connected to MongoDB\n`);

    const students = await Student.find({});
    console.log(`📊 Total Students: ${students.length}\n`);

    // Filter students needing gender detection
    const needsGender = students.filter(s => {
      if (s.adult && s.sex) return false; // Adults with sex set
      return true; // All children + adults without sex
    });

    console.log(`⚧️  Students needing gender detection: ${needsGender.length}\n`);
    console.log("═".repeat(80));
    console.log("GENDER DETECTION RESULTS");
    console.log("═".repeat(80));

    const results = {
      highConfidence: [],
      needsReview: [],
      unknown: []
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
        adult: student.adult
      };

      if (detection.confidence >= 95 && detection.gender) {
        results.highConfidence.push(result);
      } else if (detection.needsReview) {
        results.needsReview.push(result);
      } else {
        results.unknown.push(result);
      }
    }

    // Print results by category
    console.log(`\n✅ HIGH CONFIDENCE (≥95%) - ${results.highConfidence.length} students`);
    console.log("   Can be auto-assigned:\n");
    results.highConfidence.slice(0, 15).forEach(r => {
      console.log(`   ${r.firstName} ${r.lastName} → ${r.detectedGender} (${r.confidence}%)`);
    });
    if (results.highConfidence.length > 15) {
      console.log(`   ... and ${results.highConfidence.length - 15} more`);
    }

    console.log(`\n⚠️  NEEDS MANUAL REVIEW - ${results.needsReview.length} students`);
    console.log("   Ambiguous or uncertain:\n");
    results.needsReview.forEach(r => {
      console.log(`   ${r.firstName} ${r.lastName} → ${r.reason}`);
    });

    console.log(`\n❓ UNKNOWN NAMES - ${results.unknown.length} students`);
    console.log("   Not found in database:\n");
    results.unknown.forEach(r => {
      console.log(`   ${r.firstName} ${r.lastName} → Requires manual entry or external API lookup`);
    });

    // Summary
    console.log("\n" + "═".repeat(80));
    console.log("📊 SUMMARY");
    console.log("═".repeat(80));
    console.log(`Total needing gender: ${needsGender.length}`);
    console.log(`  ✅ High confidence (auto-assign): ${results.highConfidence.length} (${((results.highConfidence.length/needsGender.length)*100).toFixed(1)}%)`);
    console.log(`  ⚠️  Manual review needed: ${results.needsReview.length} (${((results.needsReview.length/needsGender.length)*100).toFixed(1)}%)`);
    console.log(`  ❓ Unknown (API/manual): ${results.unknown.length} (${((results.unknown.length/needsGender.length)*100).toFixed(1)}%)`);

    // Export results
    const fs = await import('fs');
    fs.writeFileSync(
      path.join(__dirname, "gender-detection-results.json"),
      JSON.stringify(results, null, 2)
    );
    console.log(`\n✅ Exported to: backend/gender-detection-results.json`);

    // Dry run warning
    if (dryRun) {
      console.log("\n" + "═".repeat(80));
      console.log("ℹ️  DRY RUN MODE - No database changes made");
      console.log("═".repeat(80));
      console.log("\nTo apply high-confidence gender assignments:");
      console.log("   node detect-gender-from-names.mjs --apply\n");
    } else {
      // Apply high confidence assignments
      console.log("\n" + "═".repeat(80));
      console.log("✏️  APPLYING HIGH CONFIDENCE ASSIGNMENTS");
      console.log("═".repeat(80));

      let updated = 0;
      for (const result of results.highConfidence) {
        await Student.findByIdAndUpdate(result.id, {
          sex: result.detectedGender
        });
        updated++;
        console.log(`   ✅ ${result.firstName} ${result.lastName} → ${result.detectedGender}`);
      }

      console.log(`\n✅ Updated ${updated} students with high-confidence gender assignments\n`);
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
