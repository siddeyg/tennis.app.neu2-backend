/**
 * Delete Rejected Registrations
 *
 * Removes all seasonal registrations with status 'rejected' since this status is deprecated.
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

async function deleteRejectedRegistrations() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    const SeasonalRegistration = mongoose.model('SeasonalRegistration', new mongoose.Schema({}, { strict: false }));

    // Find all rejected registrations
    const rejected = await SeasonalRegistration.find({
      status: 'rejected'
    }).lean();

    console.log(`\n📋 Found ${rejected.length} rejected registration(s)`);

    if (rejected.length === 0) {
      console.log('✅ No rejected registrations found!');
      await mongoose.disconnect();
      return;
    }

    // Show details
    console.log('\nRejected Registrations:');
    rejected.forEach((reg, i) => {
      console.log(`${i + 1}. ${reg.firstName} ${reg.lastName} - Status: ${reg.status}`);
    });

    console.log('\n🗑️ Deleting rejected registrations...\n');

    // Delete all rejected registrations
    const result = await SeasonalRegistration.deleteMany({
      status: 'rejected'
    });

    console.log(`✅ Deleted ${result.deletedCount} rejected registration(s)`);

    await mongoose.disconnect();
    console.log('\nDone!');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

deleteRejectedRegistrations();
