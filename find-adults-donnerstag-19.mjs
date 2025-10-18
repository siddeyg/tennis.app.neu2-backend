import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config({path:'./.env.development'});
await mongoose.connect(process.env.MONGO_URI||'mongodb://localhost:27017/tennis-coach');

const Student = mongoose.model('Student', new mongoose.Schema({}, {strict: false}), 'students');

const students = await Student.find({}).lean();

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║   ADULTS AVAILABLE AT DONNERSTAG 19:00                    ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

const adultsAtDonnerstag19 = students.filter(s =>
  s.adult === true &&
  s.availableTimes &&
  s.availableTimes.includes('Donnerstag 19')
);

console.log(`Found ${adultsAtDonnerstag19.length} adults available at Donnerstag 19:00\n`);

// Group by gender and skill level
const byGenderAndLevel = {};

adultsAtDonnerstag19.forEach(s => {
  const gender = s.sex || 'unknown';
  const level = s.skillLevel || 'unknown';
  const key = `${gender}-${level}`;

  if (!byGenderAndLevel[key]) {
    byGenderAndLevel[key] = [];
  }
  byGenderAndLevel[key].push(s);
});

// Display grouped
Object.keys(byGenderAndLevel).sort().forEach(key => {
  const [gender, level] = key.split('-');
  const group = byGenderAndLevel[key];

  console.log(`\n📋 ${gender.toUpperCase()} - ${level} (${group.length} students):`);
  console.log('─'.repeat(60));

  group.forEach((s, idx) => {
    console.log(`   ${idx+1}. ${s.firstName} ${s.lastName}`);
    console.log(`      Email: ${s.email || 'N/A'}`);
    console.log(`      Phone: ${s.phone || 'N/A'}`);
    console.log(`      Total available times: ${s.availableTimes.length}`);
  });
});

// Summary
console.log(`\n\n╔════════════════════════════════════════════════════════════╗`);
console.log(`║   SUMMARY                                                  ║`);
console.log(`╚════════════════════════════════════════════════════════════╝\n`);

console.log('By Gender:');
const males = adultsAtDonnerstag19.filter(s => s.sex === 'männlich').length;
const females = adultsAtDonnerstag19.filter(s => s.sex === 'weiblich').length;
console.log(`   Männlich: ${males}`);
console.log(`   Weiblich: ${females}`);

console.log(`\nBy Skill Level:`);
const levelCounts = {};
adultsAtDonnerstag19.forEach(s => {
  const level = s.skillLevel || 'unknown';
  levelCounts[level] = (levelCounts[level] || 0) + 1;
});
Object.keys(levelCounts).sort().forEach(level => {
  console.log(`   ${level}: ${levelCounts[level]}`);
});

console.log(`\nPotential Full Courses:`);
Object.keys(byGenderAndLevel).forEach(key => {
  const group = byGenderAndLevel[key];
  if (group.length >= 4) {
    const fullCourses = Math.floor(group.length / 4);
    console.log(`   ${key}: ${group.length} students → ${fullCourses} full course(s) possible!`);
  }
});

console.log('\n');
mongoose.connection.close();
