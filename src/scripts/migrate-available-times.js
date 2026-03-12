import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Coach from '../models/Coach.js';

dotenv.config({ path: new URL('../../../.env.development', import.meta.url).pathname });

/**
 * Migrate Coach.availableTimes from string format to object format.
 *
 * Old format: ["Montag 9", "Dienstag 14"]
 * New format: [{day: "Montag", hour: 9}, {day: "Dienstag", hour: 14}]
 *
 * Usage: node src/scripts/migrate-available-times.js
 */
const migrate = async () => {
  console.log('🚀 Migrating Coach.availableTimes: string → object format\n');

  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  const coaches = await Coach.find();
  console.log(`📊 Found ${coaches.length} coaches\n`);

  let alreadyMigrated = 0;
  let migrated = 0;
  let skipped = 0;

  for (const coach of coaches) {
    const times = coach.availableTimes || [];

    if (times.length === 0) {
      skipped++;
      continue;
    }

    // Check if any entry is still a string
    const hasStrings = times.some(t => typeof t === 'string');
    if (!hasStrings) {
      alreadyMigrated++;
      continue;
    }

    const converted = times.map(t => {
      if (typeof t === 'string') {
        const parts = t.trim().split(' ');
        return { day: parts[0], hour: Number(parts[1]) };
      }
      return t; // already object
    });

    coach.availableTimes = converted;
    await coach.save();

    console.log(`  ✓ ${coach.firstName} ${coach.lastName}: ${times.length} slots converted`);
    migrated++;
  }

  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50));
  console.log(`Already in object format: ${alreadyMigrated}`);
  console.log(`Migrated from strings:    ${migrated}`);
  console.log(`No availableTimes set:    ${skipped}`);
  console.log('='.repeat(50));

  await mongoose.connection.close();
  console.log('\n🔌 Disconnected from MongoDB');
  process.exit(0);
};

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
