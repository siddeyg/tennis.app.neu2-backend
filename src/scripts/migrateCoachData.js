import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Student from '../models/Student.js';
import Coach from '../models/Coach.js';

// Load environment variables
dotenv.config();

/**
 * Coach Data Migration Script
 *
 * This script migrates coach references in Student documents from mixed format
 * (coach names as strings OR ObjectIds) to exclusively use ObjectIds.
 *
 * Usage: node src/scripts/migrateCoachData.js
 */

const migrateCoachData = async () => {
  console.log('🚀 Starting Coach Data Migration...\n');

  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Fetch all students and coaches
    const students = await Student.find();
    const coaches = await Coach.find();

    console.log(`📊 Found ${students.length} students`);
    console.log(`📊 Found ${coaches.length} coaches\n`);

    // Migration statistics
    const stats = {
      totalStudents: students.length,
      alreadyMigrated: 0,      // Already have valid ObjectId
      migratedByName: 0,       // Converted from name to ObjectId
      setToNull: 0,            // Had coach name but no matching coach found
      noCoach: 0,              // Already had null/empty coach
    };

    const orphanedCoaches = [];  // Students with coach names that don't exist

    // Process each student
    for (const student of students) {
      // Skip if no coach assigned
      if (!student.coach) {
        stats.noCoach++;
        continue;
      }

      const coachValue = String(student.coach).trim();

      // Skip empty strings
      if (coachValue === '') {
        stats.noCoach++;
        continue;
      }

      // Check if already a valid ObjectId
      if (mongoose.Types.ObjectId.isValid(coachValue)) {
        // Verify the ObjectId format (24 hex characters)
        if (/^[0-9a-fA-F]{24}$/.test(coachValue)) {
          stats.alreadyMigrated++;
          continue;
        }
      }

      // It's a coach name - try to find matching coach
      const matchingCoach = coaches.find(coach =>
        `${coach.firstName} ${coach.lastName}` === coachValue
      );

      if (matchingCoach) {
        // Found matching coach - update to ObjectId
        student.coach = matchingCoach._id.toString();
        await student.save();

        stats.migratedByName++;
        console.log(`✓ Migrated: ${student.firstName} ${student.lastName} → Coach: ${coachValue} → ${matchingCoach._id}`);
      } else {
        // No matching coach found - set to null
        orphanedCoaches.push({
          studentId: student._id,
          studentName: `${student.firstName} ${student.lastName}`,
          coachName: coachValue
        });

        student.coach = null;
        await student.save();

        stats.setToNull++;
        console.log(`⚠ Orphaned: ${student.firstName} ${student.lastName} had coach "${coachValue}" (not found) → set to null`);
      }
    }

    // Print migration summary
    console.log('\n' + '='.repeat(60));
    console.log('📋 MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Students:           ${stats.totalStudents}`);
    console.log(`Already Using ObjectIds:  ${stats.alreadyMigrated} ✅`);
    console.log(`Migrated from Name:       ${stats.migratedByName} 🔄`);
    console.log(`Set to Null (Orphaned):   ${stats.setToNull} ⚠️`);
    console.log(`No Coach Assigned:        ${stats.noCoach} -`);
    console.log('='.repeat(60));

    // Print orphaned coaches report
    if (orphanedCoaches.length > 0) {
      console.log('\n⚠️  ORPHANED COACH REFERENCES:');
      console.log('These students had coach names that don\'t match any existing coach:');
      console.log('-'.repeat(60));
      orphanedCoaches.forEach(item => {
        console.log(`  • ${item.studentName} (${item.studentId})`);
        console.log(`    Coach name: "${item.coachName}"`);
      });
      console.log('-'.repeat(60));
      console.log('Action: All set to null. You may want to manually assign coaches.\n');
    }

    // Verification step
    console.log('\n🔍 Verifying migration...');
    const remainingNameCoaches = await Student.find({
      coach: { $exists: true, $ne: null, $type: 'string' }
    });

    const invalidCoaches = remainingNameCoaches.filter(student => {
      const coachValue = String(student.coach).trim();
      return !mongoose.Types.ObjectId.isValid(coachValue) ||
             !/^[0-9a-fA-F]{24}$/.test(coachValue);
    });

    if (invalidCoaches.length === 0) {
      console.log('✅ Verification passed: All coach references are now valid ObjectIds or null\n');
    } else {
      console.log(`⚠️  Warning: ${invalidCoaches.length} students still have invalid coach references:`);
      invalidCoaches.forEach(s => {
        console.log(`  • ${s.firstName} ${s.lastName}: "${s.coach}"`);
      });
      console.log();
    }

    console.log('✅ Migration completed successfully!\n');

    // Save migration report
    const report = {
      date: new Date().toISOString(),
      stats,
      orphanedCoaches,
      success: true
    };

    console.log('📄 Migration report:');
    console.log(JSON.stringify(report, null, 2));

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    // Close database connection
    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');
    process.exit(0);
  }
};

// Run migration
migrateCoachData();
