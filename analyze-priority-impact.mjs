import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config({ path: './.env.development' });
await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/tennis-coach');

const Student = mongoose.model('Student', new mongoose.Schema({}, { strict: false }), 'students');

console.log('\n=== PRIORITY SORTING IMPACT ANALYSIS ===\n');

// Get all students with their flexibility
const allStudents = await Student.find();

// Group students by level/group and gender (adults)
const groups = new Map();

for (const student of allStudents) {
  let key;
  if (student.adult) {
    const gender = student.sex || 'unknown';
    key = `adult-${gender}-${student.skillLevel}`;
  } else {
    key = `child-${student.trainigGroup}`;
  }

  if (!groups.has(key)) {
    groups.set(key, []);
  }
  groups.get(key).push(student);
}

// Analyze each group's flexibility distribution
console.log('Group Flexibility Analysis:\n');

for (const [groupKey, students] of groups.entries()) {
  const flexScores = students.map(s => ({
    name: `${s.firstName} ${s.lastName}`,
    flexibility: s.availableTimes?.length || 0,
    assigned: !!(s.day && s.hour)
  }));

  flexScores.sort((a, b) => a.flexibility - b.flexibility);

  const avgFlex = flexScores.reduce((sum, s) => sum + s.flexibility, 0) / students.length;
  const assignedCount = flexScores.filter(s => s.assigned).length;

  console.log(`${groupKey} (${students.length} students, avg ${avgFlex.toFixed(1)} slots):`);
  console.log(`  Assigned: ${assignedCount}/${students.length} (${(assignedCount / students.length * 100).toFixed(1)}%)`);

  // Show least flexible students
  console.log(`  Least flexible:`);
  flexScores.slice(0, 3).forEach(s => {
    const status = s.assigned ? '✅' : '❌';
    console.log(`    ${status} ${s.name} (${s.flexibility} slots)`);
  });

  console.log();
}

// Find "opportunities" (same as algorithm does)
console.log('\n=== SIMULATING PHASE 1 OPPORTUNITIES ===\n');

const opportunities = [];

for (const [groupKey, students] of groups.entries()) {
  // Find all time slots where 4+ students from this group overlap
  const timeSlotMap = new Map();

  for (const student of students) {
    if (!student.availableTimes) continue;

    for (const timeToken of student.availableTimes) {
      if (!timeSlotMap.has(timeToken)) {
        timeSlotMap.set(timeToken, []);
      }
      timeSlotMap.get(timeToken).push(student);
    }
  }

  for (const [timeToken, studentsAtTime] of timeSlotMap.entries()) {
    if (studentsAtTime.length >= 4) {
      const avgFlex = studentsAtTime.reduce((sum, s) =>
        sum + (s.availableTimes?.length || 0), 0) / studentsAtTime.length;

      opportunities.push({
        groupKey,
        timeToken,
        count: studentsAtTime.length,
        avgFlex,
        students: studentsAtTime
      });
    }
  }
}

// Sort by priority (same as algorithm)
opportunities.sort((a, b) => {
  if (Math.abs(a.avgFlex - b.avgFlex) > 1) {
    return a.avgFlex - b.avgFlex;
  }
  return b.count - a.count;
});

console.log('Top 20 opportunities (by priority sorting):\n');

opportunities.slice(0, 20).forEach((opp, i) => {
  const assignedCount = opp.students.filter(s => s.day && s.hour).length;
  console.log(`${i + 1}. ${opp.groupKey} @ ${opp.timeToken}:`);
  console.log(`   ${opp.count} students, avg ${opp.avgFlex.toFixed(1)} slots`);
  console.log(`   Assigned from this opportunity: ${assignedCount}/${opp.count}`);
  console.log();
});

console.log('\n=== KEY INSIGHT ===\n');
console.log('If too many LOW flexibility opportunities are processed first,');
console.log('they may use up coaches before LARGE high-value opportunities');
console.log('(e.g., 20 students at one slot) can create multiple full courses.\n');

await mongoose.connection.close();
