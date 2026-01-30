import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config({ path: './.env.development' });

console.log('\n=== MIGRATING STUDENTS TO ASSIGNMENTS ARRAY ===\n');

await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/tennis-coach');

const Student = mongoose.model('Student', new mongoose.Schema({}, { strict: false }), 'students');

// Get all students
const students = await Student.find();

console.log(`Found ${students.length} students to migrate\n`);

let migrated = 0;
let skipped = 0;
let errors = 0;

for (const student of students) {
  try {
    // Check if already has assignments array
    if (student.assignments && student.assignments.length > 0) {
      console.log(`⏭️  ${student.firstName} ${student.lastName}: Already has assignments array (${student.assignments.length} assignments)`);
      skipped++;
      continue;
    }

    // Check if has old format (day/hour/coach)
    if (student.day && student.hour) {
      // Migrate to new format
      const assignment = {
        day: student.day,
        hour: student.hour,
        coach: student.coach || null
      };

      // Update student with assignments array
      await Student.updateOne(
        { _id: student._id },
        {
          $set: { assignments: [assignment] }
          // Keep day/hour/coach for backward compatibility (don't delete)
        }
      );

      console.log(`✅ ${student.firstName} ${student.lastName}: Migrated ${student.day} ${student.hour} → assignments[0]`);
      migrated++;
    } else {
      // No assignment yet (unassigned student)
      await Student.updateOne(
        { _id: student._id },
        {
          $set: { assignments: [] }
        }
      );

      console.log(`📝 ${student.firstName} ${student.lastName}: Set empty assignments array (was unassigned)`);
      migrated++;
    }
  } catch (error) {
    console.error(`❌ ${student.firstName} ${student.lastName}: Error - ${error.message}`);
    errors++;
  }
}

console.log('\n=== MIGRATION COMPLETE ===\n');
console.log(`✅ Migrated: ${migrated}`);
console.log(`⏭️  Skipped (already migrated): ${skipped}`);
console.log(`❌ Errors: ${errors}`);
console.log(`📊 Total: ${students.length}\n`);

if (errors === 0) {
  console.log('🎉 Migration successful! All students now use assignments array.\n');
  console.log('ℹ️  Note: Legacy fields (day/hour/coach) are kept for backward compatibility.');
  console.log('   You can remove them later once all code is updated.\n');
} else {
  console.log('⚠️  Migration completed with errors. Please review the errors above.\n');
}

await mongoose.connection.close();
