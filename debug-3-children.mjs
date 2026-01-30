import mongoose from 'mongoose';
import Student from './src/models/Student.js';

await mongoose.connect('mongodb://localhost:27017/tennis-coach');

console.log('\n=== DEBUGGING 3 UNASSIGNED CHILDREN ===\n');

const students = await Student.find({}).lean();

// The 3 unassigned children
const unassignedNames = ['Maja Dietzler', 'Josef Wong', 'Joris Muck'];

const unassigned = students.filter(s => {
  const fullName = `${s.firstName} ${s.lastName}`;
  return unassignedNames.includes(fullName);
});

console.log('=== UNASSIGNED CHILDREN ===\n');
unassigned.forEach(s => {
  console.log(`${s.firstName} ${s.lastName}`);
  console.log(`  Group: ${s.trainigGroup}`);
  console.log(`  Available Times: ${s.availableTimes?.join(', ')}`);
  console.log('');
});

// Check their groups
console.log('=== GROUP ANALYSIS ===\n');

// Rot group
const rotStudents = students.filter(s => s.trainigGroup === 'Rot');
console.log(`Rot Group: ${rotStudents.length} students total`);
console.log(`  Assigned: ${rotStudents.filter(s => s.day && s.hour).length}`);
console.log(`  Unassigned: ${rotStudents.filter(s => !s.day || !s.hour).length}`);

const rotAssigned = rotStudents.filter(s => s.day && s.hour);
if (rotAssigned.length > 0) {
  console.log('\n  Assigned Rot students:');
  rotAssigned.forEach(s => {
    console.log(`    ${s.firstName} ${s.lastName} → ${s.day} ${s.hour}:00`);
  });
}

// Check if Maja and Josef's time slots are being used
const mittwoch16 = rotAssigned.filter(s => s.day === 'Mittwoch' && s.hour === 16);
const mittwoch17 = rotAssigned.filter(s => s.day === 'Mittwoch' && s.hour === 17);
const samstag12 = rotAssigned.filter(s => s.day === 'Samstag' && s.hour === 12);

console.log(`\n  Mittwoch 16: ${mittwoch16.length} Rot students assigned`);
console.log(`  Mittwoch 17: ${mittwoch17.length} Rot students assigned`);
console.log(`  Samstag 12: ${samstag12.length} Rot students assigned`);

// Gelb Team group
console.log(`\nGelb Team Group: ${students.filter(s => s.trainigGroup === 'Gelb Team').length} students total`);
const gelbTeamAssigned = students.filter(s => s.trainigGroup === 'Gelb Team' && s.day && s.hour);
const gelbTeamUnassigned = students.filter(s => s.trainigGroup === 'Gelb Team' && (!s.day || !s.hour));

console.log(`  Assigned: ${gelbTeamAssigned.length}`);
console.log(`  Unassigned: ${gelbTeamUnassigned.length}`);

if (gelbTeamUnassigned.length > 0) {
  console.log('\n  Unassigned Gelb Team students:');
  gelbTeamUnassigned.forEach(s => {
    console.log(`    ${s.firstName} ${s.lastName} - Times: ${s.availableTimes?.join(', ')}`);
  });
}

const samstag12GelbTeam = gelbTeamAssigned.filter(s => s.day === 'Samstag' && s.hour === 12);
const samstag13GelbTeam = gelbTeamAssigned.filter(s => s.day === 'Samstag' && s.hour === 13);

console.log(`\n  Samstag 12: ${samstag12GelbTeam.length} Gelb Team students assigned`);
console.log(`  Samstag 13: ${samstag13GelbTeam.length} Gelb Team students assigned`);

// Check all courses at these time slots
console.log('\n=== COURSES AT THESE TIME SLOTS ===\n');

const mittwoch16All = students.filter(s => s.day === 'Mittwoch' && s.hour === 16);
const mittwoch17All = students.filter(s => s.day === 'Mittwoch' && s.hour === 17);
const samstag12All = students.filter(s => s.day === 'Samstag' && s.hour === 12);
const samstag13All = students.filter(s => s.day === 'Samstag' && s.hour === 13);

console.log(`Mittwoch 16:00 - ${mittwoch16All.length} students assigned`);
mittwoch16All.forEach(s => {
  console.log(`  ${s.firstName} ${s.lastName} (${s.trainigGroup || s.skillLevel})`);
});

console.log(`\nMittwoch 17:00 - ${mittwoch17All.length} students assigned`);
mittwoch17All.forEach(s => {
  console.log(`  ${s.firstName} ${s.lastName} (${s.trainigGroup || s.skillLevel})`);
});

console.log(`\nSamstag 12:00 - ${samstag12All.length} students assigned`);
samstag12All.forEach(s => {
  console.log(`  ${s.firstName} ${s.lastName} (${s.trainigGroup || s.skillLevel})`);
});

console.log(`\nSamstag 13:00 - ${samstag13All.length} students assigned`);
samstag13All.forEach(s => {
  console.log(`  ${s.firstName} ${s.lastName} (${s.trainigGroup || s.skillLevel})`);
});

await mongoose.connection.close();
