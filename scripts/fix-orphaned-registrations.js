/**
 * Fix Orphaned Seasonal Registrations
 * 
 * Finds seasonal registrations linked to deleted students and resets them to pending.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment
dotenv.config({ path: path.join(__dirname, '../.env.development') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/tennis-coach';

async function fixOrphanedRegistrations() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    const SeasonalRegistration = mongoose.model('SeasonalRegistration', new mongoose.Schema({}, { strict: false }));
    const Student = mongoose.model('Student', new mongoose.Schema({}, { strict: false }));

    // Find all processed registrations
    const processedRegistrations = await SeasonalRegistration.find({
      status: 'processed'
    }).lean();

    console.log(`\nFound ${processedRegistrations.length} processed registrations to check`);

    const orphaned = [];

    // Check each one to see if it's orphaned
    for (const reg of processedRegistrations) {
      // Case 1: Has studentId but student doesn't exist
      if (reg.studentId) {
        const student = await Student.findById(reg.studentId);
        if (!student) {
          orphaned.push({ ...reg, reason: 'Student deleted' });
        }
      } else {
        // Case 2: Processed but no studentId (already orphaned)
        orphaned.push({ ...reg, reason: 'No studentId' });
      }
    }

    console.log(`\n📋 Found ${orphaned.length} orphaned registration(s)`);

    if (orphaned.length === 0) {
      console.log('✅ No orphaned registrations found!');
      await mongoose.disconnect();
      return;
    }

    // Show details
    console.log('\nOrphaned Registrations:');
    orphaned.forEach((reg, i) => {
      console.log(`${i + 1}. ${reg.firstName} ${reg.lastName} - Reason: ${reg.reason} - Student ID: ${reg.studentId || 'none'}`);
    });

    console.log('\n🔧 Resetting orphaned registrations to pending...\n');

    // Reset all orphaned registrations
    const result = await SeasonalRegistration.updateMany(
      {
        _id: { $in: orphaned.map(r => r._id) }
      },
      {
        $set: {
          status: 'pending',
          processedAt: null,
          processedBy: null
        },
        $unset: {
          studentId: ""
        }
      }
    );

    console.log(`✅ Reset ${result.modifiedCount} registration(s) to pending`);
    console.log('\nThese registrations can now be processed again from the admin portal.');

    await mongoose.disconnect();
    console.log('\nDone!');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixOrphanedRegistrations();
