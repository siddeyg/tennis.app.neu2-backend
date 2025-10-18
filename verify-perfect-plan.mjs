import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({path:'./.env.development'});
await mongoose.connect(process.env.MONGO_URI||'mongodb://localhost:27017/tennis-coach');

const Student = mongoose.model('Student', new mongoose.Schema({}, {strict: false}), 'students');

const students = await Student.find({}).lean();
const perfectPlan = JSON.parse(fs.readFileSync('perfect-optimal-plan.json', 'utf8'));
const manualPlan = JSON.parse(fs.readFileSync('manual-optimal-plan.json', 'utf8'));

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║   PLAN VERIFICATION & DEEP COMPARISON                      ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Verify perfect plan
const perfectStudents = new Set();
perfectPlan.courses.forEach(c => {
  c.students.forEach(s => perfectStudents.add(s.id));
});

const manualStudents = new Set();
manualPlan.courses.forEach(c => {
  c.students.forEach(s => manualStudents.add(s.id));
});

console.log('📊 VERIFICATION:\n');
console.log(`   Total students in database: ${students.length}`);
console.log(`   Perfect plan: ${perfectStudents.size} unique students assigned`);
console.log(`   Manual plan: ${manualStudents.size} unique students assigned\n`);

// Find unassigned in perfect plan
const unassignedPerfect = students.filter(s => !perfectStudents.has(String(s._id)));
if (unassignedPerfect.length > 0) {
  console.log(`⚠️  PERFECT PLAN - Unassigned students (${unassignedPerfect.length}):`);
  unassignedPerfect.forEach(s => {
    console.log(`   - ${s.firstName} ${s.lastName} (${s.adult ? s.skillLevel : s.trainigGroup})`);
    console.log(`     Available times: ${(s.availableTimes || []).join(', ')}\n`);
  });
}

// Find unassigned in manual plan
const unassignedManual = students.filter(s => !manualStudents.has(String(s._id)));
if (unassignedManual.length > 0) {
  console.log(`⚠️  MANUAL PLAN - Unassigned students (${unassignedManual.length}):`);
  unassignedManual.forEach(s => {
    console.log(`   - ${s.firstName} ${s.lastName} (${s.adult ? s.skillLevel : s.trainigGroup})`);
    console.log(`     Available times: ${(s.availableTimes || []).join(', ')}\n`);
  });
}

// Detailed comparison
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║   DETAILED COMPARISON                                      ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

const perfectStats = perfectPlan.statistics;
const manualStats = manualPlan.statistics;

console.log('                           PERFECT    MANUAL    DIFFERENCE');
console.log('────────────────────────────────────────────────────────────');
console.log(`Total Courses             ${perfectStats.totalCourses.toString().padStart(7)}    ${manualStats.totalCourses.toString().padStart(6)}    ${(perfectStats.totalCourses - manualStats.totalCourses).toString().padStart(10)} ${perfectStats.totalCourses < manualStats.totalCourses ? '✅ fewer' : ''}`);
console.log(`4-student courses         ${perfectStats.course4.toString().padStart(7)}    ${manualStats.course4.toString().padStart(6)}    ${(perfectStats.course4 - manualStats.course4).toString().padStart(10)} ${perfectStats.course4 === manualStats.course4 ? '✅ equal' : ''}`);
console.log(`3-student courses         ${perfectStats.course3.toString().padStart(7)}    ${manualStats.course3.toString().padStart(6)}    ${(perfectStats.course3 - manualStats.course3).toString().padStart(10)} ${perfectStats.course3 > manualStats.course3 ? '✅ more' : ''}`);
console.log(`2-student courses         ${perfectStats.course2.toString().padStart(7)}    ${manualStats.course2.toString().padStart(6)}    ${(perfectStats.course2 - manualStats.course2).toString().padStart(10)} ${perfectStats.course2 < manualStats.course2 ? '✅ fewer' : ''}`);
console.log(`1-student courses         ${perfectStats.course1.toString().padStart(7)}    ${manualStats.course1.toString().padStart(6)}    ${(perfectStats.course1 - manualStats.course1).toString().padStart(10)} ${perfectStats.course1 < manualStats.course1 ? '✅ fewer' : ''}`);
console.log(`Assigned students         ${perfectStudents.size.toString().padStart(7)}    ${manualStudents.size.toString().padStart(6)}    ${(perfectStudents.size - manualStudents.size).toString().padStart(10)}`);

const perfectEff = ((perfectStats.course4 + perfectStats.course3) / perfectStats.totalCourses * 100).toFixed(1);
const manualEff = ((manualStats.course4 + manualStats.course3) / manualStats.totalCourses * 100).toFixed(1);

console.log(`\nEfficiency (3-4 students):  ${perfectEff}%     ${manualEff}%    ${perfectEff > manualEff ? '✅ BETTER' : ''}`);

// Calculate coach hours
const perfectHours = perfectStats.totalCourses;
const manualHours = manualStats.totalCourses;
const hoursSaved = manualHours - perfectHours;

console.log(`\n💰 COST ANALYSIS:`);
console.log(`   Perfect plan: ${perfectHours} coach hours/week`);
console.log(`   Manual plan: ${manualHours} coach hours/week`);
if (hoursSaved > 0) {
  console.log(`   Savings: ${hoursSaved} coach hours/week ✅`);
  console.log(`   Annual savings: ~${hoursSaved * 40} hours (assuming 40 weeks/year)\n`);
}

// Check for placement quality - are students at their best time slots?
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║   PLACEMENT QUALITY ANALYSIS                               ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Count students in full courses
const perfectInFull = perfectPlan.courses.filter(c => c.students.length === 4)
  .reduce((sum, c) => sum + c.students.length, 0);
const manualInFull = manualPlan.courses.filter(c => c.students.length === 4)
  .reduce((sum, c) => sum + c.students.length, 0);

console.log(`Students in full courses:`);
console.log(`   Perfect: ${perfectInFull}/${perfectStudents.size} (${(perfectInFull/perfectStudents.size*100).toFixed(1)}%)`);
console.log(`   Manual: ${manualInFull}/${manualStudents.size} (${(manualInFull/manualStudents.size*100).toFixed(1)}%)\n`);

// Count students in good courses (3-4 students)
const perfectInGood = perfectPlan.courses.filter(c => c.students.length >= 3)
  .reduce((sum, c) => sum + c.students.length, 0);
const manualInGood = manualPlan.courses.filter(c => c.students.length >= 3)
  .reduce((sum, c) => sum + c.students.length, 0);

console.log(`Students in good courses (3-4):`);
console.log(`   Perfect: ${perfectInGood}/${perfectStudents.size} (${(perfectInGood/perfectStudents.size*100).toFixed(1)}%)`);
console.log(`   Manual: ${manualInGood}/${manualStudents.size} (${(manualInGood/manualStudents.size*100).toFixed(1)}%)\n`);

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║   FINAL VERDICT                                            ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

const scores = {
  perfect: 0,
  manual: 0
};

// Score by full courses (most important)
if (perfectStats.course4 > manualStats.course4) scores.perfect += 3;
else if (perfectStats.course4 < manualStats.course4) scores.manual += 3;
else { scores.perfect += 1.5; scores.manual += 1.5; }

// Score by efficiency
if (parseFloat(perfectEff) > parseFloat(manualEff)) scores.perfect += 2;
else if (parseFloat(perfectEff) < parseFloat(manualEff)) scores.manual += 2;
else { scores.perfect += 1; scores.manual += 1; }

// Score by total courses (fewer is better)
if (perfectStats.totalCourses < manualStats.totalCourses) scores.perfect += 1;
else if (perfectStats.totalCourses > manualStats.totalCourses) scores.manual += 1;
else { scores.perfect += 0.5; scores.manual += 0.5; }

// Score by singles (fewer is better)
if (perfectStats.course1 < manualStats.course1) scores.perfect += 1;
else if (perfectStats.course1 > manualStats.course1) scores.manual += 1;
else { scores.perfect += 0.5; scores.manual += 0.5; }

console.log(`Quality Score:`);
console.log(`   Perfect Plan: ${scores.perfect}/7.5 (${(scores.perfect/7.5*100).toFixed(1)}%)`);
console.log(`   Manual Plan: ${scores.manual}/7.5 (${(scores.manual/7.5*100).toFixed(1)}%)\n`);

if (scores.perfect > scores.manual) {
  console.log(`🏆 WINNER: Perfect Plan (Automated)`);
  console.log(`   ✅ Better overall efficiency and resource utilization\n`);
} else if (scores.manual > scores.perfect) {
  console.log(`🏆 WINNER: Manual Plan`);
  console.log(`   ✅ Better course quality and student placement\n`);
} else {
  console.log(`🤝 TIE: Both plans are equally good!\n`);
}

mongoose.connection.close();
