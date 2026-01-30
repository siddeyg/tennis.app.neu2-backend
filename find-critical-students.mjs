import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config({ path: './.env.development' });
await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/tennis-coach');

const Student = mongoose.model('Student', new mongoose.Schema({}, { strict: false }), 'students');
const Coach = mongoose.model('Coach', new mongoose.Schema({}, { strict: false }), 'coaches');

console.log('\n=== FINDING CRITICALLY CONSTRAINED STUDENTS ===\n');

const allStudents = await Student.find();
const allCoaches = await Coach.find();

// Find students with ≤2 available times
const constrainedStudents = allStudents.filter(s =>
  s.availableTimes && s.availableTimes.length <= 2
);

console.log(`Found ${constrainedStudents.length} students with ≤2 available time slots:\n`);

for (const student of constrainedStudents) {
  const level = student.adult ? student.skillLevel : student.trainigGroup;
  const flex = student.availableTimes?.length || 0;
  const assigned = student.day && student.hour;

  console.log(`${assigned ? '✅' : '❌'} ${student.firstName} ${student.lastName} (${level}, ${flex} slots)`);

  if (!assigned) {
    console.log(`   Available times: ${student.availableTimes.join(', ')}`);

    // For each time, check how many OTHER students want it
    for (const timeToken of student.availableTimes) {
      const [day, hourStr] = timeToken.split(' ');
      const hour = parseInt(hourStr);

      // Count students assigned there
      const assignedThere = await Student.countDocuments({ day, hour });

      // Count students who WANT that slot (have it in availableTimes)
      const wantThisSlot = allStudents.filter(s =>
        s.availableTimes && s.availableTimes.includes(timeToken)
      );

      console.log(`   ${timeToken}: ${assignedThere}/4 filled, ${wantThisSlot.length} total want it`);
    }
    console.log();
  }
}

console.log('\n=== RECOMMENDATION ===\n');
console.log('We need a PRE-PHASE before Phase 1:');
console.log('PHASE 0: Reserve slots for critically constrained students (≤2 time slots)');
console.log('  - Process ONLY students with 1-2 available times FIRST');
console.log('  - Create courses for them (even if not full 4-student courses)');
console.log('  - This guarantees they get ONE of their limited slots');
console.log('  - THEN run normal Phase 1 for everyone else\n');

await mongoose.connection.close();
