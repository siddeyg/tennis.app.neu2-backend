import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config({path:'./.env.development'});
await mongoose.connect(process.env.MONGO_URI||'mongodb://localhost:27017/tennis-coach');

const Student = mongoose.model('Student', new mongoose.Schema({}, {strict: false}), 'students');

console.log('\n=== GENDER DISTRIBUTION ANALYSIS ===\n');

const students = await Student.find({}).lean();

console.log(`Total Students: ${students.length}`);

const adults = students.filter(s => s.adult);
const children = students.filter(s => !s.adult);

console.log(`Adults: ${adults.length}`);
console.log(`Children: ${children.length}\n`);

console.log('=== ADULT GENDER DISTRIBUTION ===\n');

const adultsByGender = {
  'männlich': adults.filter(s => s.sex === 'männlich'),
  'weiblich': adults.filter(s => s.sex === 'weiblich'),
  'missing': adults.filter(s => !s.sex || s.sex === '')
};

console.log(`Männlich: ${adultsByGender['männlich'].length}`);
console.log(`Weiblich: ${adultsByGender['weiblich'].length}`);
console.log(`Missing/Empty: ${adultsByGender['missing'].length}\n`);

if (adultsByGender['missing'].length > 0) {
  console.log('⚠️  ADULTS WITHOUT GENDER:\n');
  adultsByGender['missing'].forEach(s => {
    console.log(`  - ${s.firstName} ${s.lastName} (${s.skillLevel || 'no skill level'})`);
  });
  console.log('');
}

console.log('=== ADULT GENDER + SKILL LEVEL BREAKDOWN ===\n');

const skillLevels = [...new Set(adults.map(s => s.skillLevel))].filter(Boolean);

skillLevels.forEach(level => {
  const studentsAtLevel = adults.filter(s => s.skillLevel === level);
  const male = studentsAtLevel.filter(s => s.sex === 'männlich').length;
  const female = studentsAtLevel.filter(s => s.sex === 'weiblich').length;
  const missing = studentsAtLevel.filter(s => !s.sex || s.sex === '').length;

  console.log(`${level}:`);
  console.log(`  Total: ${studentsAtLevel.length}`);
  console.log(`  Männlich: ${male}`);
  console.log(`  Weiblich: ${female}`);
  if (missing > 0) console.log(`  ⚠️  Missing: ${missing}`);

  // Show potential full courses by gender
  const maleFull = Math.floor(male / 4);
  const femaleFull = Math.floor(female / 4);
  console.log(`  → Potential full courses: ${maleFull} male + ${femaleFull} female = ${maleFull + femaleFull} total`);
  console.log('');
});

console.log('=== CHILDREN (Gender not used for matching) ===\n');
const childGroups = [...new Set(children.map(s => s.trainigGroup))].filter(Boolean);
childGroups.forEach(group => {
  const count = children.filter(s => s.trainigGroup === group).length;
  console.log(`${group}: ${count} students`);
});

await mongoose.connection.close();
