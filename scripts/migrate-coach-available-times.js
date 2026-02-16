/**
 * Migration: Standardize Coach.availableTimes to object format
 *
 * Before: availableTimes: ["Montag 14", "Mittwoch 16"]
 * After:  availableTimes: [{day: "Montag", hour: 14}, {day: "Mittwoch", hour: 16}]
 *
 * Usage:
 *   node backend/scripts/migrate-coach-available-times.js
 *
 * Safe to run multiple times — skips coaches that already use object format.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
dotenv.config({ path: path.join(__dirname, '..', envFile) });

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌ MONGO_URI not set');
  process.exit(1);
}

await mongoose.connect(MONGO_URI);
console.log('✅ Connected to MongoDB');

const db = mongoose.connection.db;
const coaches = await db.collection('coaches').find({}).toArray();

console.log(`📋 Found ${coaches.length} coaches`);

let updated = 0;
let skipped = 0;
let errors = 0;

for (const coach of coaches) {
  const times = coach.availableTimes;

  if (!Array.isArray(times) || times.length === 0) {
    skipped++;
    continue;
  }

  // Check if already in object format
  if (typeof times[0] === 'object' && times[0] !== null && 'day' in times[0]) {
    skipped++;
    continue;
  }

  // Convert strings to objects
  const converted = [];
  for (const t of times) {
    if (typeof t === 'string') {
      const parts = t.trim().split(' ');
      if (parts.length === 2) {
        const day = parts[0];
        const hour = parseInt(parts[1], 10);
        if (!isNaN(hour)) {
          converted.push({ day, hour });
        } else {
          console.warn(`  ⚠️  Skipping invalid time "${t}" for coach ${coach._id}`);
        }
      } else {
        console.warn(`  ⚠️  Skipping malformed time "${t}" for coach ${coach._id}`);
      }
    }
  }

  try {
    await db.collection('coaches').updateOne(
      { _id: coach._id },
      { $set: { availableTimes: converted } }
    );
    console.log(`  ✅ ${coach.firstName} ${coach.lastName}: ${times.length} times converted`);
    updated++;
  } catch (err) {
    console.error(`  ❌ Error updating coach ${coach._id}:`, err.message);
    errors++;
  }
}

console.log('\n📊 Summary:');
console.log(`  Updated: ${updated}`);
console.log(`  Skipped (already correct or empty): ${skipped}`);
console.log(`  Errors: ${errors}`);

await mongoose.disconnect();
console.log('✅ Done');
