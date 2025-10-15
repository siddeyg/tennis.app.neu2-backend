import mongoose from 'mongoose';
import SavedSchedule from './src/models/SavedSchedule.js';

await mongoose.connect('mongodb://localhost:27017/tennis-coach');

console.log('\n=== CHECKING FOR GENDER VIOLATIONS ===\n');

// Get most recent saved schedule
const latestPlan = await SavedSchedule.findById('68efa7b08639e52519a322fc');

if (!latestPlan) {
  console.log('❌ No saved plans found');
  process.exit(1);
}

console.log(`📄 Analyzing: ${latestPlan.name}\n`);

let genderViolations = 0;
let adultCoursesChecked = 0;
let childCourses = 0;

latestPlan.schedule.forEach((course, index) => {
  const courseStudents = latestPlan.students.filter(s =>
    course.students.includes(s._id)
  );

  // Check if course has adults
  const hasAdults = courseStudents.some(s => s.adult);

  if (!hasAdults) {
    childCourses++;
    return; // Skip children courses
  }

  adultCoursesChecked++;

  // Check for mixed gender in adult courses
  const genders = courseStudents
    .filter(s => s.adult)
    .map(s => s.sex)
    .filter(Boolean);

  const uniqueGenders = [...new Set(genders)];

  if (uniqueGenders.length > 1) {
    genderViolations++;
    console.log(`❌ GENDER VIOLATION - Course #${index + 1}:`);
    console.log(`   ${course.day} ${course.hour}:00 - ${course.coachName}`);
    console.log(`   Genders: ${uniqueGenders.join(', ')}`);
    courseStudents.forEach(s => {
      if (s.adult) {
        console.log(`   • ${s.firstName} ${s.lastName} (${s.sex || 'NO GENDER'}, ${s.skillLevel})`);
      }
    });
    console.log('');
  }

  // Check for missing gender
  const missingGender = courseStudents.filter(s => s.adult && (!s.sex || s.sex === ''));
  if (missingGender.length > 0) {
    console.log(`⚠️  MISSING GENDER - Course #${index + 1}:`);
    console.log(`   ${course.day} ${course.hour}:00`);
    missingGender.forEach(s => {
      console.log(`   • ${s.firstName} ${s.lastName} (NO GENDER SET)`);
    });
    console.log('');
  }
});

console.log('\n=== SUMMARY ===\n');
console.log(`Total Courses: ${latestPlan.schedule.length}`);
console.log(`Adult Courses Checked: ${adultCoursesChecked}`);
console.log(`Child Courses (skipped): ${childCourses}`);
console.log(`\n❌ Gender Violations: ${genderViolations}`);

if (genderViolations === 0) {
  console.log('\n✅ NO GENDER VIOLATIONS FOUND!');
  console.log('   Algorithm correctly respects gender matching for adults.\n');
} else {
  console.log(`\n⚠️  FOUND ${genderViolations} COURSES WITH MIXED GENDER`);
  console.log('   Algorithm needs to be updated to respect gender matching.\n');
}

await mongoose.connection.close();
