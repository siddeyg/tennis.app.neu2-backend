/**
 * Migration: Multi-Child Registration Support
 *
 * This migration updates the database schema to support parent-child
 * profile management and multi-child seasonal registrations.
 *
 * Changes:
 * 1. Drops old unique index on seasonalregistrations
 * 2. Creates new compound index with familyMemberId
 * 3. Adds _id and createdAt to existing familyMembers (optional)
 *
 * Run: node src/migrations/migrate-multi-child-registration.js
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

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/tennis-coach';

console.log('🔧 Multi-Child Registration Migration');
console.log('=====================================\n');

async function migrate() {
  try {
    // Connect to MongoDB
    console.log(`📡 Connecting to: ${MONGO_URI}`);
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const db = mongoose.connection.db;

    // ==========================================
    // Step 1: Update SeasonalRegistrations Index
    // ==========================================
    console.log('Step 1: Updating seasonalregistrations indexes...');

    const registrationIndexes = await db.collection('seasonalregistrations').indexes();
    console.log(`  Current indexes: ${registrationIndexes.length}`);

    // Check if old unique index exists
    const oldIndexName = 'studentPortalUserId_1_periodId_1';
    const oldIndexExists = registrationIndexes.some(idx => idx.name === oldIndexName);

    if (oldIndexExists) {
      console.log(`  ⚠️  Dropping old unique index: ${oldIndexName}`);
      await db.collection('seasonalregistrations').dropIndex(oldIndexName);
      console.log('  ✅ Old index dropped');
    } else {
      console.log(`  ℹ️  Old index not found (already migrated or never existed)`);
    }

    // Create new compound index
    console.log('  🔨 Creating new compound index...');
    await db.collection('seasonalregistrations').createIndex(
      { studentPortalUserId: 1, periodId: 1, familyMemberId: 1 },
      { unique: true, sparse: true, name: 'studentPortalUserId_1_periodId_1_familyMemberId_1' }
    );
    console.log('  ✅ New compound index created');

    // Verify new index
    const updatedIndexes = await db.collection('seasonalregistrations').indexes();
    const newIndex = updatedIndexes.find(idx => idx.name === 'studentPortalUserId_1_periodId_1_familyMemberId_1');

    if (newIndex) {
      console.log('  ✅ Verification: New index exists');
      console.log(`     Keys: ${JSON.stringify(newIndex.key)}`);
      console.log(`     Unique: ${newIndex.unique}`);
      console.log(`     Sparse: ${newIndex.sparse}\n`);
    } else {
      console.error('  ❌ ERROR: New index not found after creation!\n');
      process.exit(1);
    }

    // ==========================================
    // Step 2: Update StudentPortalUsers (Optional)
    // ==========================================
    console.log('Step 2: Updating studentportalusers familyMembers (optional)...');

    // Count users with familyMembers
    const usersWithFamily = await db.collection('studentportalusers').countDocuments({
      familyMembers: { $exists: true, $ne: [] }
    });

    console.log(`  Users with familyMembers: ${usersWithFamily}`);

    if (usersWithFamily > 0) {
      console.log('  🔨 Adding _id and createdAt to existing familyMembers...');

      // Find users with familyMembers that don't have _id
      const users = await db.collection('studentportalusers').find({
        familyMembers: { $exists: true, $ne: [] }
      }).toArray();

      let updatedCount = 0;
      for (const user of users) {
        let needsUpdate = false;
        const updatedMembers = user.familyMembers.map(member => {
          // Add _id if missing
          if (!member._id) {
            member._id = new mongoose.Types.ObjectId();
            needsUpdate = true;
          }
          // Add createdAt if missing
          if (!member.createdAt) {
            member.createdAt = new Date();
            needsUpdate = true;
          }
          return member;
        });

        if (needsUpdate) {
          await db.collection('studentportalusers').updateOne(
            { _id: user._id },
            { $set: { familyMembers: updatedMembers } }
          );
          updatedCount++;
        }
      }

      console.log(`  ✅ Updated ${updatedCount} user records\n`);
    } else {
      console.log('  ℹ️  No users with familyMembers found (skipping)\n');
    }

    // ==========================================
    // Step 3: Verify Migration
    // ==========================================
    console.log('Step 3: Verification...');

    // Check registrations
    const totalRegistrations = await db.collection('seasonalregistrations').countDocuments();
    const registrationsWithFamilyId = await db.collection('seasonalregistrations').countDocuments({
      familyMemberId: { $exists: true, $ne: null }
    });

    console.log(`  Total seasonal registrations: ${totalRegistrations}`);
    console.log(`  Registrations with familyMemberId: ${registrationsWithFamilyId}`);

    // Check for duplicate registrations (should be 0 with new index)
    const duplicates = await db.collection('seasonalregistrations').aggregate([
      {
        $group: {
          _id: {
            userId: '$studentPortalUserId',
            periodId: '$periodId',
            familyId: '$familyMemberId'
          },
          count: { $sum: 1 }
        }
      },
      { $match: { count: { $gt: 1 } } }
    ]).toArray();

    if (duplicates.length > 0) {
      console.log(`  ⚠️  WARNING: Found ${duplicates.length} duplicate registrations`);
      console.log('     These may need manual cleanup.');
    } else {
      console.log('  ✅ No duplicate registrations found');
    }

    // Summary
    console.log('\n=====================================');
    console.log('✅ Migration completed successfully!');
    console.log('=====================================\n');

    console.log('Next Steps:');
    console.log('1. Restart backend server');
    console.log('2. Test multi-child registration flow');
    console.log('3. Verify children management UI\n');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('📡 Database connection closed');
  }
}

// Run migration
migrate();
