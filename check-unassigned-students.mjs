import mongoose from 'mongoose';
import Student from './src/models/Student.js';
import Coach from './src/models/Coach.js';

await mongoose.connect('mongodb://localhost:27017/tennis-coach');

console.log('\n=== ANALYZING UNASSIGNED STUDENTS ===\n');

const students = await Student.find({}).lean();
const coaches = await Coach.find({}).lean();

// Find students without day/hour assignment
const unassigned = students.filter(s => !s.day || !s.hour);

console.log(`Total Students: ${students.length}`);
console.log(`Assigned: ${students.length - unassigned.length}`);
console.log(`Unassigned: ${unassigned.length}\n`);

if (unassigned.length === 0) {
  console.log('✅ All students are assigned!');
  await mongoose.connection.close();
  process.exit(0);
}

console.log('=== UNASSIGNED STUDENTS DETAILS ===\n');

unassigned.forEach((student, index) => {
  console.log(`${index + 1}. ${student.firstName} ${student.lastName}`);
  console.log(`   Type: ${student.adult ? 'ADULT' : 'CHILD'}`);

  if (student.adult) {
    console.log(`   Gender: ${student.sex || '⚠️  MISSING'}`);
    console.log(`   Skill Level: ${student.skillLevel || '⚠️  MISSING'}`);
  } else {
    console.log(`   Training Group: ${student.trainigGroup || '⚠️  MISSING'}`);
  }

  console.log(`   Available Times: ${(student.availableTimes || []).length}`);

  if (!student.availableTimes || student.availableTimes.length === 0) {
    console.log(`   ❌ NO AVAILABLE TIMES - Cannot be assigned!`);
  } else {
    console.log(`   Times: ${student.availableTimes.join(', ')}`);

    // Check if coaches are available at these times
    const coachAvailability = {};
    student.availableTimes.forEach(timeSlot => {
      const availableCoaches = coaches.filter(c => {
        const hasTime = c.availableTimes.includes(timeSlot);
        const canTeach = student.adult ? c.isCoachingAdult : c.isCoachingChildren;
        return hasTime && canTeach;
      });

      coachAvailability[timeSlot] = availableCoaches.length;
    });

    console.log(`   Coach Availability:`);
    Object.entries(coachAvailability).forEach(([time, count]) => {
      if (count === 0) {
        console.log(`     ❌ ${time}: NO COACHES AVAILABLE`);
      } else {
        console.log(`     ✅ ${time}: ${count} coach(es) available`);
      }
    });
  }

  console.log('');
});

// Summary analysis
console.log('=== SUMMARY ANALYSIS ===\n');

const noAvailableTimes = unassigned.filter(s => !s.availableTimes || s.availableTimes.length === 0);
const noCoaches = unassigned.filter(s => {
  if (!s.availableTimes || s.availableTimes.length === 0) return false;

  return s.availableTimes.every(timeSlot => {
    const availableCoaches = coaches.filter(c => {
      const hasTime = c.availableTimes.includes(timeSlot);
      const canTeach = s.adult ? c.isCoachingAdult : c.isCoachingChildren;
      return hasTime && canTeach;
    });
    return availableCoaches.length === 0;
  });
});

const limitedTimes = unassigned.filter(s =>
  s.availableTimes && s.availableTimes.length > 0 && s.availableTimes.length <= 2
);

const adultUnassigned = unassigned.filter(s => s.adult);
const childUnassigned = unassigned.filter(s => !s.adult);

console.log(`Adults: ${adultUnassigned.length}`);
console.log(`Children: ${childUnassigned.length}\n`);

console.log(`❌ No available times set: ${noAvailableTimes.length}`);
console.log(`❌ No coaches available at any time: ${noCoaches.length}`);
console.log(`⚠️  Limited availability (≤2 time slots): ${limitedTimes.length}\n`);

if (noAvailableTimes.length > 0) {
  console.log('Students without available times:');
  noAvailableTimes.forEach(s => {
    console.log(`  - ${s.firstName} ${s.lastName} (${s.adult ? s.skillLevel : s.trainigGroup})`);
  });
  console.log('');
}

if (noCoaches.length > 0) {
  console.log('Students with no coach availability:');
  noCoaches.forEach(s => {
    console.log(`  - ${s.firstName} ${s.lastName} (${s.adult ? s.skillLevel : s.trainigGroup})`);
    console.log(`    Times: ${s.availableTimes.join(', ')}`);
  });
  console.log('');
}

// Check for gender matching issues in adults
if (adultUnassigned.length > 0) {
  console.log('=== ADULT GROUPING ANALYSIS ===\n');

  const adultGroups = {};
  students.filter(s => s.adult).forEach(s => {
    const gender = s.sex || 'unknown';
    const key = `${gender}_${s.skillLevel}`;
    if (!adultGroups[key]) {
      adultGroups[key] = { assigned: [], unassigned: [] };
    }

    if (!s.day || !s.hour) {
      adultGroups[key].unassigned.push(s);
    } else {
      adultGroups[key].assigned.push(s);
    }
  });

  Object.keys(adultGroups).sort().forEach(key => {
    const group = adultGroups[key];
    const total = group.assigned.length + group.unassigned.length;

    if (group.unassigned.length > 0) {
      console.log(`${key}: ${group.assigned.length}/${total} assigned`);
      group.unassigned.forEach(s => {
        console.log(`  ❌ ${s.firstName} ${s.lastName} - ${s.availableTimes?.length || 0} time slots`);
      });
    }
  });
}

await mongoose.connection.close();
