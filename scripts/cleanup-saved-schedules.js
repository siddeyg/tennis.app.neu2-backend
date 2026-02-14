#!/usr/bin/env node
/**
 * Cleanup script: Delete all saved schedules except the last 2 (most recent)
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import mongoose from 'mongoose';
import SavedSchedule from '../src/models/SavedSchedule.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env.development') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/tennis-coach';

async function cleanup() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log(`Connected to MongoDB: ${MONGO_URI}`);

    // Get all saved schedules sorted by creation date (newest first)
    const allSchedules = await SavedSchedule.find()
      .sort({ createdAt: -1 })
      .lean();

    console.log(`\nFound ${allSchedules.length} saved schedules total`);

    if (allSchedules.length <= 2) {
      console.log('Only 2 or fewer schedules exist. Nothing to delete.');
      return;
    }

    // Keep the last 2 (newest), delete the rest
    const toKeep = allSchedules.slice(0, 2);
    const toDelete = allSchedules.slice(2);

    console.log('\n📌 Will KEEP (last 2):');
    toKeep.forEach(s => {
      console.log(`  ✓ ${s.name} (${new Date(s.createdAt).toLocaleString()})`);
    });

    console.log(`\n🗑️  Will DELETE (${toDelete.length} schedules):`);
    toDelete.forEach(s => {
      console.log(`  ✗ ${s.name} (${new Date(s.createdAt).toLocaleString()})`);
    });

    // Confirm deletion
    console.log(`\n⚠️  About to delete ${toDelete.length} saved schedules!`);
    console.log('Press Ctrl+C within 3 seconds to cancel...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Delete old schedules
    const idsToDelete = toDelete.map(s => s._id);
    const result = await SavedSchedule.deleteMany({ _id: { $in: idsToDelete } });

    console.log(`\n✅ Deleted ${result.deletedCount} saved schedules`);
    console.log(`✅ Kept ${toKeep.length} most recent schedules`);

  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

cleanup();
