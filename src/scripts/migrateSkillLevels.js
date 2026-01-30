import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Student from '../models/Student.js';

// Load environment variables
dotenv.config();

/**
 * Skill Level Migration Script
 *
 * This script migrates old skill level values to new standardized values:
 * - "wenig Fortgeschritten" → "Anfänger mit Grundkenntnissen"
 * - "gute:r Spieler:in" → "Erfahrene Spieler:innen / Mannschaftsspieler:innen"
 * - "Fortgeschritten" stays "Fortgeschritten"
 * - "Anfänger" stays "Anfänger"
 *
 * Usage: node src/scripts/migrateSkillLevels.js
 */

const migrateSkillLevels = async () => {
  console.log('🚀 Starting Skill Level Migration...\n');

  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Fetch all adult students (only adults have skillLevel)
    const students = await Student.find({ adult: true });

    console.log(`📊 Found ${students.length} adult students\n`);

    // Migration mapping
    const skillLevelMapping = {
      'wenig Fortgeschritten': 'Anfänger mit Grundkenntnissen',
      'gute:r Spieler:in': 'Erfahrene Spieler:innen / Mannschaftsspieler:innen'
    };

    // Migration statistics
    const stats = {
      totalAdults: students.length,
      migrated: 0,
      alreadyCorrect: 0,
      noSkillLevel: 0,
      unknown: 0
    };

    const migratedStudents = [];
    const unknownSkillLevels = [];

    // Process each student
    for (const student of students) {
      // Skip if no skill level
      if (!student.skillLevel) {
        stats.noSkillLevel++;
        continue;
      }

      const oldSkillLevel = student.skillLevel.trim();

      // Check if needs migration
      if (skillLevelMapping[oldSkillLevel]) {
        const newSkillLevel = skillLevelMapping[oldSkillLevel];
        student.skillLevel = newSkillLevel;
        await student.save();

        stats.migrated++;
        migratedStudents.push({
          studentId: student._id,
          studentName: `${student.firstName} ${student.lastName}`,
          oldValue: oldSkillLevel,
          newValue: newSkillLevel
        });

        console.log(`✓ Migrated: ${student.firstName} ${student.lastName}`);
        console.log(`  "${oldSkillLevel}" → "${newSkillLevel}"\n`);
      } else if (
        oldSkillLevel === 'Anfänger' ||
        oldSkillLevel === 'Fortgeschritten' ||
        oldSkillLevel === 'Anfänger mit Grundkenntnissen' ||
        oldSkillLevel === 'Erfahrene Spieler:innen / Mannschaftsspieler:innen' ||
        oldSkillLevel === 'Leistungsspieler:innen / Turnierspieler:innen'
      ) {
        // Already correct
        stats.alreadyCorrect++;
      } else {
        // Unknown skill level
        stats.unknown++;
        unknownSkillLevels.push({
          studentId: student._id,
          studentName: `${student.firstName} ${student.lastName}`,
          skillLevel: oldSkillLevel
        });
        console.log(`⚠ Unknown skill level: ${student.firstName} ${student.lastName} has "${oldSkillLevel}"`);
      }
    }

    // Print migration summary
    console.log('\n' + '='.repeat(60));
    console.log('📋 MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Adult Students:     ${stats.totalAdults}`);
    console.log(`Migrated:                 ${stats.migrated} 🔄`);
    console.log(`Already Correct:          ${stats.alreadyCorrect} ✅`);
    console.log(`No Skill Level:           ${stats.noSkillLevel} -`);
    console.log(`Unknown Skill Levels:     ${stats.unknown} ⚠️`);
    console.log('='.repeat(60));

    // Print migrated students
    if (migratedStudents.length > 0) {
      console.log('\n✅ MIGRATED STUDENTS:');
      console.log('-'.repeat(60));
      migratedStudents.forEach(item => {
        console.log(`  • ${item.studentName} (${item.studentId})`);
        console.log(`    "${item.oldValue}" → "${item.newValue}"`);
      });
      console.log('-'.repeat(60));
    }

    // Print unknown skill levels
    if (unknownSkillLevels.length > 0) {
      console.log('\n⚠️  UNKNOWN SKILL LEVELS:');
      console.log('These students have skill levels that don\'t match old or new values:');
      console.log('-'.repeat(60));
      unknownSkillLevels.forEach(item => {
        console.log(`  • ${item.studentName} (${item.studentId})`);
        console.log(`    Skill Level: "${item.skillLevel}"`);
      });
      console.log('-'.repeat(60));
      console.log('Action: Review and update manually if needed.\n');
    }

    // Verification step
    console.log('\n🔍 Verifying migration...');
    const studentsWithOldValues = await Student.find({
      adult: true,
      skillLevel: { $in: Object.keys(skillLevelMapping) }
    });

    if (studentsWithOldValues.length === 0) {
      console.log('✅ Verification passed: No students with old skill level values found\n');
    } else {
      console.log(`⚠️  Warning: ${studentsWithOldValues.length} students still have old skill level values:`);
      studentsWithOldValues.forEach(s => {
        console.log(`  • ${s.firstName} ${s.lastName}: "${s.skillLevel}"`);
      });
      console.log();
    }

    console.log('✅ Migration completed successfully!\n');

    // Save migration report
    const report = {
      date: new Date().toISOString(),
      stats,
      migratedStudents,
      unknownSkillLevels,
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
migrateSkillLevels();
