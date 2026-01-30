import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({path:'./.env.development'});
await mongoose.connect(process.env.MONGO_URI||'mongodb://localhost:27017/tennis-coach');

// Import models
const Student = mongoose.model('Student', new mongoose.Schema({}, {strict: false}), 'students');
const Coach = mongoose.model('Coach', new mongoose.Schema({}, {strict: false}), 'coaches');
const Settings = mongoose.model('Settings', new mongoose.Schema({}, {strict: false}), 'settings');
const SavedSchedule = mongoose.model('SavedSchedule', new mongoose.Schema({}, {strict: false}), 'savedschedules');

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║   OPTIMAL COURSE PLAN GENERATOR                            ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Fetch all data
const students = await Student.find({}).lean();
const coaches = await Coach.find({}).lean();
const settings = await Settings.findOne({}).lean();

console.log(`📊 Loaded: ${students.length} students, ${coaches.length} coaches\n`);

// Helper functions
const areAdultSkillLevelsCompatible = (level1, level2) => {
  if (level1 === level2) return true;
  const advancedPair = ["gute:r Spieler:in", "Fortgeschritten"];
  const beginnerPair = ["Anfänger", "wenig Fortgeschritten", "Anfänger mit Grundkenntnissen"];
  return (
    (advancedPair.includes(level1) && advancedPair.includes(level2)) ||
    (beginnerPair.includes(level1) && beginnerPair.includes(level2))
  );
};

const areChildrenGroupsCompatible = (group1, group2) => {
  if (group1 === group2) return true;
  const adjacentPairs = [
    ["Kinderland", "Rot"],
    ["Rot", "Orange"],
    ["Orange", "Grün"],
    ["Gelb Hobby", "Gelb Team"]
  ];
  return adjacentPairs.some(pair => pair.includes(group1) && pair.includes(group2));
};

const getMaxCapacity = (student, settings) => {
  if (!settings?.courseCapacity) return 4;
  const { capacityByGroup, defaultMaxStudents } = settings.courseCapacity;
  if (student.adult) return capacityByGroup.Erwachsene || defaultMaxStudents || 4;
  return capacityByGroup[student.trainigGroup] || defaultMaxStudents || 4;
};

// Build lookup structures
const coachById = new Map();
coaches.forEach(c => coachById.set(String(c._id), c));

const coachesByTimeSlot = new Map();
coaches.forEach(coach => {
  (coach.availableTimes || []).forEach(time => {
    if (!coachesByTimeSlot.has(time)) coachesByTimeSlot.set(time, []);
    coachesByTimeSlot.get(time).push(coach);
  });
});

const adultCoaches = new Set(coaches.filter(c => c.isCoachingAdult).map(c => String(c._id)));
const childrenCoaches = new Set(coaches.filter(c => c.isCoachingChildren).map(c => String(c._id)));

const getSuitableCoaches = (student, timeToken) => {
  const available = coachesByTimeSlot.get(timeToken) || [];
  const qualified = student.adult ? adultCoaches : childrenCoaches;
  return available.filter(c => qualified.has(String(c._id)));
};

const courseMap = new Map();
const getOrCreateCourse = (day, hour, coach) => {
  const key = `${day}-${hour}-${coach._id}`;
  if (!courseMap.has(key)) {
    courseMap.set(key, {
      day,
      hour: parseInt(hour),
      coach: coach._id,
      coachName: `${coach.firstName} ${coach.lastName}`,
      students: []
    });
  }
  return courseMap.get(key);
};

const assignedStudents = new Set();
let stats = { phase0: 0, phase1: 0, phase2: 0, phase3: 0, phase4: 0, phase5: 0 };

// ========================================
// PHASE 0: RESERVE SLOTS FOR CRITICALLY CONSTRAINED STUDENTS
// ========================================
console.log('🎯 PHASE 0: Reserving slots for critically constrained students (≤2 time slots)...');

// Find students with very limited availability (≤2 time slots)
const criticalStudents = students.filter(s =>
  s.availableTimes && s.availableTimes.length > 0 && s.availableTimes.length <= 2
);

// Sort by flexibility (least flexible first)
criticalStudents.sort((a, b) =>
  (a.availableTimes?.length || 0) - (b.availableTimes?.length || 0)
);

console.log(`   Found ${criticalStudents.length} critically constrained students (≤2 slots)`);

// Helper: Check if two students can be in same course (gender check for adults)
const canBeInSameCourse = (student1, student2) => {
  // Must be same type (both adult or both children)
  if (student1.adult !== student2.adult) return false;

  if (student1.adult) {
    // For adults: Must match gender AND skill level
    if (student1.sex !== student2.sex) return false;
    return student1.skillLevel === student2.skillLevel;
  } else {
    // For children: Only match training group (no gender check)
    return student1.trainigGroup === student2.trainigGroup;
  }
};

// Assign each critical student to their BEST available slot
for (const student of criticalStudents) {
  let assigned = false;

  for (const timeToken of student.availableTimes) {
    if (assigned) break;

    const [day, hourStr] = timeToken.split(" ");
    const hour = parseInt(hourStr);
    const coachList = getSuitableCoaches(student, timeToken);

    if (coachList.length === 0) continue;

    // Try to join an existing course with same level/group/gender
    for (const coach of coachList) {
      const course = getOrCreateCourse(day, hour, coach);

      // Check if course has space
      const maxCap = getMaxCapacity(student, settings);
      if (course.students.length >= maxCap) continue;

      // If course has students, check compatibility (including gender for adults)
      if (course.students.length > 0) {
        const courseStudents = students.filter(s => course.students.includes(s._id));
        const allCompatible = courseStudents.every(s => canBeInSameCourse(student, s));
        if (!allCompatible) continue;
      }

      // Assign student
      course.students.push(student._id);
      assignedStudents.add(String(student._id));
      stats.phase0++;
      assigned = true;
      break;
    }
  }

  if (assigned) {
    const level = student.adult ? student.skillLevel : student.trainigGroup;
    console.log(`   ✅ ${student.firstName} ${student.lastName} (${level}, ${student.availableTimes.length} slots) assigned`);
  }
}

console.log(`   ✅ Phase 0: ${stats.phase0}/${criticalStudents.length} critical students assigned`);

// ========================================
// PHASE 1: CREATE FULL COURSES (4 students) - WITH GENDER MATCHING
// ========================================
console.log('🎯 PHASE 1: Creating full courses (4 students each)...');

// Group students by exact level/group AND gender for adults
const studentGroups = new Map();
students.forEach(s => {
  let key;
  if (s.adult) {
    // For adults: Include gender in grouping (strict gender matching)
    const gender = s.sex || 'unknown';
    key = `adult-${gender}-${s.skillLevel}`;
  } else {
    // For children: No gender separation
    key = `child-${s.trainigGroup}`;
  }
  if (!studentGroups.has(key)) studentGroups.set(key, []);
  studentGroups.get(key).push(s);
});

const fullCourseOpportunities = [];
studentGroups.forEach((groupStudents, groupKey) => {
  const timeSlotCounts = new Map();
  groupStudents.forEach(s => {
    (s.availableTimes || []).forEach(time => {
      if (!timeSlotCounts.has(time)) timeSlotCounts.set(time, []);
      timeSlotCounts.get(time).push(s);
    });
  });

  timeSlotCounts.forEach((studentsAtTime, timeToken) => {
    if (studentsAtTime.length >= 4) {
      const [day, hourStr] = timeToken.split(" ");
      fullCourseOpportunities.push({
        groupKey, timeToken, day, hour: parseInt(hourStr),
        students: studentsAtTime, count: studentsAtTime.length
      });
    }
  });
});

// Sort by count (largest groups first for efficiency)
fullCourseOpportunities.sort((a, b) => b.count - a.count);

console.log(`   Found ${fullCourseOpportunities.length} opportunities for full courses`);

// Log top 5 opportunities
if (fullCourseOpportunities.length > 0) {
  console.log(`   Top opportunities:`);
  fullCourseOpportunities.slice(0, 5).forEach((opp, i) => {
    const numCourses = Math.floor(opp.count / 4);
    console.log(`      ${i+1}. ${opp.groupKey} @ ${opp.timeToken}: ${opp.count} students → ${numCourses} full courses possible`);
  });
}

// BATCH PROCESSING: Create ALL possible full courses at each opportunity
for (const opp of fullCourseOpportunities) {
  let unassigned = opp.students.filter(s => !assignedStudents.has(String(s._id)));
  if (unassigned.length < 4) continue;

  const coachList = getSuitableCoaches(unassigned[0], opp.timeToken);
  if (coachList.length === 0) {
    console.log(`   ⚠️  ${opp.groupKey} @ ${opp.timeToken}: ${unassigned.length} students but NO COACHES`);
    continue;
  }

  // Calculate how many full courses we can create at this timeslot
  const maxCap = getMaxCapacity(unassigned[0], settings);
  const numFullCourses = Math.floor(unassigned.length / 4);

  console.log(`   📍 ${opp.groupKey} @ ${opp.timeToken}: ${unassigned.length} students → ${numFullCourses} full courses (${coachList.length} coaches)`);

  // Create ALL possible full courses at once (batch processing)
  let coursesCreated = 0;
  for (let courseNum = 0; courseNum < numFullCourses; courseNum++) {
    // Refresh unassigned list
    unassigned = opp.students.filter(s => !assignedStudents.has(String(s._id)));
    if (unassigned.length < 4) {
      console.log(`      ⚠️  Only ${unassigned.length} students left, stopping`);
      break;
    }

    // Use different coach if available to avoid overcrowding
    const coachIndex = courseNum % coachList.length;
    const coach = coachList[coachIndex];

    const course = getOrCreateCourse(opp.day, opp.hour, coach);

    // Skip if this coach's course already has students
    if (course.students.length > 0) {
      console.log(`      ⚠️  Coach ${coach.firstName} already has course, trying next`);
      continue;
    }

    // Add exactly 4 students to this course
    const numToAssign = Math.min(4, maxCap);
    for (let i = 0; i < numToAssign; i++) {
      const student = unassigned[i];
      course.students.push(student._id);
      assignedStudents.add(String(student._id));
      stats.phase1++;
    }
    coursesCreated++;
  }

  if (coursesCreated > 0) {
    console.log(`      ✅ Created ${coursesCreated} full courses`);
  }
}

console.log(`   ✅ ${stats.phase1} students → ${Array.from(courseMap.values()).filter(c => c.students.length === 4).length} full courses`);

// ========================================
// PHASE 2: FILL EXISTING COURSES
// ========================================
console.log('🎯 PHASE 2: Filling existing courses to capacity...');

const unassigned2 = students.filter(s => !assignedStudents.has(String(s._id)));
unassigned2.sort((a, b) => (a.availableTimes || []).length - (b.availableTimes || []).length);

for (const student of unassigned2) {
  let bestMatch = null;

  for (const timeToken of (student.availableTimes || [])) {
    const [day, hourStr] = timeToken.split(" ");
    const hour = parseInt(hourStr);
    const coachList = getSuitableCoaches(student, timeToken);

    for (const coach of coachList) {
      // STRICT FILL-FIRST: Only fill EXISTING non-empty courses
      const courseKey = `${day}-${hour}-${coach._id}`;
      const course = courseMap.get(courseKey);

      // Skip if course doesn't exist or is empty or full
      if (!course || course.students.length === 0 || course.students.length >= 4) continue;

      // Check compatibility using canBeInSameCourse (includes gender for adults)
      const courseStudents = students.filter(s => course.students.includes(s._id));
      const allCompatible = courseStudents.every(s => canBeInSameCourse(student, s));
      if (!allCompatible) continue;

      const maxCap = getMaxCapacity(student, settings);
      if (course.students.length >= maxCap) continue;

      if (!bestMatch || course.students.length > bestMatch.course.students.length) {
        bestMatch = { course, coach };
      }
    }
  }

  if (bestMatch) {
    bestMatch.course.students.push(student._id);
    assignedStudents.add(String(student._id));
    stats.phase2++;
  }
}

console.log(`   ✅ +${stats.phase2} students filled`);

// ========================================
// PHASE 3: CREATE SMALLER COURSES (2-3)
// ========================================
console.log('🎯 PHASE 3: Creating smaller courses (2-3 students)...');

const unassigned3 = students.filter(s => !assignedStudents.has(String(s._id)));

for (const student of unassigned3) {
  let bestMatch = null;

  for (const timeToken of (student.availableTimes || [])) {
    const [day, hourStr] = timeToken.split(" ");
    const hour = parseInt(hourStr);
    const coachList = getSuitableCoaches(student, timeToken);

    for (const coach of coachList) {
      const course = getOrCreateCourse(day, hour, coach);
      if (course.students.length >= 4) continue;

      // Check compatibility using canBeInSameCourse (includes gender for adults)
      if (course.students.length > 0) {
        const courseStudents = students.filter(s => course.students.includes(s._id));
        const allCompatible = courseStudents.every(s => canBeInSameCourse(student, s));
        if (!allCompatible) continue;
      }

      const maxCap = getMaxCapacity(student, settings);
      if (course.students.length >= maxCap) continue;

      if (!bestMatch || course.students.length > bestMatch.course.students.length) {
        bestMatch = { course, coach };
      }
    }
  }

  if (bestMatch) {
    bestMatch.course.students.push(student._id);
    assignedStudents.add(String(student._id));
    stats.phase3++;
  }
}

console.log(`   ✅ +${stats.phase3} students in smaller courses`);

// ========================================
// PHASE 4: RELAXED (adjacent levels)
// ========================================
console.log('🎯 PHASE 4: Relaxed mode (adjacent level mixing)...');

const unassigned4 = students.filter(s => !assignedStudents.has(String(s._id)));

for (const student of unassigned4) {
  let bestMatch = null;

  for (const timeToken of (student.availableTimes || [])) {
    const [day, hourStr] = timeToken.split(" ");
    const hour = parseInt(hourStr);
    const coachList = getSuitableCoaches(student, timeToken);

    for (const coach of coachList) {
      const course = getOrCreateCourse(day, hour, coach);
      if (course.students.length >= 4) continue;

      // Check adult/child mixing (never allowed) and gender (never mix for adults)
      if (course.students.length > 0) {
        const courseStudents = students.filter(s => course.students.includes(s._id));
        const allSameAdult = courseStudents.every(s => s.adult === student.adult);
        if (!allSameAdult) continue;

        // STRICT: Gender must match for adults (even in relaxed mode)
        if (student.adult) {
          const allSameGender = courseStudents.every(s => s.sex === student.sex);
          if (!allSameGender) continue;

          // Check adjacent level compatibility (this is what's "relaxed")
          const levels = [...new Set(courseStudents.map(s => s.skillLevel))];
          const allCompat = levels.every(l => areAdultSkillLevelsCompatible(student.skillLevel, l));
          const wouldCreateThird = !levels.includes(student.skillLevel) && levels.length >= 2;
          if (!allCompat || wouldCreateThird) continue;
        } else {
          // For children: Check adjacent group compatibility (no gender check)
          const groups = [...new Set(courseStudents.map(s => s.trainigGroup))];
          const allCompat = groups.every(g => areChildrenGroupsCompatible(student.trainigGroup, g));
          const wouldCreateThird = !groups.includes(student.trainigGroup) && groups.length >= 2;
          if (!allCompat || wouldCreateThird) continue;
        }
      }

      const maxCap = getMaxCapacity(student, settings);
      if (course.students.length >= maxCap) continue;

      if (!bestMatch || course.students.length > bestMatch.course.students.length) {
        bestMatch = { course, coach };
      }
    }
  }

  if (bestMatch) {
    bestMatch.course.students.push(student._id);
    assignedStudents.add(String(student._id));
    stats.phase4++;
  }
}

console.log(`   ✅ +${stats.phase4} students with adjacent mixing`);

// ========================================
// PHASE 5: SINGLES
// ========================================
console.log('🎯 PHASE 5: Single student courses (last resort)...');

const unassigned5 = students.filter(s => !assignedStudents.has(String(s._id)));

for (const student of unassigned5) {
  if (!student.availableTimes || student.availableTimes.length === 0) continue;

  const timeToken = student.availableTimes[0];
  const [day, hourStr] = timeToken.split(" ");
  const hour = parseInt(hourStr);
  const coachList = getSuitableCoaches(student, timeToken);

  if (coachList.length > 0) {
    const course = getOrCreateCourse(day, hour, coachList[0]);
    course.students.push(student._id);
    assignedStudents.add(String(student._id));
    stats.phase5++;
  }
}

console.log(`   ✅ +${stats.phase5} single students`);

// ========================================
// FINALIZE
// ========================================
const schedule = Array.from(courseMap.values());
const studentsNotSet = students.filter(s => !assignedStudents.has(String(s._id)));
const totalAssigned = stats.phase0 + stats.phase1 + stats.phase2 + stats.phase3 + stats.phase4 + stats.phase5;

// Course size analysis
const courseSizes = { 1: 0, 2: 0, 3: 0, 4: 0 };
schedule.forEach(c => {
  const size = Math.min(c.students.length, 4);
  courseSizes[size]++;
});

console.log(`\n📊 RESULTS:`);
console.log(`   Total Assigned: ${totalAssigned}/${students.length} (${(totalAssigned/students.length*100).toFixed(1)}%)`);
console.log(`   Total Courses: ${schedule.length}`);
console.log(`   Unassigned: ${studentsNotSet.length}`);
console.log(`\n📊 Course Size Distribution:`);
console.log(`   4 students: ${courseSizes[4]} courses (${((courseSizes[4]/schedule.length)*100).toFixed(1)}%)`);
console.log(`   3 students: ${courseSizes[3]} courses (${((courseSizes[3]/schedule.length)*100).toFixed(1)}%)`);
console.log(`   2 students: ${courseSizes[2]} courses (${((courseSizes[2]/schedule.length)*100).toFixed(1)}%)`);
console.log(`   1 student:  ${courseSizes[1]} courses (${((courseSizes[1]/schedule.length)*100).toFixed(1)}%)\n`);

// Save to SavedSchedule
const savedSchedule = new SavedSchedule({
  name: `Optimal Plan - ${new Date().toLocaleString('de-DE')}`,
  description: 'Automatically generated optimal course plan using Fill-First algorithm',
  createdBy: 'system',
  createdByEmail: 'system@tennisapp.local',
  students: students,
  coaches: coaches,
  schedule: schedule,
  studentsNotSet: studentsNotSet,
  metadata: {
    studentCount: students.length,
    coachCount: coaches.length,
    courseCount: schedule.length,
    unassignedCount: studentsNotSet.length
  }
});

await savedSchedule.save();
console.log(`✅ Saved to database as SavedSchedule: "${savedSchedule.name}"`);
console.log(`   ID: ${savedSchedule._id}\n`);

// Generate HTML table
const days = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const hours = Array.from(new Set(schedule.map(c => c.hour))).sort((a,b) => a-b);

let html = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Optimal Course Plan - ${new Date().toLocaleDateString('de-DE')}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    h1 { color: #333; text-align: center; }
    .stats { background: white; padding: 20px; margin-bottom: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .stats h2 { margin-top: 0; }
    table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
    th { background: #4CAF50; color: white; font-weight: bold; }
    .course { margin-bottom: 8px; padding: 8px; border-radius: 4px; }
    .course-4 { background: #d4edda; border-left: 4px solid #28a745; }
    .course-3 { background: #fff3cd; border-left: 4px solid #ffc107; }
    .course-2 { background: #ffe6cc; border-left: 4px solid #fd7e14; }
    .course-1 { background: #f8d7da; border-left: 4px solid #dc3545; }
    .coach { font-weight: bold; color: #0066cc; margin-bottom: 4px; }
    .student { font-size: 0.9em; margin-left: 8px; }
    .level { color: #666; font-style: italic; }
  </style>
</head>
<body>
  <h1>🎾 Optimal Course Plan</h1>

  <div class="stats">
    <h2>📊 Statistics</h2>
    <p><strong>Generated:</strong> ${new Date().toLocaleString('de-DE')}</p>
    <p><strong>Total Students:</strong> ${students.length} (${totalAssigned} assigned, ${studentsNotSet.length} unassigned)</p>
    <p><strong>Total Courses:</strong> ${schedule.length}</p>
    <p><strong>Assignment Rate:</strong> ${(totalAssigned/students.length*100).toFixed(1)}%</p>
    <p><strong>Phase Distribution:</strong></p>
    <ul>
      <li>Phase 0 (Critical reserve): ${stats.phase0} students</li>
      <li>Phase 1 (Full courses): ${stats.phase1} students</li>
      <li>Phase 2 (Fill existing): ${stats.phase2} students</li>
      <li>Phase 3 (Smaller courses): ${stats.phase3} students</li>
      <li>Phase 4 (Adjacent mixing): ${stats.phase4} students</li>
      <li>Phase 5 (Singles): ${stats.phase5} students</li>
    </ul>
    <p><strong>Course Efficiency:</strong></p>
    <ul>
      <li>4-student courses: ${courseSizes[4]} (${((courseSizes[4]/schedule.length)*100).toFixed(1)}%)</li>
      <li>3-student courses: ${courseSizes[3]} (${((courseSizes[3]/schedule.length)*100).toFixed(1)}%)</li>
      <li>2-student courses: ${courseSizes[2]} (${((courseSizes[2]/schedule.length)*100).toFixed(1)}%)</li>
      <li>1-student courses: ${courseSizes[1]} (${((courseSizes[1]/schedule.length)*100).toFixed(1)}%)</li>
    </ul>
  </div>

  <table>
    <thead>
      <tr>
        <th>Zeit</th>
`;

days.forEach(day => {
  html += `        <th>${day}</th>\n`;
});

html += `      </tr>
    </thead>
    <tbody>
`;

hours.forEach(hour => {
  html += `      <tr>\n        <td><strong>${hour}:00</strong></td>\n`;

  days.forEach(day => {
    const coursesAtTime = schedule.filter(c => c.day === day && c.hour === hour);
    html += `        <td>\n`;

    coursesAtTime.forEach(course => {
      const courseStudents = students.filter(s => course.students.includes(s._id));
      const coach = coaches.find(c => String(c._id) === String(course.coach));
      const sizeClass = `course-${Math.min(courseStudents.length, 4)}`;

      html += `          <div class="course ${sizeClass}">\n`;
      html += `            <div class="coach">👨‍🏫 ${coach ? `${coach.firstName} ${coach.lastName}` : 'Kein Trainer'}</div>\n`;

      courseStudents.forEach(student => {
        const level = student.adult ? student.skillLevel : student.trainigGroup;
        html += `            <div class="student">• ${student.firstName} ${student.lastName} <span class="level">(${level})</span></div>\n`;
      });

      html += `          </div>\n`;
    });

    html += `        </td>\n`;
  });

  html += `      </tr>\n`;
});

html += `    </tbody>
  </table>

  ${studentsNotSet.length > 0 ? `
  <div class="stats" style="margin-top: 20px; background: #f8d7da;">
    <h2>⚠️ Unassigned Students (${studentsNotSet.length})</h2>
    <ul>
      ${studentsNotSet.map(s => `<li>${s.firstName} ${s.lastName} - ${s.adult ? s.skillLevel : s.trainigGroup} (${(s.availableTimes || []).length} available times)</li>`).join('\n      ')}
    </ul>
  </div>
  ` : ''}

</body>
</html>
`;

fs.writeFileSync('optimal-course-plan.html', html);
console.log(`✅ HTML table saved to: optimal-course-plan.html\n`);

mongoose.connection.close();
