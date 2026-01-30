import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config({ path: './.env.development' });
await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/tennis-coach');

const Student = mongoose.model('Student', new mongoose.Schema({}, { strict: false }), 'students');

console.log('\n=== Priority Fix Verification ===\n');

// Find the 3 students who were being blocked
const blockedStudents = [
  { firstName: 'Josef', lastName: 'Wong' },
  { firstName: 'Maja', lastName: 'Dietzler' },
  { firstName: 'Joris', lastName: 'Muck' }
];

console.log('Checking assignment status of previously blocked students:\n');

let allAssigned = true;

for (const { firstName, lastName } of blockedStudents) {
  const student = await Student.findOne({ firstName, lastName });

  if (!student) {
    console.log(`❌ Student not found: ${firstName} ${lastName}`);
    continue;
  }

  const availableTimesCount = student.availableTimes?.length || 0;
  const isAssigned = student.day && student.hour;

  if (isAssigned) {
    console.log(`✅ ${firstName} ${lastName}:`);
    console.log(`   Flexibility: ${availableTimesCount} time slots`);
    console.log(`   ASSIGNED: ${student.day} ${student.hour}`);
    console.log(`   Coach: ${student.coach || 'Not set'}\n`);
  } else {
    console.log(`❌ ${firstName} ${lastName}:`);
    console.log(`   Flexibility: ${availableTimesCount} time slots`);
    console.log(`   STILL UNASSIGNED`);
    console.log(`   Available times: ${student.availableTimes?.join(', ') || 'None'}\n`);
    allAssigned = false;
  }
}

// Check overall assignment statistics
const totalStudents = await Student.countDocuments();
const assignedStudents = await Student.countDocuments({ day: { $ne: null }, hour: { $ne: null } });
const unassignedStudents = totalStudents - assignedStudents;

console.log('=== Overall Statistics ===\n');
console.log(`Total Students: ${totalStudents}`);
console.log(`Assigned: ${assignedStudents} (${(assignedStudents / totalStudents * 100).toFixed(1)}%)`);
console.log(`Unassigned: ${unassignedStudents}`);

// Expected vs actual
const expectedUnassigned = 7; // After fix (3 blocked students should now be assigned)
const beforeFixUnassigned = 10;

console.log(`\nExpected after fix: ≤${expectedUnassigned} unassigned`);
console.log(`Before fix: ${beforeFixUnassigned} unassigned`);

if (unassignedStudents <= expectedUnassigned) {
  console.log(`\n✅ SUCCESS: Unassigned count is within expected range!`);
} else {
  console.log(`\n⚠️  WARNING: Unassigned count (${unassignedStudents}) is higher than expected (${expectedUnassigned})`);
}

// Verify priority sorting worked
if (allAssigned) {
  console.log(`✅ SUCCESS: All 3 previously blocked students are NOW ASSIGNED!`);
  console.log('   Priority-based sorting is working correctly.\n');
} else {
  console.log(`❌ FAILURE: Some blocked students are still unassigned.`);
  console.log('   Priority-based sorting may need further investigation.\n');
}

await mongoose.connection.close();
