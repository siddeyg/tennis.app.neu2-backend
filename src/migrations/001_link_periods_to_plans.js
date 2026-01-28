/**
 * Migration: Link Existing SavedSchedules to Registration Periods
 *
 * Purpose: Assign all existing saved schedules to the Winter 2025/26 period
 *          and set the most recent one as currentPlanId.
 *
 * Run: node backend/src/migrations/001_link_periods_to_plans.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// ES6 __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env.development') });

// Import models
import RegistrationPeriod from '../models/RegistrationPeriod.js';
import SavedSchedule from '../models/SavedSchedule.js';

async function migrate() {
  try {
    console.log('🔄 Starting migration: Link periods to plans');
    console.log('📊 Connecting to MongoDB...');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('✅ Connected to MongoDB');

    // Step 1: Find or create "Winter 2025/26" period
    console.log('\n📋 Step 1: Finding or creating Winter 2025/26 period');

    let winterPeriod = await RegistrationPeriod.findOne({
      name: /winter.*2025/i
    });

    if (!winterPeriod) {
      console.log('   Creating new Winter 2025/26 period...');

      // Need a valid user ID for createdBy - find first admin user
      const User = mongoose.model('User');
      let adminUser;
      try {
        adminUser = await User.findOne({ role: 'admin' });
      } catch (err) {
        console.log('   Warning: User model not found, using placeholder');
      }

      winterPeriod = await RegistrationPeriod.create({
        name: 'Wintertraining 2025/26',
        season: 'winter',
        trainingStartDate: new Date('2025-10-01'),
        trainingEndDate: new Date('2026-03-31'),
        registrationDeadline: new Date('2025-09-15'),
        status: 'closed', // Mark as closed since it's historical
        isActive: false,
        createdBy: adminUser?._id || new mongoose.Types.ObjectId()
      });

      console.log(`   ✅ Created period: ${winterPeriod._id}`);
    } else {
      console.log(`   ✅ Found existing period: ${winterPeriod._id} - ${winterPeriod.name}`);
    }

    // Step 2: Count and display unlinked schedules
    console.log('\n📋 Step 2: Finding unlinked saved schedules');

    const unlinkedSchedules = await SavedSchedule.find({
      $or: [
        { periodId: { $exists: false } },
        { periodId: null }
      ]
    }).sort({ createdAt: -1 });

    console.log(`   Found ${unlinkedSchedules.length} unlinked schedules`);

    if (unlinkedSchedules.length === 0) {
      console.log('   ⚠️  No unlinked schedules found. Migration may have already run.');
      await mongoose.disconnect();
      return;
    }

    // Show schedule details
    console.log('\n   Schedules to migrate:');
    unlinkedSchedules.forEach((schedule, index) => {
      console.log(`   ${index + 1}. ${schedule.name} (${schedule.createdAt.toLocaleDateString('de-DE')})`);
    });

    // Step 3: Assign all unlinked schedules to Winter 2025/26
    console.log('\n📋 Step 3: Assigning schedules to Winter 2025/26 period');

    const result = await SavedSchedule.updateMany(
      {
        $or: [
          { periodId: { $exists: false } },
          { periodId: null }
        ]
      },
      {
        $set: { periodId: winterPeriod._id }
      }
    );

    console.log(`   ✅ Assigned ${result.modifiedCount} schedules to Winter 2025/26`);

    // Step 4: Calculate version numbers for assigned schedules
    console.log('\n📋 Step 4: Setting version numbers');

    const assignedSchedules = await SavedSchedule.find({
      periodId: winterPeriod._id
    }).sort({ createdAt: 1 }); // Oldest first

    for (let i = 0; i < assignedSchedules.length; i++) {
      const schedule = assignedSchedules[i];
      schedule.version = i + 1; // Version 1, 2, 3, etc.
      await schedule.save();
      console.log(`   Set version ${schedule.version} for "${schedule.name}"`);
    }

    // Step 5: Set currentPlanId to most recent schedule
    console.log('\n📋 Step 5: Setting currentPlanId to most recent plan');

    const latestPlan = await SavedSchedule.findOne({
      periodId: winterPeriod._id
    })
      .sort({ createdAt: -1 })
      .limit(1);

    if (latestPlan) {
      winterPeriod.currentPlanId = latestPlan._id;
      await winterPeriod.save();
      console.log(`   ✅ Set currentPlanId to: "${latestPlan.name}" (version ${latestPlan.version})`);
    } else {
      console.log('   ⚠️  No plans found for this period');
    }

    // Step 6: Verification
    console.log('\n📋 Step 6: Verification');

    const totalSchedules = await SavedSchedule.countDocuments();
    const linkedSchedules = await SavedSchedule.countDocuments({
      periodId: { $exists: true, $ne: null }
    });
    const unlinkedRemaining = await SavedSchedule.countDocuments({
      $or: [
        { periodId: { $exists: false } },
        { periodId: null }
      ]
    });

    console.log(`   Total schedules: ${totalSchedules}`);
    console.log(`   Linked to periods: ${linkedSchedules}`);
    console.log(`   Unlinked remaining: ${unlinkedRemaining}`);

    if (unlinkedRemaining === 0) {
      console.log('   ✅ All schedules are now linked to periods!');
    } else {
      console.log(`   ⚠️  Warning: ${unlinkedRemaining} schedules still unlinked`);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ Migration completed successfully!');
    console.log('='.repeat(60));
    console.log(`Period: ${winterPeriod.name} (ID: ${winterPeriod._id})`);
    console.log(`Schedules migrated: ${result.modifiedCount}`);
    console.log(`Current plan: ${latestPlan?.name || 'None'}`);
    console.log('='.repeat(60) + '\n');

    // Disconnect
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    console.error('Stack trace:', error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run migration if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate();
}

export { migrate };
