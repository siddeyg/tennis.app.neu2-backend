/**
 * Migration Script: Add team field to existing CampRegistrations
 *
 * This script sets a default value (false = Hobbyspieler) for all existing
 * camp registrations that don't have the team field.
 *
 * Run this script ONCE after deploying the team field changes.
 *
 * Usage:
 *   node backend/src/scripts/migrate-camp-team-field.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
const envPath = path.resolve(__dirname, '../../.env.development');
dotenv.config({ path: envPath });

// Import model
import CampRegistration from '../models/CampRegistration.js';

async function migrateCampTeamField() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    console.log(`   URI: ${process.env.MONGO_URI}`);

    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find all registrations WITHOUT team field
    console.log('🔍 Finding registrations without team field...');
    const registrationsWithoutTeam = await CampRegistration.find({
      team: { $exists: false }
    });

    console.log(`   Found: ${registrationsWithoutTeam.length} registrations\n`);

    if (registrationsWithoutTeam.length === 0) {
      console.log('✅ No migration needed - all registrations already have team field');
      process.exit(0);
    }

    // Preview
    console.log('📋 Preview of registrations to migrate:');
    registrationsWithoutTeam.slice(0, 5).forEach(reg => {
      console.log(`   - ${reg.firstName} ${reg.lastName} (${reg.email})`);
    });
    if (registrationsWithoutTeam.length > 5) {
      console.log(`   ... and ${registrationsWithoutTeam.length - 5} more`);
    }
    console.log('');

    // Confirm migration
    console.log('⚠️  Migration will set team=false (Hobbyspieler) as default');
    console.log('   Press Ctrl+C to cancel, or wait 3 seconds to continue...\n');

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Perform migration
    console.log('🔄 Migrating registrations...');
    const result = await CampRegistration.updateMany(
      { team: { $exists: false } },
      { $set: { team: false } }
    );

    console.log(`✅ Migration complete!`);
    console.log(`   Modified: ${result.modifiedCount} registrations`);
    console.log(`   Matched: ${result.matchedCount} registrations\n`);

    // Verify
    console.log('🔍 Verifying migration...');
    const stillMissing = await CampRegistration.countDocuments({
      team: { $exists: false }
    });

    if (stillMissing === 0) {
      console.log('✅ Verification passed - all registrations now have team field');
    } else {
      console.log(`⚠️  Warning: ${stillMissing} registrations still missing team field`);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run migration
migrateCampTeamField();
