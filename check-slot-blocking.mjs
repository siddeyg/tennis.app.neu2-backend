import mongoose from 'mongoose';
import Student from './src/models/Student.js';

await mongoose.connect('mongodb://localhost:27017/tennis-coach');

console.log('\n=== CHECKING FOR SLOT BLOCKING ===\n');

const students = await Student.find({}).lean();

// Find students with limited availability (≤2 slots)
const limitedStudents = students.filter(s =>
  s.availableTimes && s.availableTimes.length <= 2
);

console.log(`Students with ≤2 available time slots: ${limitedStudents.length}\n`);

// For each limited student, check if their slots are occupied by students with MORE options
let blockingCases = 0;

limitedStudents.forEach(limitedStudent => {
  // Skip if not assigned
  if (!limitedStudent.day || !limitedStudent.hour) return;

  const assignedSlot = `${limitedStudent.day} ${limitedStudent.hour}`;

  // Find other students at the same time slot
  const sameSlotStudents = students.filter(s =>
    s.day === limitedStudent.day &&
    s.hour === limitedStudent.hour &&
    String(s._id) !== String(limitedStudent._id)
  );

  // Check if same slot has students with MORE available times
  const blockingStudents = sameSlotStudents.filter(s =>
    (s.availableTimes?.length || 0) > limitedStudent.availableTimes.length
  );

  if (blockingStudents.length > 0) {
    console.log(`⚠️  ${limitedStudent.firstName} ${limitedStudent.lastName} (${limitedStudent.trainigGroup || limitedStudent.skillLevel})`);
    console.log(`   Has ${limitedStudent.availableTimes.length} slots: ${limitedStudent.availableTimes.map(t => `${t.day} ${t.hour}`).join(', ')}`);
    console.log(`   Assigned to: ${assignedSlot}`);
    console.log(`   Sharing course with ${blockingStudents.length} students who have MORE options:`);

    blockingStudents.forEach(blocker => {
      const otherSlots = blocker.availableTimes.filter(t => `${t.day} ${t.hour}` !== assignedSlot);
      console.log(`     • ${blocker.firstName} ${blocker.lastName}: ${blocker.availableTimes.length} slots (could use: ${otherSlots.map(t => `${t.day} ${t.hour}`).join(', ')})`);
    });
    console.log('');
    blockingCases++;
  }
});

console.log(`\n=== SUMMARY ===`);
console.log(`Found ${blockingCases} cases where limited-availability students share courses with flexible students\n`);

// Now check the opposite: Students with limited availability who are UNASSIGNED
// while their slots are occupied by flexible students

const unassignedLimited = limitedStudents.filter(s => !s.day || !s.hour);

console.log(`\n=== UNASSIGNED LIMITED-AVAILABILITY STUDENTS ===\n`);
console.log(`Count: ${unassignedLimited.length}\n`);

unassignedLimited.forEach(student => {
  console.log(`❌ ${student.firstName} ${student.lastName} (${student.trainigGroup || student.skillLevel})`);
  console.log(`   Available times (${student.availableTimes?.length || 0}): ${student.availableTimes?.map(t => `${t.day} ${t.hour}`).join(', ') || 'NONE'}`);

  // Check each of their available slots
  student.availableTimes?.forEach(timeSlot => {
    const day = timeSlot.day;
    const hour = timeSlot.hour;

    // Who IS assigned at this time?
    const assignedAtSlot = students.filter(s =>
      s.day === day && s.hour === Number(hour)
    );

    const timeSlotStr = `${day} ${hour}`;
    if (assignedAtSlot.length > 0) {
      console.log(`   ${timeSlotStr}:`);

      // Find students with more flexibility
      const flexibleStudents = assignedAtSlot.filter(s =>
        (s.availableTimes?.length || 0) > (student.availableTimes?.length || 0)
      );

      if (flexibleStudents.length > 0) {
        console.log(`     ⚠️  BLOCKED by ${flexibleStudents.length} students with MORE availability:`);
        flexibleStudents.forEach(blocker => {
          const otherOptions = blocker.availableTimes.filter(t => `${t.day} ${t.hour}` !== timeSlotStr);
          console.log(`       • ${blocker.firstName} ${blocker.lastName} (${blocker.trainigGroup || blocker.skillLevel}): ${blocker.availableTimes.length} slots, could use: ${otherOptions.map(t => `${t.day} ${t.hour}`).join(', ')}`);
        });
      } else {
        console.log(`     Course full with similar-flexibility students`);
      }
    } else {
      console.log(`   ${timeSlotStr}: No courses created (no coach?)`);
    }
  });

  console.log('');
});

await mongoose.connection.close();
