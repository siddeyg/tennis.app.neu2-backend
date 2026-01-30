/**
 * Database Migration: Add Password Reset and Email Verification Fields
 *
 * Run this script ONCE before deploying the new authentication features.
 * Adds 4 new fields to existing User documents:
 * - resetPasswordToken (String, default null)
 * - resetPasswordExpires (Date, default null)
 * - emailVerificationToken (String, default null)
 * - isEmailVerified (Boolean, default false)
 *
 * Usage:
 *   node migrate-user-auth-fields.mjs
 *
 * Safe to run multiple times (idempotent).
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.development' });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/tennis-coach';

// Define minimal User schema for migration
const userSchema = new mongoose.Schema({
  email: String,
  firstName: String,
  lastName: String,
  role: String,
  isActive: Boolean,
  resetPasswordToken: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null },
  emailVerificationToken: { type: String, default: null },
  isEmailVerified: { type: Boolean, default: false },
}, { collection: 'users' });

const User = mongoose.model('User', userSchema);

async function migrateUsers() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    console.log(`   URI: ${MONGO_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}`);

    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find all users
    console.log('📊 Analyzing existing users...');
    const allUsers = await User.find({});
    console.log(`   Total users: ${allUsers.length}\n`);

    if (allUsers.length === 0) {
      console.log('⚠️  No users found in database. Migration not needed.');
      await mongoose.disconnect();
      return;
    }

    // Check which users need migration
    const needsMigration = allUsers.filter(user =>
      user.resetPasswordToken === undefined ||
      user.resetPasswordExpires === undefined ||
      user.emailVerificationToken === undefined ||
      user.isEmailVerified === undefined
    );

    console.log('📋 Migration Status:');
    console.log(`   Users needing migration: ${needsMigration.length}`);
    console.log(`   Users already migrated: ${allUsers.length - needsMigration.length}\n`);

    if (needsMigration.length === 0) {
      console.log('✅ All users already have authentication fields. No migration needed.');
      await mongoose.disconnect();
      return;
    }

    // Perform migration
    console.log('🔧 Starting migration...\n');

    for (const user of needsMigration) {
      console.log(`   Migrating user: ${user.email} (${user.firstName} ${user.lastName})`);

      // Set default values for missing fields
      const updates = {};
      if (user.resetPasswordToken === undefined) {
        updates.resetPasswordToken = null;
      }
      if (user.resetPasswordExpires === undefined) {
        updates.resetPasswordExpires = null;
      }
      if (user.emailVerificationToken === undefined) {
        updates.emailVerificationToken = null;
      }
      if (user.isEmailVerified === undefined) {
        updates.isEmailVerified = false;
      }

      // Update user with new fields
      await User.updateOne(
        { _id: user._id },
        { $set: updates }
      );
    }

    console.log('\n✅ Migration completed successfully!\n');

    // Verify migration
    console.log('🔍 Verifying migration...');
    const verifyUsers = await User.find({});
    const stillNeedsMigration = verifyUsers.filter(user =>
      user.resetPasswordToken === undefined ||
      user.resetPasswordExpires === undefined ||
      user.emailVerificationToken === undefined ||
      user.isEmailVerified === undefined
    );

    if (stillNeedsMigration.length === 0) {
      console.log('✅ Verification passed: All users have authentication fields\n');
    } else {
      console.log(`⚠️  Verification warning: ${stillNeedsMigration.length} users still missing fields\n`);
    }

    // Summary
    console.log('📊 Final Summary:');
    console.log(`   Total users: ${verifyUsers.length}`);
    console.log(`   Users migrated: ${needsMigration.length}`);
    console.log(`   All users ready: ${stillNeedsMigration.length === 0 ? 'Yes' : 'No'}\n`);

    // Display field status for all users
    console.log('📋 User Authentication Status:');
    for (const user of verifyUsers) {
      const status = user.isEmailVerified ? '✅ Verified' : '⚠️  Not verified';
      console.log(`   ${user.email}: ${status}`);
    }
    console.log('');

    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    console.log('\n✅ Migration complete! You can now deploy the new authentication features.');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  }
}

// Run migration
migrateUsers();
