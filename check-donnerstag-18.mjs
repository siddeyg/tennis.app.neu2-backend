import mongoose from 'mongoose';
import Coach from './src/models/Coach.js';
import Student from './src/models/Student.js';

await mongoose.connect('mongodb://localhost:27017/tennis-coach');

console.log('\n=== CHECKING DONNERSTAG 18:00 ===\n');

const coaches = await Coach.find({}).lean();
const students = await Student.find({}).lean();

// Check which coaches are available Thursday 18
const donnerstag18Coaches = coaches.filter(c =>
  c.availableTimes && c.availableTimes.includes('Donnerstag 18')
);

console.log('Coaches available at Donnerstag 18:00:');
if (donnerstag18Coaches.length === 0) {
  console.log('  ❌ NO COACHES AVAILABLE!\n');
} else {
  donnerstag18Coaches.forEach(c => {
    console.log(`  ✅ ${c.firstName} ${c.lastName}`);
    console.log(`     Can teach adults: ${c.isCoachingAdult}`);
    console.log(`     Can teach children: ${c.isCoachingChildren}`);
  });
  console.log('');
}

// Check students wanting Donnerstag 18
const wantDonnerstag18 = students.filter(s =>
  s.availableTimes && s.availableTimes.includes('Donnerstag 18')
);

console.log(`Students wanting Donnerstag 18:00: ${wantDonnerstag18.length}`);
console.log('  Adults: ' + wantDonnerstag18.filter(s => s.adult).length);
console.log('  Children: ' + wantDonnerstag18.filter(s => !s.adult).length);

// Break down children by group
const childrenByGroup = {};
wantDonnerstag18.filter(s => !s.adult).forEach(s => {
  if (!childrenByGroup[s.trainigGroup]) childrenByGroup[s.trainigGroup] = [];
  childrenByGroup[s.trainigGroup].push(s);
});

console.log('\n  Children breakdown:');
Object.entries(childrenByGroup).forEach(([group, students]) => {
  const fullCourses = Math.floor(students.length / 4);
  console.log(`    ${group}: ${students.length} (${fullCourses} full courses possible)`);
});

console.log('\n=== WHY NO COACHES? ===\n');

// Check ALL coaches and their Donnerstag availability
coaches.forEach(c => {
  console.log(`${c.firstName} ${c.lastName}:`);
  console.log(`  Total availability: ${c.availableTimes?.length || 0} time slots`);

  const donnerstagSlots = c.availableTimes?.filter(t => t.startsWith('Donnerstag')) || [];
  console.log(`  Donnerstag slots: ${donnerstagSlots.join(', ') || 'NONE'}`);

  if (!donnerstagSlots.includes('Donnerstag 18')) {
    console.log(`  ❌ NOT available at Donnerstag 18:00`);
  }
  console.log('');
});

await mongoose.connection.close();
