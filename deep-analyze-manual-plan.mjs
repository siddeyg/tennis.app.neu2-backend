import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({path:'./.env.development'});
await mongoose.connect(process.env.MONGO_URI||'mongodb://localhost:27017/tennis-coach');

const Student = mongoose.model('Student', new mongoose.Schema({}, {strict: false}), 'students');
const Coach = mongoose.model('Coach', new mongoose.Schema({}, {strict: false}), 'coaches');

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║   DEEP ANALYSIS: MANUAL OPTIMAL PLAN OPTIMIZATION         ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Load manual plan
const manualPlan = JSON.parse(fs.readFileSync('manual-optimal-plan.json', 'utf8'));
const students = await Student.find({}).lean();
const coaches = await Coach.find({}).lean();

// Build student lookup
const studentById = new Map();
students.forEach(s => studentById.set(String(s._id), s));

// Build coach availability map
const coachByTimeSlot = new Map();
coaches.forEach(coach => {
  (coach.availableTimes || []).forEach(time => {
    if (!coachByTimeSlot.has(time)) coachByTimeSlot.set(time, []);
    coachByTimeSlot.get(time).push(coach);
  });
});

console.log('📊 PLAN OVERVIEW:');
console.log(`   Total Courses: ${manualPlan.courses.length}`);
console.log(`   4-student: ${manualPlan.statistics.course4}`);
console.log(`   3-student: ${manualPlan.statistics.course3}`);
console.log(`   2-student: ${manualPlan.statistics.course2}`);
console.log(`   1-student: ${manualPlan.statistics.course1}\n`);

// ===========================================
// ANALYSIS 1: Singles & Pairs - Can they be consolidated?
// ===========================================
console.log('🔍 ANALYSIS 1: Singles & Pairs Consolidation Opportunities\n');

const smallCourses = manualPlan.courses.filter(c => c.students.length <= 2);
let consolidationOpportunities = [];

for (const course of smallCourses) {
  const studentsInCourse = course.students.map(s => studentById.get(s.id));

  for (const studentData of studentsInCourse) {
    if (!studentData) continue;

    const student = studentById.get(String(studentData._id));
    if (!student) continue;

    // Find other courses at student's available times with same level/group
    for (const timeToken of (student.availableTimes || [])) {
      // Skip current assignment
      const [day, hourStr] = timeToken.split(' ');
      const hour = parseInt(hourStr);
      if (day === course.day && hour === course.hour) continue;

      // Find courses at this time
      const coursesAtTime = manualPlan.courses.filter(c =>
        c.day === day && c.hour === hour && c.students.length < 4
      );

      for (const targetCourse of coursesAtTime) {
        // Check if compatible (same level/group/gender for adults)
        const targetStudents = targetCourse.students.map(s => studentById.get(s.id)).filter(Boolean);
        if (targetStudents.length === 0) continue;

        const allCompatible = targetStudents.every(ts => {
          if (student.adult !== ts.adult) return false;
          if (student.adult) {
            return student.sex === ts.sex && student.skillLevel === ts.skillLevel;
          } else {
            return student.trainigGroup === ts.trainigGroup;
          }
        });

        if (allCompatible && targetCourse.students.length < 4) {
          consolidationOpportunities.push({
            student: `${student.firstName} ${student.lastName}`,
            level: student.adult ? student.skillLevel : student.trainigGroup,
            from: `${course.day} ${course.hour} (${course.students.length} students)`,
            to: `${day} ${hour} (${targetCourse.students.length}/4 students)`,
            benefit: targetCourse.students.length === 3 ? 'CREATES FULL COURSE!' : 'Fills existing course'
          });
        }
      }
    }
  }
}

if (consolidationOpportunities.length > 0) {
  console.log(`   Found ${consolidationOpportunities.length} consolidation opportunities:\n`);
  consolidationOpportunities.slice(0, 10).forEach((opp, i) => {
    console.log(`   ${i+1}. ${opp.student} (${opp.level})`);
    console.log(`      Move: ${opp.from} → ${opp.to}`);
    console.log(`      ${opp.benefit}\n`);
  });
} else {
  console.log('   ✅ No consolidation opportunities found - plan is optimal!\n');
}

// ===========================================
// ANALYSIS 2: Donnerstag 18 - The Missing Opportunity
// ===========================================
console.log('🔍 ANALYSIS 2: Donnerstag 18:00 - Coach Availability Issue\n');

const donnerstag18Courses = manualPlan.courses.filter(c =>
  c.day === 'Donnerstag' && c.hour === 18
);

console.log(`   Courses at Donnerstag 18: ${donnerstag18Courses.length}`);
donnerstag18Courses.forEach(c => {
  console.log(`   - ${c.groupLabel}: ${c.students.length} students (Coach: ${c.coach})`);
});

const donnerstag18Students = [];
donnerstag18Courses.forEach(course => {
  course.students.forEach(s => {
    const student = studentById.get(s.id);
    if (student) donnerstag18Students.push(student);
  });
});

console.log(`\n   Total students: ${donnerstag18Students.length}`);
console.log(`   Breakdown:`);
const gelbHobby = donnerstag18Students.filter(s => s.trainigGroup === 'Gelb Hobby').length;
const gelbTeam = donnerstag18Students.filter(s => s.trainigGroup === 'Gelb Team').length;
console.log(`   - Gelb Hobby: ${gelbHobby}`);
console.log(`   - Gelb Team: ${gelbTeam}`);

const donnerstag18Coaches = coachByTimeSlot.get('Donnerstag 18') || [];
console.log(`\n   Available coaches: ${donnerstag18Coaches.length}`);
donnerstag18Coaches.forEach(c => {
  console.log(`   - ${c.firstName} ${c.lastName}: Adults=${c.isCoachingAdult}, Children=${c.isCoachingChildren}`);
});

if (donnerstag18Coaches.length === 1 && !donnerstag18Coaches[0].isCoachingChildren) {
  console.log(`\n   ⚠️  CRITICAL ISSUE: Only coach available (${donnerstag18Coaches[0].firstName}) cannot coach children!`);
  console.log(`   This blocks ${gelbHobby + gelbTeam} children from their optimal time slot.`);
  console.log(`   Potential: ${Math.floor((gelbHobby + gelbTeam) / 4)} full 4-student courses!\n`);
}

// ===========================================
// ANALYSIS 3: Check if students are at BEST time slots
// ===========================================
console.log('🔍 ANALYSIS 3: Are students placed at their BEST time slots?\n');

let suboptimalPlacements = [];

for (const course of manualPlan.courses) {
  for (const studentData of course.students) {
    const student = studentById.get(studentData.id);
    if (!student || !student.availableTimes) continue;

    // Find time slots where MORE students from same group are available
    const currentTime = `${course.day} ${course.hour}`;

    // Count how many students from same group available at each time
    const groupKey = student.adult ?
      `${student.sex}-${student.skillLevel}` :
      student.trainigGroup;

    const sameGroupStudents = students.filter(s => {
      if (student.adult) {
        return s.adult && s.sex === student.sex && s.skillLevel === student.skillLevel;
      } else {
        return !s.adult && s.trainigGroup === student.trainigGroup;
      }
    });

    const timeSlotPopularity = new Map();
    sameGroupStudents.forEach(s => {
      (s.availableTimes || []).forEach(time => {
        if (!timeSlotPopularity.has(time)) timeSlotPopularity.set(time, 0);
        timeSlotPopularity.set(time, timeSlotPopularity.get(time) + 1);
      });
    });

    const currentPopularity = timeSlotPopularity.get(currentTime) || 0;
    const bestTime = Array.from(timeSlotPopularity.entries())
      .sort((a, b) => b[1] - a[1])[0];

    if (bestTime && bestTime[1] > currentPopularity + 2 &&
        student.availableTimes.includes(bestTime[0])) {
      suboptimalPlacements.push({
        student: `${student.firstName} ${student.lastName}`,
        group: groupKey,
        current: `${currentTime} (${currentPopularity} group members)`,
        better: `${bestTime[0]} (${bestTime[1]} group members)`,
        difference: bestTime[1] - currentPopularity
      });
    }
  }
}

if (suboptimalPlacements.length > 0) {
  console.log(`   Found ${suboptimalPlacements.length} potentially suboptimal placements:\n`);
  suboptimalPlacements.slice(0, 10).forEach((p, i) => {
    console.log(`   ${i+1}. ${p.student} (${p.group})`);
    console.log(`      Current: ${p.current}`);
    console.log(`      Better: ${p.better} (+${p.difference} potential classmates)\n`);
  });
} else {
  console.log('   ✅ All students placed at optimal time slots!\n');
}

// ===========================================
// ANALYSIS 4: Full course potential at each time slot
// ===========================================
console.log('🔍 ANALYSIS 4: Time Slots with Full Course Potential\n');

const timeSlotAnalysis = new Map();

students.forEach(s => {
  const groupKey = s.adult ? `adult-${s.sex}-${s.skillLevel}` : `child-${s.trainigGroup}`;

  (s.availableTimes || []).forEach(time => {
    const key = `${time}|${groupKey}`;
    if (!timeSlotAnalysis.has(key)) {
      timeSlotAnalysis.set(key, { time, groupKey, students: [] });
    }
    timeSlotAnalysis.get(key).students.push(s);
  });
});

const fullCoursePotential = Array.from(timeSlotAnalysis.values())
  .filter(a => a.students.length >= 4)
  .sort((a, b) => b.students.length - a.students.length);

console.log(`   Time slots with 4+ same-group students:\n`);
fullCoursePotential.slice(0, 15).forEach((slot, i) => {
  const numFullCourses = Math.floor(slot.students.length / 4);
  const coaches = coachByTimeSlot.get(slot.time) || [];
  const childrenCoaches = coaches.filter(c => c.isCoachingChildren).length;
  const adultCoaches = coaches.filter(c => c.isCoachingAdult).length;

  const isChildren = !slot.groupKey.startsWith('adult');
  const hasCoach = isChildren ? childrenCoaches > 0 : adultCoaches > 0;

  // Check how many are ACTUALLY placed at this time in manual plan
  const actualCourses = manualPlan.courses.filter(c =>
    `${c.day} ${c.hour}` === slot.time &&
    c.groupLabel.includes(slot.groupKey.split('-').pop())
  );

  const actualStudents = actualCourses.reduce((sum, c) => sum + c.students.length, 0);
  const actualFullCourses = actualCourses.filter(c => c.students.length === 4).length;

  const status = hasCoach ? '✅' : '❌ NO COACH';
  const efficiency = actualFullCourses === numFullCourses ? '✅ OPTIMAL' :
                     actualFullCourses === 0 ? '❌ MISSED' : '⚠️  PARTIAL';

  console.log(`   ${i+1}. ${slot.time} - ${slot.groupKey}`);
  console.log(`      Potential: ${slot.students.length} students → ${numFullCourses} full courses ${status}`);
  console.log(`      Actual: ${actualStudents} students, ${actualFullCourses} full courses ${efficiency}\n`);
});

// ===========================================
// SUMMARY & RECOMMENDATIONS
// ===========================================
console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║   OPTIMIZATION SUMMARY                                     ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

console.log(`📊 FINDINGS:\n`);
console.log(`   1. Consolidation Opportunities: ${consolidationOpportunities.length}`);
console.log(`   2. Suboptimal Placements: ${suboptimalPlacements.length}`);
console.log(`   3. Full Course Potential Slots: ${fullCoursePotential.length}`);
console.log(`   4. Donnerstag 18 Issue: ${donnerstag18Students.length} students blocked by coach availability\n`);

if (consolidationOpportunities.length > 0) {
  console.log(`✅ OPTIMIZATION POSSIBLE:`);
  console.log(`   - Move ${consolidationOpportunities.length} students to fuller courses`);
  console.log(`   - Potential to create +${consolidationOpportunities.filter(o => o.benefit.includes('FULL')).length} full courses`);
  console.log(`   - Reduce singles/pairs by consolidating\n`);
} else {
  console.log(`✅ PLAN IS OPTIMAL given current constraints!\n`);
}

console.log(`🚨 PRIMARY BLOCKER:`);
console.log(`   Donnerstag 18:00 - No children coach available`);
console.log(`   Impact: ${donnerstag18Students.length} students (potential +${Math.floor(donnerstag18Students.length/4)} full courses)\n`);

mongoose.connection.close();
