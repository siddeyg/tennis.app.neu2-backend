import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({path:'./.env.development'});
await mongoose.connect(process.env.MONGO_URI||'mongodb://localhost:27017/tennis-coach');

const Student = mongoose.model('Student', new mongoose.Schema({}, {strict: false}), 'students');
const Coach = mongoose.model('Coach', new mongoose.Schema({}, {strict: false}), 'coaches');

const students = await Student.find({}).lean();
const coaches = await Coach.find({}).lean();

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║   IMPACT ANALYSIS: HELGE PADBERG @ DONNERSTAG 20:00       ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Find Helge
const helge = coaches.find(c => c.firstName === 'Helge' && c.lastName === 'Padberg');

if (!helge) {
  console.log('❌ Helge Padberg not found in database!');
  mongoose.connection.close();
  process.exit(1);
}

console.log('👨‍🏫 Current Helge Padberg Status:\n');
console.log(`   Name: ${helge.firstName} ${helge.lastName}`);
console.log(`   Coaches Adults: ${helge.isCoachingAdult}`);
console.log(`   Coaches Children: ${helge.isCoachingChildren}`);
console.log(`   Current Available Times: ${(helge.availableTimes || []).length}`);
console.log(`   Times: ${(helge.availableTimes || []).join(', ')}\n`);

// Check if Donnerstag 20 already exists
const hasDonnerstag20 = (helge.availableTimes || []).includes('Donnerstag 20');

if (hasDonnerstag20) {
  console.log('ℹ️  Helge already has Donnerstag 20:00 in his schedule.\n');
} else {
  console.log('➕ Donnerstag 20:00 would be ADDED to Helge\'s schedule.\n');
}

// Find adults available at Donnerstag 20:00
console.log('─'.repeat(60));
console.log('📊 ADULTS AVAILABLE AT DONNERSTAG 20:00:\n');

const adultsAtDonnerstag20 = students.filter(s =>
  s.adult === true &&
  s.availableTimes &&
  s.availableTimes.includes('Donnerstag 20')
);

console.log(`   Found: ${adultsAtDonnerstag20.length} adults\n`);

// Group by gender and skill level
const byGenderAndLevel = {};

adultsAtDonnerstag20.forEach(s => {
  const gender = s.sex || 'unknown';
  const level = s.skillLevel || 'unknown';
  const key = `${gender}-${level}`;

  if (!byGenderAndLevel[key]) {
    byGenderAndLevel[key] = [];
  }
  byGenderAndLevel[key].push(s);
});

// Display groups
Object.keys(byGenderAndLevel).sort().forEach(key => {
  const [gender, level] = key.split('-');
  const group = byGenderAndLevel[key];

  console.log(`   ${gender.toUpperCase()} - ${level}: ${group.length} students`);
  group.forEach(s => {
    console.log(`      • ${s.firstName} ${s.lastName}`);
  });
  console.log('');
});

// Calculate potential courses
console.log('─'.repeat(60));
console.log('🎯 POTENTIAL COURSES AT DONNERSTAG 20:00:\n');

let potentialFullCourses = 0;
let studentsInFullCourses = 0;

Object.keys(byGenderAndLevel).forEach(key => {
  const group = byGenderAndLevel[key];
  const fullCourses = Math.floor(group.length / 4);
  const threeStudent = (group.length % 4) >= 3 ? 1 : 0;
  const twoStudent = (group.length % 4) === 2 ? 1 : 0;
  const single = (group.length % 4) === 1 ? 1 : 0;

  if (group.length > 0) {
    console.log(`   ${key}:`);
    console.log(`      Total: ${group.length} students`);
    if (fullCourses > 0) {
      console.log(`      → ${fullCourses} full course(s) (4 students) ⭐`);
      potentialFullCourses += fullCourses;
      studentsInFullCourses += fullCourses * 4;
    }
    if (threeStudent > 0) {
      console.log(`      → 1 three-student course`);
    }
    if (twoStudent > 0) {
      console.log(`      → 1 two-student course`);
    }
    if (single > 0) {
      console.log(`      → 1 single-student course`);
    }
    console.log('');
  }
});

console.log(`   TOTAL POTENTIAL:`);
console.log(`      Full courses (4 students): ${potentialFullCourses}`);
console.log(`      Students in full courses: ${studentsInFullCourses}/${adultsAtDonnerstag20.length}\n`);

// Compare with current plan
console.log('─'.repeat(60));
console.log('📋 IMPACT ON CURRENT PERFECT PLAN:\n');

const currentPlan = JSON.parse(fs.readFileSync('perfect-optimal-plan.json', 'utf8'));

// Check current Donnerstag 20 courses
const currentDonnerstag20Courses = currentPlan.courses.filter(c =>
  c.day === 'Donnerstag' && c.hour === 20
);

console.log(`   Current Donnerstag 20:00 courses: ${currentDonnerstag20Courses.length}`);
if (currentDonnerstag20Courses.length > 0) {
  currentDonnerstag20Courses.forEach(c => {
    console.log(`      • ${c.groupLabel}: ${c.students.length} students (Coach: ${c.coach})`);
  });
} else {
  console.log(`      (No courses currently scheduled)\n`);
}

// Check where these Donnerstag 20 students are currently placed
console.log(`\n   Where are these ${adultsAtDonnerstag20.length} students currently placed?\n`);

const studentPlacements = {};
adultsAtDonnerstag20.forEach(student => {
  const studentId = String(student._id);

  // Find in current plan
  for (const course of currentPlan.courses) {
    const inCourse = course.students.find(s => s.id === studentId);
    if (inCourse) {
      const key = `${course.day} ${course.hour}`;
      if (!studentPlacements[key]) {
        studentPlacements[key] = [];
      }
      studentPlacements[key].push({
        student: `${student.firstName} ${student.lastName}`,
        level: student.skillLevel,
        gender: student.sex,
        courseSize: course.students.length
      });
      break;
    }
  }
});

Object.keys(studentPlacements).sort().forEach(timeSlot => {
  const placements = studentPlacements[timeSlot];
  console.log(`      ${timeSlot}: ${placements.length} students`);
  placements.forEach(p => {
    console.log(`         • ${p.student} (${p.gender}-${p.level}) - current course size: ${p.courseSize}`);
  });
});

// Calculate optimization potential
console.log('\n─'.repeat(60));
console.log('💡 OPTIMIZATION ANALYSIS:\n');

const studentsCurrentlyInSingles = Object.values(studentPlacements)
  .flat()
  .filter(p => p.courseSize === 1)
  .length;

const studentsCurrentlyInPairs = Object.values(studentPlacements)
  .flat()
  .filter(p => p.courseSize === 2)
  .length;

const studentsCurrentlyInThrees = Object.values(studentPlacements)
  .flat()
  .filter(p => p.courseSize === 3)
  .length;

console.log(`   Current Status of These ${adultsAtDonnerstag20.length} Students:`);
console.log(`      In singles: ${studentsCurrentlyInSingles}`);
console.log(`      In pairs: ${studentsCurrentlyInPairs}`);
console.log(`      In threes: ${studentsCurrentlyInThrees}`);
console.log(`      In fours: ${adultsAtDonnerstag20.length - studentsCurrentlyInSingles - studentsCurrentlyInPairs - studentsCurrentlyInThrees}\n`);

if (potentialFullCourses > 0) {
  console.log(`   ✅ POTENTIAL IMPROVEMENT:`);
  console.log(`      Adding Donnerstag 20:00 for Helge could create:`);
  console.log(`      → ${potentialFullCourses} NEW full course(s)`);
  console.log(`      → ${studentsInFullCourses} students in optimal placement`);

  const currentSmallCourses = studentsCurrentlyInSingles + studentsCurrentlyInPairs;
  const improvement = studentsInFullCourses - (adultsAtDonnerstag20.length - currentSmallCourses);

  if (improvement > 0) {
    console.log(`      → ${improvement} students BETTER placed than currently\n`);
  }
} else {
  console.log(`   ⚠️  LIMITED IMPACT:`);
  console.log(`      No full courses possible at Donnerstag 20:00`);
  console.log(`      Would only create smaller courses\n`);
}

// Overall plan impact
console.log('─'.repeat(60));
console.log('📈 OVERALL PLAN IMPACT ESTIMATE:\n');

const currentStats = currentPlan.statistics;
const newFullCourses = currentStats.course4 + potentialFullCourses;
const newEfficiency = ((newFullCourses + currentStats.course3) / (currentStats.totalCourses + potentialFullCourses) * 100).toFixed(1);

console.log(`   Current Plan:`);
console.log(`      Total Courses: ${currentStats.totalCourses}`);
console.log(`      Full Courses: ${currentStats.course4} (${(currentStats.course4/currentStats.totalCourses*100).toFixed(1)}%)`);
console.log(`      Efficiency: ${((currentStats.course4 + currentStats.course3)/currentStats.totalCourses*100).toFixed(1)}%\n`);

if (potentialFullCourses > 0) {
  console.log(`   With Donnerstag 20:00 Added:`);
  console.log(`      Total Courses: ~${currentStats.totalCourses + potentialFullCourses} (${potentialFullCourses > 0 ? '+' : ''}${potentialFullCourses})`);
  console.log(`      Full Courses: ~${newFullCourses} (+${potentialFullCourses}) ⭐`);
  console.log(`      Efficiency: ~${newEfficiency}% (improvement!)\n`);

  console.log(`   🎉 RECOMMENDATION: ADD DONNERSTAG 20:00 FOR HELGE PADBERG!`);
  console.log(`      This would improve the plan quality.\n`);
} else {
  console.log(`   With Donnerstag 20:00 Added:`);
  console.log(`      Minimal impact - only ${adultsAtDonnerstag20.length} students affected`);
  console.log(`      No new full courses possible\n`);

  console.log(`   ℹ️  RECOMMENDATION: OPTIONAL`);
  console.log(`      Adding this time slot has limited benefit.\n`);
}

mongoose.connection.close();
