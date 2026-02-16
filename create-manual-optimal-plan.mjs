import mongoose from 'mongoose';
import Student from './src/models/Student.js';
import Coach from './src/models/Coach.js';
import fs from 'fs';

await mongoose.connect('mongodb://localhost:27017/tennis-coach');

console.log('\n=== CREATING MANUAL OPTIMAL PLAN ===\n');

const students = await Student.find({}).lean();
const coaches = await Coach.find({}).lean();

console.log(`Total Students: ${students.length}`);
console.log(`Adults: ${students.filter(s => s.adult).length}`);
console.log(`Children: ${students.filter(s => !s.adult).length}\n`);

// Organize students by gender + skill level (adults) or training group (children)
const groups = {};

students.forEach(student => {
  let key;
  if (student.adult) {
    const gender = student.sex || 'unknown';
    key = `adult_${gender}_${student.skillLevel}`;
  } else {
    key = `child_${student.trainigGroup}`;
  }

  if (!groups[key]) {
    groups[key] = [];
  }
  groups[key].push(student);
});

console.log('=== STUDENT GROUPS ===\n');
Object.keys(groups).sort().forEach(key => {
  console.log(`${key}: ${groups[key].length} students`);
});

// Manual course assignments
const manualCourses = [];
const assigned = new Set();
let courseId = 1;

// Helper to find best common time slot for a group of students
const findBestTimeSlot = (studentList) => {
  const timeSlots = {};
  studentList.forEach(s => {
    (s.availableTimes || []).forEach(slot => {
      const key = `${slot.day} ${slot.hour}`;
      if (!timeSlots[key]) timeSlots[key] = { day: slot.day, hour: slot.hour, students: [] };
      timeSlots[key].students.push(s);
    });
  });

  return Object.values(timeSlots)
    .sort((a, b) => b.students.length - a.students.length);
};

// Helper to find suitable coach for time slot and student type
const findCoach = (day, hour, isAdult) => {
  return coaches.find(c =>
    c.availableTimes.some(slot => slot.day === day && Number(slot.hour) === Number(hour)) &&
    (isAdult ? c.isCoachingAdult : c.isCoachingChildren)
  );
};

// Helper to create a course
const createCourse = (day, hour, studentList, groupLabel) => {
  const coach = findCoach(day, hour, studentList[0].adult);

  const course = {
    id: courseId++,
    day,
    hour,
    groupLabel,
    coach: coach ? `${coach.firstName} ${coach.lastName}` : 'NO COACH AVAILABLE',
    students: studentList.map(s => ({
      id: s._id.toString(),
      name: `${s.firstName} ${s.lastName}`,
      gender: s.sex || 'unknown',
      level: s.adult ? s.skillLevel : s.trainigGroup
    }))
  };

  studentList.forEach(s => assigned.add(s._id.toString()));
  manualCourses.push(course);
  return course;
};

console.log('\n=== CREATING MANUAL COURSES ===\n');

// Process each group and create optimal courses
Object.entries(groups).sort().forEach(([groupKey, studentList]) => {
  console.log(`\n--- ${groupKey} (${studentList.length} students) ---`);

  const unassigned = studentList.filter(s => !assigned.has(s._id.toString()));
  if (unassigned.length === 0) return;

  const timeSlots = findBestTimeSlot(unassigned);

  // Strategy: Create as many 4-student courses as possible, then 3, then 2, then singles
  let remainingStudents = [...unassigned];

  for (const slot of timeSlots) {
    const availableAtSlot = remainingStudents.filter(s =>
      s.availableTimes && s.availableTimes.some(t => t.day === slot.day && Number(t.hour) === Number(slot.hour))
    );

    if (availableAtSlot.length < 2) continue; // Skip if less than 2 students

    // Create courses of 4 students first
    while (availableAtSlot.length >= 4) {
      const batch = availableAtSlot.splice(0, 4);
      const course = createCourse(slot.day, slot.hour, batch, groupKey);
      console.log(`  ✅ Course ${course.id}: ${slot.day} ${slot.hour}:00 - 4 students`);
      remainingStudents = remainingStudents.filter(s => !assigned.has(s._id.toString()));
    }
  }

  // Now handle remaining students with 3-student courses
  remainingStudents = unassigned.filter(s => !assigned.has(s._id.toString()));
  if (remainingStudents.length >= 3) {
    for (const slot of timeSlots) {
      const availableAtSlot = remainingStudents.filter(s =>
        s.availableTimes && s.availableTimes.some(t => t.day === slot.day && Number(t.hour) === Number(slot.hour))
      );

      if (availableAtSlot.length >= 3) {
        const batch = availableAtSlot.splice(0, 3);
        const course = createCourse(slot.day, slot.hour, batch, groupKey);
        console.log(`  ⚠️  Course ${course.id}: ${slot.day} ${slot.hour}:00 - 3 students`);
        remainingStudents = remainingStudents.filter(s => !assigned.has(s._id.toString()));
        break;
      }
    }
  }

  // Handle remaining with 2-student courses
  remainingStudents = unassigned.filter(s => !assigned.has(s._id.toString()));
  if (remainingStudents.length >= 2) {
    for (const slot of timeSlots) {
      const availableAtSlot = remainingStudents.filter(s =>
        s.availableTimes && s.availableTimes.some(t => t.day === slot.day && Number(t.hour) === Number(slot.hour))
      );

      if (availableAtSlot.length >= 2) {
        const batch = availableAtSlot.splice(0, 2);
        const course = createCourse(slot.day, slot.hour, batch, groupKey);
        console.log(`  ⚠️  Course ${course.id}: ${slot.day} ${slot.hour}:00 - 2 students`);
        remainingStudents = remainingStudents.filter(s => !assigned.has(s._id.toString()));
        break;
      }
    }
  }

  // Singles (last resort)
  remainingStudents = unassigned.filter(s => !assigned.has(s._id.toString()));
  remainingStudents.forEach(student => {
    if (student.availableTimes && student.availableTimes.length > 0) {
      const firstSlot = student.availableTimes[0];
      const course = createCourse(firstSlot.day, firstSlot.hour, [student], groupKey);
      console.log(`  ❌ Course ${course.id}: ${firstSlot.day} ${firstSlot.hour}:00 - 1 student (single)`);
    }
  });
});

// Calculate statistics
const stats = {
  totalCourses: manualCourses.length,
  course4: manualCourses.filter(c => c.students.length === 4).length,
  course3: manualCourses.filter(c => c.students.length === 3).length,
  course2: manualCourses.filter(c => c.students.length === 2).length,
  course1: manualCourses.filter(c => c.students.length === 1).length,
  assigned: assigned.size,
  unassigned: students.length - assigned.size,
  adultCourses: manualCourses.filter(c => c.students.some(s => s.level.includes('Anfänger') || s.level.includes('Fortgeschritten') || s.level.includes('Spieler'))).length,
  childCourses: manualCourses.filter(c => c.students.some(s => !s.level.includes('Anfänger') && !s.level.includes('Fortgeschritten') && !s.level.includes('Spieler'))).length
};

console.log('\n=== MANUAL PLAN STATISTICS ===\n');
console.log(`Total Courses: ${stats.totalCourses}`);
console.log(`  4 students: ${stats.course4} (${(stats.course4/stats.totalCourses*100).toFixed(1)}%)`);
console.log(`  3 students: ${stats.course3} (${(stats.course3/stats.totalCourses*100).toFixed(1)}%)`);
console.log(`  2 students: ${stats.course2} (${(stats.course2/stats.totalCourses*100).toFixed(1)}%)`);
console.log(`  1 student: ${stats.course1} (${(stats.course1/stats.totalCourses*100).toFixed(1)}%)`);
console.log(`\nAssigned: ${stats.assigned}/${students.length} (${(stats.assigned/students.length*100).toFixed(1)}%)`);
console.log(`Unassigned: ${stats.unassigned}`);
console.log(`\nAdult Courses: ${stats.adultCourses}`);
console.log(`Child Courses: ${stats.childCourses}`);

// Check for gender violations in adult courses
let genderViolations = 0;
manualCourses.forEach(course => {
  const isAdultCourse = course.students.some(s =>
    s.level.includes('Anfänger') || s.level.includes('Fortgeschritten') || s.level.includes('Spieler')
  );

  if (isAdultCourse) {
    const genders = [...new Set(course.students.map(s => s.gender))];
    if (genders.length > 1) {
      genderViolations++;
      console.log(`\n⚠️  GENDER VIOLATION - Course ${course.id}: ${genders.join(', ')}`);
    }
  }
});

console.log(`\n✅ Gender Violations: ${genderViolations}`);

// Save to JSON
const output = {
  metadata: {
    title: 'Manual Optimal Plan (Gender-Aware)',
    created: new Date().toISOString(),
    createdBy: 'Manual Planning',
    description: 'Hand-crafted optimal schedule with strict gender matching for adults'
  },
  statistics: stats,
  courses: manualCourses
};

fs.writeFileSync('manual-optimal-plan.json', JSON.stringify(output, null, 2));
console.log('\n✅ Saved: manual-optimal-plan.json');

await mongoose.connection.close();
process.exit(0);
