import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const plan = JSON.parse(fs.readFileSync(join(__dirname, 'correct-optimal-plan.json'), 'utf8'));

console.log('🔍 Verifying NO parallel courses...\n');

// Check Samstag 12:00 (the problematic slot from before)
console.log('📍 Samstag 12:00:');
const samstag12 = plan.courses.filter(c => c.day === 'Samstag' && c.hour === 12);
console.log('   Courses:', samstag12.length);
samstag12.forEach(c => {
  const groups = c.students.map(s => s.adult ? s.skillLevel : s.trainigGroup).join(', ');
  console.log(`   - Coach: ${c.coach} | Students: ${c.numStudents} | Groups: ${groups}`);
});

// Check all time slots for coach conflicts
console.log('\n🔍 Scanning ALL time slots for coach conflicts...\n');
const timeSlots = new Map();

for (const course of plan.courses) {
  const key = `${course.day} ${course.hour}`;
  if (!timeSlots.has(key)) timeSlots.set(key, []);
  timeSlots.get(key).push(course);
}

let conflicts = 0;
for (const [time, courses] of timeSlots) {
  const coaches = new Map();
  for (const course of courses) {
    const count = coaches.get(course.coach) || 0;
    coaches.set(course.coach, count + 1);
  }

  for (const [coach, count] of coaches) {
    if (count > 1) {
      console.log(`❌ CONFLICT at ${time}: ${coach} has ${count} courses`);
      conflicts++;
    }
  }
}

if (conflicts === 0) {
  console.log('✅ NO CONFLICTS FOUND - Each coach has max 1 course per time slot!\n');
} else {
  console.log(`\n❌ Found ${conflicts} coach conflicts!\n`);
}

// Show statistics
console.log('📊 Plan Statistics:');
console.log('   Total Courses:', plan.metadata.totalCourses);
console.log('   Full Courses (4):', plan.metadata.fullCourses);
console.log('   Three Courses (3):', plan.metadata.threeCourses);
console.log('   Two Courses (2):', plan.metadata.twoCourses);
console.log('   Single Courses (1):', plan.metadata.singleCourses);
console.log('   Efficiency:', plan.metadata.efficiency);
console.log('   Assigned Students:', plan.metadata.assignedStudents, '/', plan.metadata.totalStudents);

// Compare with perfect-optimal-plan.json (the flawed one)
console.log('\n📊 Comparison with previous flawed plan:');
try {
  const oldPlan = JSON.parse(fs.readFileSync(join(__dirname, 'perfect-optimal-plan.json'), 'utf8'));

  console.log('\n   OLD PLAN (perfect-optimal-plan.json):');
  console.log('   - Total Courses:', oldPlan.metadata.totalCourses);
  console.log('   - Full Courses:', oldPlan.metadata.fullCourses);
  console.log('   - Assigned Students:', oldPlan.metadata.assignedStudents);

  // Check old plan for parallel courses
  const oldTimeSlots = new Map();
  for (const course of oldPlan.courses) {
    const key = `${course.day} ${course.hour}`;
    if (!oldTimeSlots.has(key)) oldTimeSlots.set(key, []);
    oldTimeSlots.get(key).push(course);
  }

  let oldConflicts = 0;
  for (const [time, courses] of oldTimeSlots) {
    const coaches = new Map();
    for (const course of courses) {
      const count = coaches.get(course.coach) || 0;
      coaches.set(course.coach, count + 1);
    }

    for (const [coach, count] of coaches) {
      if (count > 1) {
        oldConflicts++;
      }
    }
  }

  console.log('   - Parallel Courses:', oldConflicts > 0 ? `❌ ${oldConflicts} conflicts` : '✅ None');

  console.log('\n   NEW PLAN (correct-optimal-plan.json):');
  console.log('   - Total Courses:', plan.metadata.totalCourses);
  console.log('   - Full Courses:', plan.metadata.fullCourses);
  console.log('   - Assigned Students:', plan.metadata.assignedStudents);
  console.log('   - Parallel Courses:', conflicts > 0 ? `❌ ${conflicts} conflicts` : '✅ None');

  console.log('\n   DIFFERENCE:');
  console.log('   - Courses:', plan.metadata.totalCourses - oldPlan.metadata.totalCourses, oldPlan.metadata.totalCourses > plan.metadata.totalCourses ? '(more realistic with constraint)' : '');
  console.log('   - Full Courses:', plan.metadata.fullCourses - oldPlan.metadata.fullCourses);
  console.log('   - Assigned:', plan.metadata.assignedStudents - oldPlan.metadata.assignedStudents);
  console.log('   - Parallel Course Fix:', oldConflicts > 0 && conflicts === 0 ? '✅ FIXED' : conflicts > 0 ? '❌ Still broken' : '✅ Both correct');

} catch (error) {
  console.log('   (Could not compare - old plan not found)');
}
