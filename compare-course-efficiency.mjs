import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config({ path: './.env.development' });
await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/tennis-coach');

const Student = mongoose.model('Student', new mongoose.Schema({}, { strict: false }), 'students');

console.log('\n=== COURSE EFFICIENCY ANALYSIS ===\n');

// Get all students
const allStudents = await Student.find({ day: { $ne: null }, hour: { $ne: null } });

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

// Calculate metrics
const totalCourses = courses.size;
const totalStudents = allStudents.length;

const courseSizes = { 1: 0, 2: 0, 3: 0, 4: 0 };
courses.forEach(course => {
  const size = Math.min(course.students.length, 4);
  courseSizes[size]++;
});

// Efficiency score: weighted by course size (4 = best, 1 = worst)
const efficiencyScore = (
  (courseSizes[4] * 4) +
  (courseSizes[3] * 3) +
  (courseSizes[2] * 2) +
  (courseSizes[1] * 1)
) / totalStudents * 100;

// Utilization: how well are course slots filled?
const maxPossibleStudents = totalCourses * 4;
const utilization = (totalStudents / maxPossibleStudents) * 100;

console.log('📊 Overall Metrics:\n');
console.log(`   Total Courses: ${totalCourses}`);
console.log(`   Total Students: ${totalStudents}`);
console.log(`   Average Students per Course: ${(totalStudents / totalCourses).toFixed(2)}`);
console.log(`   Efficiency Score: ${efficiencyScore.toFixed(1)}% (100% = all 4-student courses)`);
console.log(`   Utilization: ${utilization.toFixed(1)}% (slots filled vs max capacity)`);

console.log('\n📊 Course Size Distribution:\n');
console.log(`   4 students: ${courseSizes[4]} courses (${courseSizes[4] * 4} students) - ${(courseSizes[4] / totalCourses * 100).toFixed(1)}%`);
console.log(`   3 students: ${courseSizes[3]} courses (${courseSizes[3] * 3} students) - ${(courseSizes[3] / totalCourses * 100).toFixed(1)}%`);
console.log(`   2 students: ${courseSizes[2]} courses (${courseSizes[2] * 2} students) - ${(courseSizes[2] / totalCourses * 100).toFixed(1)}%`);
console.log(`   1 student:  ${courseSizes[1]} courses (${courseSizes[1] * 1} students) - ${(courseSizes[1] / totalCourses * 100).toFixed(1)}%`);

const smallCourses = courseSizes[1] + courseSizes[2];
const studentsInSmallCourses = courseSizes[1] + (courseSizes[2] * 2);

console.log(`\n⚠️  Small Courses (1-2 students):`);
console.log(`   Count: ${smallCourses} (${(smallCourses / totalCourses * 100).toFixed(1)}% of all courses)`);
console.log(`   Students: ${studentsInSmallCourses} (${(studentsInSmallCourses / totalStudents * 100).toFixed(1)}% of all students)`);

console.log(`\n✅ Good Courses (3-4 students):`);
const goodCourses = courseSizes[3] + courseSizes[4];
const studentsInGoodCourses = (courseSizes[3] * 3) + (courseSizes[4] * 4);
console.log(`   Count: ${goodCourses} (${(goodCourses / totalCourses * 100).toFixed(1)}% of all courses)`);
console.log(`   Students: ${studentsInGoodCourses} (${(studentsInGoodCourses / totalStudents * 100).toFixed(1)}% of all students)`);

// Coach hour savings potential
console.log(`\n💰 Coach Hour Analysis:\n`);
console.log(`   Current: ${totalCourses} coach hours per week`);
console.log(`   If all 4-student: ${Math.ceil(totalStudents / 4)} coach hours (theoretical minimum)`);
console.log(`   Potential savings: ${totalCourses - Math.ceil(totalStudents / 4)} coach hours per week`);

// Quality breakdown by training group
console.log(`\n📊 By Training Group:\n`);

const groupCourses = new Map();

for (const [key, course] of courses.entries()) {
  for (const student of course.students) {
    const groupKey = student.adult ?
      `adult-${student.sex || 'unknown'}-${student.skillLevel}` :
      `child-${student.trainigGroup}`;

    if (!groupCourses.has(groupKey)) {
      groupCourses.set(groupKey, { courses: [], students: 0 });
    }

    // Only count this course once per group
    if (!groupCourses.get(groupKey).courses.includes(key)) {
      groupCourses.get(groupKey).courses.push(key);
    }
    groupCourses.get(groupKey).students++;
  }
}

// Sort by student count
const sortedGroups = Array.from(groupCourses.entries()).sort((a, b) => b[1].students - a[1].students);

sortedGroups.forEach(([group, data]) => {
  const avgSize = data.students / data.courses.length;
  console.log(`   ${group}: ${data.students} students in ${data.courses.length} courses (avg ${avgSize.toFixed(1)} students/course)`);
});

await mongoose.connection.close();
