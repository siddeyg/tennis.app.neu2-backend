import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({path:'./.env.development'});
await mongoose.connect(process.env.MONGO_URI||'mongodb://localhost:27017/tennis-coach');

const Student = mongoose.model('Student', new mongoose.Schema({}, {strict: false}), 'students');
const Coach = mongoose.model('Coach', new mongoose.Schema({}, {strict: false}), 'coaches');

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║   CREATING PERFECT OPTIMAL PLAN                            ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

const students = await Student.find({}).lean();
const coaches = await Coach.find({}).lean();

console.log(`📊 Loaded: ${students.length} students, ${coaches.length} coaches\n`);

// Build coach lookup
const coachByTimeSlot = new Map();
coaches.forEach(coach => {
  (coach.availableTimes || []).forEach(slot => {
    const key = `${slot.day} ${slot.hour}`;
    if (!coachByTimeSlot.has(key)) coachByTimeSlot.set(key, []);
    coachByTimeSlot.get(key).push(coach);
  });
});

const getSuitableCoaches = (student, timeToken) => {
  const available = coachByTimeSlot.get(timeToken) || [];
  if (student.adult) {
    return available.filter(c => c.isCoachingAdult);
  } else {
    return available.filter(c => c.isCoachingChildren);
  }
};

// Helper: Check if two students can be in same course
const canBeInSameCourse = (student1, student2) => {
  if (student1.adult !== student2.adult) return false;
  if (student1.adult) {
    if (student1.sex !== student2.sex) return false;
    return student1.skillLevel === student2.skillLevel;
  } else {
    return student1.trainigGroup === student2.trainigGroup;
  }
};

// Build time slot analysis - GROUP students by level/group/gender at each time
console.log('🔍 Analyzing time slot opportunities...\n');

const timeSlotGroups = new Map();

students.forEach(s => {
  let groupKey;
  if (s.adult) {
    const gender = s.sex || 'unknown';
    groupKey = `adult-${gender}-${s.skillLevel}`;
  } else {
    groupKey = `child-${s.trainigGroup}`;
  }

  (s.availableTimes || []).forEach(slot => {
    const time = `${slot.day} ${slot.hour}`;
    const key = `${time}|${groupKey}`;
    if (!timeSlotGroups.has(key)) {
      timeSlotGroups.set(key, { time, groupKey, students: [] });
    }
    timeSlotGroups.get(key).students.push(s);
  });
});

// Sort by MOST full courses possible (greedy approach for maximum efficiency)
const opportunities = Array.from(timeSlotGroups.values())
  .map(g => ({
    ...g,
    numFullCourses: Math.floor(g.students.length / 4),
    hasCoach: getSuitableCoaches(g.students[0], g.time).length > 0
  }))
  .filter(g => g.numFullCourses > 0 && g.hasCoach)
  .sort((a, b) => {
    // Prioritize: most full courses first, then by total students
    if (a.numFullCourses !== b.numFullCourses) {
      return b.numFullCourses - a.numFullCourses;
    }
    return b.students.length - a.students.length;
  });

console.log(`   Found ${opportunities.length} opportunities for full courses\n`);
console.log('   Top 10 opportunities:');
opportunities.slice(0, 10).forEach((opp, i) => {
  console.log(`   ${i+1}. ${opp.time} - ${opp.groupKey}: ${opp.students.length} students → ${opp.numFullCourses} full courses`);
});

// ===========================================
// CREATE PERFECT PLAN - GREEDY FULL COURSE FIRST
// ===========================================
console.log('\n\n🎯 Creating perfect plan...\n');

const courses = [];
const assignedStudents = new Set();
let courseId = 1;

// PHASE 1: Create ALL possible full courses at best time slots
console.log('PHASE 1: Creating full 4-student courses...');

for (const opp of opportunities) {
  const unassigned = opp.students.filter(s => !assignedStudents.has(String(s._id)));
  if (unassigned.length < 4) continue;

  const coachList = getSuitableCoaches(unassigned[0], opp.time);
  if (coachList.length === 0) continue;

  const [day, hourStr] = opp.time.split(' ');
  const hour = Number(hourStr);

  // Create as many full courses as possible at this slot
  const numFullCourses = Math.floor(unassigned.length / 4);

  for (let i = 0; i < numFullCourses; i++) {
    const coachIndex = i % coachList.length;
    const coach = coachList[coachIndex];

    const courseStudents = unassigned.slice(i * 4, i * 4 + 4);

    courses.push({
      id: courseId++,
      day,
      hour,
      groupLabel: opp.groupKey,
      coach: `${coach.firstName} ${coach.lastName}`,
      students: courseStudents.map(s => ({
        id: String(s._id),
        name: `${s.firstName} ${s.lastName}`,
        gender: s.sex || 'unknown',
        level: s.adult ? s.skillLevel : s.trainigGroup
      }))
    });

    courseStudents.forEach(s => assignedStudents.add(String(s._id)));
  }

  if (numFullCourses > 0) {
    console.log(`   ✅ ${opp.time} - ${opp.groupKey}: Created ${numFullCourses} full courses (${numFullCourses * 4} students)`);
  }
}

const fullCoursesCreated = courses.filter(c => c.students.length === 4).length;
console.log(`\n   Total full courses: ${fullCoursesCreated} (${fullCoursesCreated * 4} students assigned)\n`);

// PHASE 2: Fill existing courses to capacity (3 → 4)
console.log('PHASE 2: Filling courses to 4 students...');

const unassigned2 = students.filter(s => !assignedStudents.has(String(s._id)));
unassigned2.sort((a, b) => (a.availableTimes?.length || 0) - (b.availableTimes?.length || 0));

let phase2Count = 0;
for (const student of unassigned2) {
  let bestMatch = null;

  for (const timeSlot of (student.availableTimes || [])) {
    const day = timeSlot.day;
    const hour = Number(timeSlot.hour);
    const timeToken = `${day} ${hour}`;

    // Find courses at this time with space
    const coursesAtTime = courses.filter(c =>
      c.day === day && c.hour === hour && c.students.length < 4
    );

    for (const course of coursesAtTime) {
      // Check compatibility
      const courseStudents = course.students.map(cs =>
        students.find(s => String(s._id) === cs.id)
      ).filter(Boolean);

      const allCompatible = courseStudents.every(cs => canBeInSameCourse(student, cs));
      if (!allCompatible) continue;

      // Prefer fuller courses (3 → 4 is best)
      if (!bestMatch || course.students.length > bestMatch.course.students.length) {
        bestMatch = { course, coaches: getSuitableCoaches(student, timeToken) };
      }
    }
  }

  if (bestMatch && bestMatch.course.students.length < 4) {
    bestMatch.course.students.push({
      id: String(student._id),
      name: `${student.firstName} ${student.lastName}`,
      gender: student.sex || 'unknown',
      level: student.adult ? student.skillLevel : student.trainigGroup
    });
    assignedStudents.add(String(student._id));
    phase2Count++;
  }
}

console.log(`   ✅ Filled ${phase2Count} students into existing courses\n`);

// PHASE 3: Create 3-student courses
console.log('PHASE 3: Creating 3-student courses...');

const unassigned3 = students.filter(s => !assignedStudents.has(String(s._id)));
const groups3 = new Map();

unassigned3.forEach(s => {
  let groupKey;
  if (s.adult) {
    const gender = s.sex || 'unknown';
    groupKey = `adult-${gender}-${s.skillLevel}`;
  } else {
    groupKey = `child-${s.trainigGroup}`;
  }

  (s.availableTimes || []).forEach(slot => {
    const time = `${slot.day} ${slot.hour}`;
    const key = `${time}|${groupKey}`;
    if (!groups3.has(key)) {
      groups3.set(key, { time, groupKey, students: [] });
    }
    groups3.get(key).students.push(s);
  });
});

const opportunities3 = Array.from(groups3.values())
  .filter(g => g.students.length >= 3 && getSuitableCoaches(g.students[0], g.time).length > 0)
  .sort((a, b) => b.students.length - a.students.length);

let phase3Count = 0;
for (const opp of opportunities3) {
  const unassigned = opp.students.filter(s => !assignedStudents.has(String(s._id)));
  if (unassigned.length < 3) continue;

  const coachList = getSuitableCoaches(unassigned[0], opp.time);
  if (coachList.length === 0) continue;

  const [day, hourStr] = opp.time.split(' ');
  const hour = Number(hourStr);

  const courseStudents = unassigned.slice(0, 3);

  courses.push({
    id: courseId++,
    day,
    hour,
    groupLabel: opp.groupKey,
    coach: `${coachList[0].firstName} ${coachList[0].lastName}`,
    students: courseStudents.map(s => ({
      id: String(s._id),
      name: `${s.firstName} ${s.lastName}`,
      gender: s.sex || 'unknown',
      level: s.adult ? s.skillLevel : s.trainigGroup
    }))
  });

  courseStudents.forEach(s => assignedStudents.add(String(s._id)));
  phase3Count += 3;
}

console.log(`   ✅ Created ${phase3Count / 3} three-student courses (${phase3Count} students)\n`);

// PHASE 4: Create 2-student courses
console.log('PHASE 4: Creating 2-student courses...');

const unassigned4 = students.filter(s => !assignedStudents.has(String(s._id)));
unassigned4.sort((a, b) => (a.availableTimes?.length || 0) - (b.availableTimes?.length || 0));

let phase4Count = 0;
for (const student of unassigned4) {
  if (assignedStudents.has(String(student._id))) continue;

  // Find another student from same group at same time
  const groupStudents = unassigned4.filter(s =>
    !assignedStudents.has(String(s._id)) &&
    String(s._id) !== String(student._id) &&
    canBeInSameCourse(student, s)
  );

  let partner = null;
  let bestTime = null;

  for (const timeSlot of (student.availableTimes || [])) {
    const timeToken = `${timeSlot.day} ${timeSlot.hour}`;
    const partnerAtTime = groupStudents.find(s =>
      (s.availableTimes || []).some(t => `${t.day} ${t.hour}` === timeToken)
    );

    if (partnerAtTime) {
      const coaches = getSuitableCoaches(student, timeToken);
      if (coaches.length > 0) {
        partner = partnerAtTime;
        bestTime = timeToken;
        break;
      }
    }
  }

  if (partner && bestTime) {
    const [day, hourStr] = bestTime.split(' ');
    const hour = Number(hourStr);
    const coaches = getSuitableCoaches(student, bestTime);

    const groupKey = student.adult ?
      `adult-${student.sex || 'unknown'}-${student.skillLevel}` :
      `child-${student.trainigGroup}`;

    courses.push({
      id: courseId++,
      day,
      hour,
      groupLabel: groupKey,
      coach: `${coaches[0].firstName} ${coaches[0].lastName}`,
      students: [student, partner].map(s => ({
        id: String(s._id),
        name: `${s.firstName} ${s.lastName}`,
        gender: s.sex || 'unknown',
        level: s.adult ? s.skillLevel : s.trainigGroup
      }))
    });

    assignedStudents.add(String(student._id));
    assignedStudents.add(String(partner._id));
    phase4Count += 2;
  }
}

console.log(`   ✅ Created ${phase4Count / 2} two-student courses (${phase4Count} students)\n`);

// PHASE 5: Create singles (last resort)
console.log('PHASE 5: Creating single-student courses...');

const unassigned5 = students.filter(s => !assignedStudents.has(String(s._id)));
let phase5Count = 0;

for (const student of unassigned5) {
  if (!student.availableTimes || student.availableTimes.length === 0) continue;

  const timeSlot = student.availableTimes[0];
  const timeToken = `${timeSlot.day} ${timeSlot.hour}`;
  const coaches = getSuitableCoaches(student, timeToken);

  if (coaches.length === 0) continue;

  const day = timeSlot.day;
  const hour = Number(timeSlot.hour);

  const groupKey = student.adult ?
    `adult-${student.sex || 'unknown'}-${student.skillLevel}` :
    `child-${student.trainigGroup}`;

  courses.push({
    id: courseId++,
    day,
    hour,
    groupLabel: groupKey,
    coach: `${coaches[0].firstName} ${coaches[0].lastName}`,
    students: [{
      id: String(student._id),
      name: `${student.firstName} ${student.lastName}`,
      gender: student.sex || 'unknown',
      level: student.adult ? student.skillLevel : student.trainigGroup
    }]
  });

  assignedStudents.add(String(student._id));
  phase5Count++;
}

console.log(`   ✅ Created ${phase5Count} single-student courses\n`);

// ===========================================
// STATISTICS
// ===========================================
const courseSizes = { 1: 0, 2: 0, 3: 0, 4: 0 };
courses.forEach(c => {
  const size = Math.min(c.students.length, 4);
  courseSizes[size]++;
});

const unassignedCount = students.length - assignedStudents.size;

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║   PERFECT PLAN RESULTS                                     ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

console.log('📊 STATISTICS:\n');
console.log(`   Total Students: ${students.length}`);
console.log(`   Assigned: ${assignedStudents.size} (${(assignedStudents.size/students.length*100).toFixed(1)}%)`);
console.log(`   Unassigned: ${unassignedCount}\n`);

console.log(`   Total Courses: ${courses.length}\n`);
console.log(`   4 students: ${courseSizes[4]} courses (${(courseSizes[4]/courses.length*100).toFixed(1)}%) ⭐`);
console.log(`   3 students: ${courseSizes[3]} courses (${(courseSizes[3]/courses.length*100).toFixed(1)}%)`);
console.log(`   2 students: ${courseSizes[2]} courses (${(courseSizes[2]/courses.length*100).toFixed(1)}%)`);
console.log(`   1 student:  ${courseSizes[1]} courses (${(courseSizes[1]/courses.length*100).toFixed(1)}%)\n`);

console.log(`   Efficiency: ${((courseSizes[4]+courseSizes[3])/courses.length*100).toFixed(1)}% courses are 3-4 students\n`);

const adultCourses = courses.filter(c => c.groupLabel.startsWith('adult')).length;
const childCourses = courses.filter(c => c.groupLabel.startsWith('child')).length;

// Save to file
const perfectPlan = {
  metadata: {
    title: "Perfect Optimal Plan (Greedy Full-Course First)",
    created: new Date().toISOString(),
    createdBy: "Automated Optimization Algorithm",
    description: "Maximizes full 4-student courses using greedy approach with strict gender matching"
  },
  statistics: {
    totalCourses: courses.length,
    course4: courseSizes[4],
    course3: courseSizes[3],
    course2: courseSizes[2],
    course1: courseSizes[1],
    assigned: assignedStudents.size,
    unassigned: unassignedCount,
    adultCourses,
    childCourses
  },
  courses
};

fs.writeFileSync('perfect-optimal-plan.json', JSON.stringify(perfectPlan, null, 2));
console.log('✅ Saved to: perfect-optimal-plan.json\n');

// Compare with manual plan
const manualPlan = JSON.parse(fs.readFileSync('manual-optimal-plan.json', 'utf8'));

console.log('📊 COMPARISON: Perfect vs Manual Plan\n');
console.log(`                        PERFECT    MANUAL`);
console.log(`   Total Courses:       ${courses.length.toString().padStart(7)}    ${manualPlan.statistics.totalCourses.toString().padStart(6)}`);
console.log(`   4-student courses:   ${courseSizes[4].toString().padStart(7)}    ${manualPlan.statistics.course4.toString().padStart(6)}  ${courseSizes[4] > manualPlan.statistics.course4 ? '✅' : ''}`);
console.log(`   3-student courses:   ${courseSizes[3].toString().padStart(7)}    ${manualPlan.statistics.course3.toString().padStart(6)}`);
console.log(`   2-student courses:   ${courseSizes[2].toString().padStart(7)}    ${manualPlan.statistics.course2.toString().padStart(6)}`);
console.log(`   1-student courses:   ${courseSizes[1].toString().padStart(7)}    ${manualPlan.statistics.course1.toString().padStart(6)}`);
console.log(`   Efficiency (3-4):    ${((courseSizes[4]+courseSizes[3])/courses.length*100).toFixed(1).padStart(6)}%    ${((manualPlan.statistics.course4+manualPlan.statistics.course3)/manualPlan.statistics.totalCourses*100).toFixed(1).padStart(5)}%\n`);

if (courseSizes[4] > manualPlan.statistics.course4) {
  const improvement = courseSizes[4] - manualPlan.statistics.course4;
  console.log(`🎉 IMPROVEMENT: +${improvement} full courses (${improvement * 4} students better placed)!\n`);
}

mongoose.connection.close();
