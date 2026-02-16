import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config({ path: './.env.development' });
await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/tennis-coach');

const Student = mongoose.model('Student', new mongoose.Schema({}, { strict: false }), 'students');
const Coach = mongoose.model('Coach', new mongoose.Schema({}, { strict: false }), 'coaches');

console.log('\n=== ANALYZING SMALL COURSES FOR CONSOLIDATION ===\n');

// Get all students and group by day/hour/coach
const allStudents = await Student.find({ day: { $ne: null }, hour: { $ne: null } });
const allCoaches = await Coach.find();

// Create course map
const courses = new Map();

for (const student of allStudents) {
  const key = `${student.day}-${student.hour}-${student.coach}`;
  if (!courses.has(key)) {
    courses.set(key, {
      day: student.day,
      hour: student.hour,
      coach: student.coach,
      students: []
    });
  }
  courses.get(key).students.push(student);
}

// Analyze course size distribution
const courseSizes = { 1: [], 2: [], 3: [], 4: [] };

for (const [key, course] of courses.entries()) {
  const size = course.students.length;
  if (size <= 4) {
    courseSizes[size].push(course);
  }
}

console.log('📊 Course Size Distribution:\n');
console.log(`   4 students: ${courseSizes[4].length} courses (${courseSizes[4].length * 4} students)`);
console.log(`   3 students: ${courseSizes[3].length} courses (${courseSizes[3].length * 3} students)`);
console.log(`   2 students: ${courseSizes[2].length} courses (${courseSizes[2].length * 2} students)`);
console.log(`   1 student:  ${courseSizes[1].length} courses (${courseSizes[1].length * 1} students)`);

const totalSmallCourses = courseSizes[1].length + courseSizes[2].length;
const totalStudentsInSmallCourses = courseSizes[1].length + (courseSizes[2].length * 2);

console.log(`\n⚠️  Small courses (1-2 students): ${totalSmallCourses} courses, ${totalStudentsInSmallCourses} students`);

// Analyze consolidation opportunities
console.log('\n\n=== CONSOLIDATION OPPORTUNITIES ===\n');

// For each small course, check if students could join other courses
for (const course of [...courseSizes[1], ...courseSizes[2]]) {
  console.log(`--- ${course.day} ${course.hour} (${course.students.length} students) ---`);

  for (const student of course.students) {
    const level = student.adult ? student.skillLevel : student.trainigGroup;
    const gender = student.sex || 'unknown';
    const flex = student.availableTimes?.length || 0;

    console.log(`\n${student.firstName} ${student.lastName} (${level}, ${gender}, ${flex} available times)`);
    console.log(`Available times: ${student.availableTimes?.map(t => `${t.day} ${t.hour}`).join(', ') || 'None'}`);

    // Find other courses this student could join
    const compatibleCourses = [];

    for (const timeSlot of (student.availableTimes || [])) {
      const day = timeSlot.day;
      const hour = Number(timeSlot.hour);

      // Skip current assignment
      if (day === course.day && hour === course.hour) continue;

      // Find courses at this time
      for (const [key, targetCourse] of courses.entries()) {
        if (targetCourse.day !== day || targetCourse.hour !== hour) continue;
        if (targetCourse.students.length >= 4) continue; // Full course

        // Check compatibility
        const allCompatible = targetCourse.students.every(s => {
          // Adult/child mixing check
          if (s.adult !== student.adult) return false;

          // Gender check (adults only)
          if (student.adult && s.sex !== student.sex) return false;

          // Level check
          if (student.adult) {
            return s.skillLevel === student.skillLevel;
          } else {
            return s.trainigGroup === student.trainigGroup;
          }
        });

        if (allCompatible) {
          compatibleCourses.push({
            day,
            hour,
            size: targetCourse.students.length,
            students: targetCourse.students.map(s => `${s.firstName} ${s.lastName}`).join(', ')
          });
        }
      }
    }

    if (compatibleCourses.length > 0) {
      console.log(`   ✅ Can join ${compatibleCourses.length} other courses:`);
      compatibleCourses.forEach(c => {
        console.log(`      → ${c.day} ${c.hour} (${c.size}/4 students): ${c.students}`);
      });
    } else {
      console.log(`   ❌ No compatible courses found`);
    }
  }
  console.log();
}

// Calculate potential savings
console.log('\n=== CONSOLIDATION POTENTIAL ===\n');

let movableStudents = 0;
let potentiallyFreedCourses = 0;

for (const course of [...courseSizes[1], ...courseSizes[2]]) {
  let allMovable = true;

  for (const student of course.students) {
    let hasCompatibleCourse = false;

    for (const timeSlot of (student.availableTimes || [])) {
      const day = timeSlot.day;
      const hour = Number(timeSlot.hour);

      if (day === course.day && hour === course.hour) continue;

      for (const [key, targetCourse] of courses.entries()) {
        if (targetCourse.day !== day || targetCourse.hour !== hour) continue;
        if (targetCourse.students.length >= 4) continue;

        const allCompatible = targetCourse.students.every(s => {
          if (s.adult !== student.adult) return false;
          if (student.adult && s.sex !== student.sex) return false;
          if (student.adult) return s.skillLevel === student.skillLevel;
          return s.trainigGroup === student.trainigGroup;
        });

        if (allCompatible) {
          hasCompatibleCourse = true;
          break;
        }
      }

      if (hasCompatibleCourse) break;
    }

    if (hasCompatibleCourse) {
      movableStudents++;
    } else {
      allMovable = false;
    }
  }

  if (allMovable) {
    potentiallyFreedCourses++;
  }
}

console.log(`Movable students: ${movableStudents}/${totalStudentsInSmallCourses}`);
console.log(`Courses that could be eliminated: ${potentiallyFreedCourses}/${totalSmallCourses}`);
console.log(`\nPotential savings: ${potentiallyFreedCourses} coach hours per week`);

if (movableStudents > 0) {
  console.log(`\n💡 RECOMMENDATION: Implement Phase 6 - Course Consolidation`);
  console.log(`   - After Phase 5, iterate through small courses (1-2 students)`);
  console.log(`   - Try to move students to compatible courses with space`);
  console.log(`   - Prefer moves that empty courses entirely (save coach hours)`);
  console.log(`   - Expected result: ${potentiallyFreedCourses} fewer courses, better efficiency`);
}

await mongoose.connection.close();
