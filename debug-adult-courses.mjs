import mongoose from 'mongoose';
import SavedSchedule from './src/models/SavedSchedule.js';

await mongoose.connect('mongodb://localhost:27017/tennis-coach');

const plan = await SavedSchedule.findById('68efa7b08639e52519a322fc');

console.log('\n=== DEBUG: ADULT COURSE ASSIGNMENT ===\n');

const adults = plan.students.filter(s => s.adult);
console.log(`Total Adults in Plan: ${adults.length}\n`);

let assignedAdults = 0;
let unassignedAdults = 0;

adults.forEach(adult => {
  const assignedCourse = plan.schedule.find(c => c.students.includes(adult._id));

  if (assignedCourse) {
    assignedAdults++;
    console.log(`✅ ${adult.firstName} ${adult.lastName} (${adult.sex}, ${adult.skillLevel})`);
    console.log(`   → ${assignedCourse.day} ${assignedCourse.hour}:00 with ${assignedCourse.coachName}`);

    // Check other students in same course
    const coursemates = plan.students.filter(s => assignedCourse.students.includes(s._id));
    console.log(`   Course has ${coursemates.length} students:`);
    coursemates.forEach(cm => {
      console.log(`     - ${cm.firstName} ${cm.lastName} (${cm.adult ? 'ADULT':'CHILD'}, ${cm.adult ? cm.skillLevel : cm.trainigGroup}, ${cm.sex || 'no gender'})`);
    });
    console.log('');
  } else {
    unassignedAdults++;
    console.log(`❌ UNASSIGNED: ${adult.firstName} ${adult.lastName} (${adult.sex}, ${adult.skillLevel})`);
  }
});

console.log(`\nSUMMARY:`);
console.log(`Assigned Adults: ${assignedAdults}`);
console.log(`Unassigned Adults: ${unassignedAdults}`);

await mongoose.connection.close();
