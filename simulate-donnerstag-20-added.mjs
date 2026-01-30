import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({path:'./.env.development'});
await mongoose.connect(process.env.MONGO_URI||'mongodb://localhost:27017/tennis-coach');

const Student = mongoose.model('Student', new mongoose.Schema({}, {strict: false}), 'students');

const students = await Student.find({}).lean();

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║   SIMULATION: ADD DONNERSTAG 20 TO STUDENTS                ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Find adults with Donnerstag 18 OR 19
const adultsWithDonnerstag1819 = students.filter(s =>
  s.adult === true &&
  s.availableTimes &&
  (s.availableTimes.includes('Donnerstag 18') || s.availableTimes.includes('Donnerstag 19'))
);

console.log(`📊 STUDENTS TO MODIFY:\n`);
console.log(`   Adults with Donnerstag 18 OR 19: ${adultsWithDonnerstag1819.length}\n`);

// Break down by which time they have
const hasDo18 = adultsWithDonnerstag1819.filter(s => s.availableTimes.includes('Donnerstag 18'));
const hasDo19 = adultsWithDonnerstag1819.filter(s => s.availableTimes.includes('Donnerstag 19'));
const hasBoth = adultsWithDonnerstag1819.filter(s =>
  s.availableTimes.includes('Donnerstag 18') && s.availableTimes.includes('Donnerstag 19')
);

console.log(`   Breakdown:`);
console.log(`      Have Donnerstag 18: ${hasDo18.length}`);
console.log(`      Have Donnerstag 19: ${hasDo19.length}`);
console.log(`      Have both 18 & 19: ${hasBoth.length}\n`);

// Group these students by gender and skill level
const groupsByGenderLevel = {};

adultsWithDonnerstag1819.forEach(s => {
  const gender = s.sex || 'unknown';
  const level = s.skillLevel || 'unknown';
  const key = `${gender}-${level}`;

  if (!groupsByGenderLevel[key]) {
    groupsByGenderLevel[key] = [];
  }
  groupsByGenderLevel[key].push(s);
});

console.log(`   Groups (by gender-level):\n`);
Object.keys(groupsByGenderLevel).sort().forEach(key => {
  const group = groupsByGenderLevel[key];
  console.log(`      ${key}: ${group.length} students`);
});

// Calculate current situation at Donnerstag 18, 19, 20
console.log('\n─'.repeat(60));
console.log('📋 CURRENT SITUATION (without adding Donnerstag 20):\n');

const currentPlan = JSON.parse(fs.readFileSync('perfect-optimal-plan.json', 'utf8'));

['Donnerstag 18', 'Donnerstag 19', 'Donnerstag 20'].forEach(time => {
  const [day, hourStr] = time.split(' ');
  const hour = parseInt(hourStr);

  const coursesAtTime = currentPlan.courses.filter(c => c.day === day && c.hour === hour);
  const studentsAtTime = coursesAtTime.reduce((sum, c) => sum + c.students.length, 0);

  console.log(`   ${time}:`);
  console.log(`      Courses: ${coursesAtTime.length}`);
  console.log(`      Students: ${studentsAtTime}`);

  if (coursesAtTime.length > 0) {
    coursesAtTime.forEach(c => {
      console.log(`         • ${c.groupLabel}: ${c.students.length} students (${c.coach})`);
    });
  }
  console.log('');
});

// Now simulate: what if we add Donnerstag 20 to these students?
console.log('─'.repeat(60));
console.log('🔮 SIMULATION: After Adding Donnerstag 20 to These Students\n');

// Create modified student data
const modifiedStudents = students.map(s => {
  if (s.adult && s.availableTimes &&
      (s.availableTimes.includes('Donnerstag 18') || s.availableTimes.includes('Donnerstag 19'))) {

    // Add Donnerstag 20 if not already present
    const newAvailableTimes = [...s.availableTimes];
    if (!newAvailableTimes.includes('Donnerstag 20')) {
      newAvailableTimes.push('Donnerstag 20');
    }

    return { ...s, availableTimes: newAvailableTimes };
  }
  return s;
});

// Now group students at Donnerstag 20
const adultsAtDo20AfterChange = modifiedStudents.filter(s =>
  s.adult === true &&
  s.availableTimes &&
  s.availableTimes.includes('Donnerstag 20')
);

console.log(`   Adults NOW available at Donnerstag 20: ${adultsAtDo20AfterChange.length}\n`);

// Group by gender and level for Donnerstag 20
const groupsAtDo20 = {};

adultsAtDo20AfterChange.forEach(s => {
  const gender = s.sex || 'unknown';
  const level = s.skillLevel || 'unknown';
  const key = `${gender}-${level}`;

  if (!groupsAtDo20[key]) {
    groupsAtDo20[key] = [];
  }
  groupsAtDo20[key].push(s);
});

console.log(`   Groups at Donnerstag 20:\n`);

let totalFullCoursesPossible = 0;
let totalStudentsInFullCourses = 0;

Object.keys(groupsAtDo20).sort().forEach(key => {
  const group = groupsAtDo20[key];
  const fullCourses = Math.floor(group.length / 4);

  console.log(`      ${key}: ${group.length} students`);

  if (fullCourses > 0) {
    console.log(`         → ${fullCourses} FULL course(s) possible! ⭐`);
    totalFullCoursesPossible += fullCourses;
    totalStudentsInFullCourses += fullCourses * 4;
  }

  const remainder = group.length % 4;
  if (remainder === 3) {
    console.log(`         → 1 three-student course`);
  } else if (remainder === 2) {
    console.log(`         → 1 two-student course`);
  } else if (remainder === 1) {
    console.log(`         → 1 single-student course`);
  }

  console.log('');
});

console.log(`   TOTAL at Donnerstag 20:`);
console.log(`      Full courses: ${totalFullCoursesPossible}`);
console.log(`      Students in full courses: ${totalStudentsInFullCourses}/${adultsAtDo20AfterChange.length}\n`);

// Calculate optimization potential
console.log('─'.repeat(60));
console.log('💡 OPTIMIZATION ANALYSIS:\n');

// Current plan: where are these students now?
const studentsToAnalyze = adultsAtDo20AfterChange.map(s => String(s._id));
const currentPlacements = {};

studentsToAnalyze.forEach(studentId => {
  for (const course of currentPlan.courses) {
    const inCourse = course.students.find(s => s.id === studentId);
    if (inCourse) {
      const size = course.students.length;
      if (!currentPlacements[size]) {
        currentPlacements[size] = [];
      }
      currentPlacements[size].push({
        studentId,
        name: inCourse.name,
        time: `${course.day} ${course.hour}`
      });
      break;
    }
  }
});

console.log(`   These ${adultsAtDo20AfterChange.length} students are currently placed in:\n`);
const inSingles = currentPlacements[1] || [];
const inPairs = currentPlacements[2] || [];
const inThrees = currentPlacements[3] || [];
const inFours = currentPlacements[4] || [];

console.log(`      Singles (1 student): ${inSingles.length}`);
console.log(`      Pairs (2 students): ${inPairs.length}`);
console.log(`      Threes (3 students): ${inThrees.length}`);
console.log(`      Fours (4 students): ${inFours.length}\n`);

// Calculate potential improvement
const currentlyInSuboptimal = inSingles.length + inPairs.length;
const couldBeInFull = totalStudentsInFullCourses;

console.log(`   POTENTIAL IMPROVEMENT:\n`);
console.log(`      Currently in singles/pairs: ${currentlyInSuboptimal}`);
console.log(`      Could be in full courses at Do 20: ${couldBeInFull}\n`);

if (couldBeInFull > inFours.length) {
  const improvement = couldBeInFull - inFours.length;
  console.log(`      ✅ ${improvement} MORE students could be in full courses!\n`);
} else {
  console.log(`      ⚠️  No significant improvement (students already well-placed)\n`);
}

// Show time slot distribution impact
console.log('─'.repeat(60));
console.log('📊 TIME SLOT REDISTRIBUTION:\n');

console.log('   Current Distribution (Donnerstag):\n');
const currentDo18Courses = currentPlan.courses.filter(c => c.day === 'Donnerstag' && c.hour === 18);
const currentDo19Courses = currentPlan.courses.filter(c => c.day === 'Donnerstag' && c.hour === 19);
const currentDo20Courses = currentPlan.courses.filter(c => c.day === 'Donnerstag' && c.hour === 20);

console.log(`      18:00 - ${currentDo18Courses.length} courses (${currentDo18Courses.reduce((s,c)=>s+c.students.length,0)} students)`);
console.log(`      19:00 - ${currentDo19Courses.length} courses (${currentDo19Courses.reduce((s,c)=>s+c.students.length,0)} students)`);
console.log(`      20:00 - ${currentDo20Courses.length} courses (${currentDo20Courses.reduce((s,c)=>s+c.students.length,0)} students)\n`);

console.log('   Potential Distribution (with Donnerstag 20 added):\n');
console.log(`      18:00 - Could stay the same OR reduce if students move to 20:00`);
console.log(`      19:00 - Could stay the same OR reduce if students move to 20:00`);
console.log(`      20:00 - ${totalFullCoursesPossible} full courses + smaller courses (NEW)\n`);

// Final recommendation
console.log('─'.repeat(60));
console.log('🎯 RECOMMENDATION:\n');

if (totalFullCoursesPossible >= 2) {
  console.log(`   ✅ HIGHLY RECOMMENDED: Add Donnerstag 20:00!\n`);
  console.log(`      Benefits:`);
  console.log(`         • ${totalFullCoursesPossible} new full courses possible`);
  console.log(`         • ${totalStudentsInFullCourses} students in optimal placement`);
  console.log(`         • Spreads load across 3 time slots (18, 19, 20) instead of 2`);
  console.log(`         • Reduces overcrowding at 18:00 and 19:00\n`);

  console.log(`      Implementation:`);
  console.log(`         1. Update ${adultsWithDonnerstag1819.length} students to add Donnerstag 20 to availableTimes`);
  console.log(`         2. Regenerate optimal plan with algorithm`);
  console.log(`         3. Expected result: +${totalFullCoursesPossible} full courses\n`);
} else if (totalFullCoursesPossible === 1) {
  console.log(`   ⚠️  MODERATE BENEFIT: Consider adding Donnerstag 20:00\n`);
  console.log(`      Benefits:`);
  console.log(`         • 1 new full course possible`);
  console.log(`         • Some load distribution benefit\n`);
} else {
  console.log(`   ❌ NOT RECOMMENDED: Limited benefit\n`);
  console.log(`      • No full courses possible at Donnerstag 20:00`);
  console.log(`      • Students are already well-placed in current plan\n`);
}

// Show which students would be affected
if (totalFullCoursesPossible > 0) {
  console.log('─'.repeat(60));
  console.log('👥 STUDENTS THAT WOULD BE AFFECTED:\n');

  Object.keys(groupsAtDo20).sort().forEach(key => {
    const group = groupsAtDo20[key];
    if (group.length >= 4) {
      console.log(`   ${key} - Could form full course(s):\n`);
      group.forEach(s => {
        const current = currentPlacements[1]?.find(p => p.studentId === String(s._id)) ||
                       currentPlacements[2]?.find(p => p.studentId === String(s._id)) ||
                       currentPlacements[3]?.find(p => p.studentId === String(s._id)) ||
                       currentPlacements[4]?.find(p => p.studentId === String(s._id));

        if (current) {
          const courseSize = Object.keys(currentPlacements).find(size =>
            currentPlacements[size]?.some(p => p.studentId === String(s._id))
          );
          console.log(`      • ${s.firstName} ${s.lastName} (currently at ${current.time} in ${courseSize}-student course)`);
        }
      });
      console.log('');
    }
  });
}

mongoose.connection.close();
