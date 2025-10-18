import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env.development') });

// Models
const studentSchema = new mongoose.Schema({}, { strict: false });
const coachSchema = new mongoose.Schema({}, { strict: false });
const settingsSchema = new mongoose.Schema({}, { strict: false });

const Student = mongoose.model('Student', studentSchema);
const Coach = mongoose.model('Coach', coachSchema);
const Settings = mongoose.model('Settings', settingsSchema);

// ============================================================================
// FILL-FIRST ALGORITHM - Backend Standalone Version
// ============================================================================
// This is the CORRECT algorithm that respects 1 coach per time slot constraint
// Ported from frontend/src/components/resetScheduleOptimized.js
// ============================================================================

// Helper: Are two adult skill levels compatible for mixing?
const areAdultSkillLevelsCompatible = (level1, level2) => {
  if (level1 === level2) return true;
  const advancedPair = ["gute:r Spieler:in", "Fortgeschritten"];
  const beginnerPair = ["Anfänger", "wenig Fortgeschritten", "Anfänger mit Grundkenntnissen"];
  return (
    (advancedPair.includes(level1) && advancedPair.includes(level2)) ||
    (beginnerPair.includes(level1) && beginnerPair.includes(level2))
  );
};

// Helper: Are two children training groups compatible for mixing?
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

// Helper: Get max capacity
const getMaxCapacity = (student, settings) => {
  if (!settings?.courseCapacity) return 4;
  const { capacityByGroup, defaultMaxStudents } = settings.courseCapacity;
  if (student.adult) return capacityByGroup?.Erwachsene || defaultMaxStudents;
  return capacityByGroup?.[student.trainigGroup] || defaultMaxStudents;
};

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

async function generateOptimalPlan() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const startTime = performance.now();

    // Fetch data
    const students = await Student.find().lean();
    const coaches = await Coach.find().lean();
    const settings = await Settings.findOne().lean();

    console.log(`📊 FILL-FIRST ALGORITHM: ${students.length} students, ${coaches.length} coaches\n`);

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

    // CRITICAL: This is the key function that prevents parallel courses!
    // Each coach can only have ONE course per time slot
    const courseMap = new Map();
    const getOrCreateCourse = (day, hour, coach) => {
      const key = `${day}-${hour}-${coach._id}`; // KEY INCLUDES COACH ID!
      if (!courseMap.has(key)) {
        courseMap.set(key, {
          day, hour,
          coachId: String(coach._id),
          coachName: `${coach.firstName} ${coach.lastName}`,
          students: []
        });
      }
      return courseMap.get(key);
    };

    const assignedStudents = new Set();
    let stats = { phase0: 0, phase1: 0, phase2: 0, phase3: 0, phase4: 0, phase5: 0, phase6Moved: 0, phase6Eliminated: 0 };

    // ========================================
    // PHASE 0: RESERVE SLOTS FOR CRITICALLY CONSTRAINED STUDENTS
    // ========================================
    console.log(`🎯 PHASE 0: Reserving slots for critically constrained students (≤2 time slots)...`);
    const p0Start = performance.now();

    const criticalStudents = students.filter(s =>
      s.availableTimes && s.availableTimes.length > 0 && s.availableTimes.length <= 2
    );

    criticalStudents.sort((a, b) =>
      (a.availableTimes?.length || 0) - (b.availableTimes?.length || 0)
    );

    console.log(`   Found ${criticalStudents.length} critically constrained students (≤2 slots)`);

    for (const student of criticalStudents) {
      let assigned = false;

      for (const timeToken of student.availableTimes) {
        if (assigned) break;

        const [day, hourStr] = timeToken.split(" ");
        const hour = parseInt(hourStr);
        const coaches = getSuitableCoaches(student, timeToken);

        if (coaches.length === 0) continue;

        for (const coach of coaches) {
          const course = getOrCreateCourse(day, hour, coach);

          const maxCap = getMaxCapacity(student, settings);
          if (course.students.length >= maxCap) continue;

          if (course.students.length > 0) {
            const allCompatible = course.students.every(s => canBeInSameCourse(student, s));
            if (!allCompatible) continue;
          }

          course.students.push(student);
          student.day = day;
          student.hour = hour;
          student.coach = String(coach._id);
          assignedStudents.add(String(student._id));
          stats.phase0++;
          assigned = true;
          break;
        }
      }

      if (assigned) {
        const level = student.adult ? student.skillLevel : student.trainigGroup;
        console.log(`   ✅ ${student.firstName} ${student.lastName} (${level}, ${student.availableTimes.length} slots) → ${student.day} ${student.hour}`);
      }
    }

    console.log(`✅ Phase 0: ${stats.phase0}/${criticalStudents.length} critical students assigned (${(performance.now() - p0Start).toFixed(0)}ms)`);

    // ========================================
    // PHASE 1: CREATE FULL COURSES (4 students)
    // ========================================
    console.log(`🎯 PHASE 1: Creating full courses (4 students each)...`);
    const p1Start = performance.now();

    const studentGroups = new Map();
    students.forEach(s => {
      let key;
      if (s.adult) {
        const gender = s.sex || 'unknown';
        key = `adult-${gender}-${s.skillLevel}`;
      } else {
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

    // Balanced priority sorting
    fullCourseOpportunities.sort((a, b) => {
      const avgFlexA = a.students.reduce((sum, s) =>
        sum + (s.availableTimes?.length || 0), 0) / a.students.length;
      const avgFlexB = b.students.reduce((sum, s) =>
        sum + (s.availableTimes?.length || 0), 0) / b.students.length;

      const numCoursesA = Math.floor(a.count / 4);
      const numCoursesB = Math.floor(b.count / 4);

      const urgencyA = 1 / (avgFlexA + 1);
      const urgencyB = 1 / (avgFlexB + 1);

      const scoreA = numCoursesA * urgencyA;
      const scoreB = numCoursesB * urgencyB;

      if (Math.abs(scoreA - scoreB) > 0.15) {
        return scoreB - scoreA;
      }

      if (a.count !== b.count) {
        return b.count - a.count;
      }

      return avgFlexA - avgFlexB;
    });

    console.log(`   Found ${fullCourseOpportunities.length} opportunities for full courses`);

    // BATCH PROCESSING: Create ALL possible full courses at high-overlap slots
    for (const opp of fullCourseOpportunities) {
      let unassigned = opp.students.filter(s => !assignedStudents.has(String(s._id)));
      if (unassigned.length < 4) continue;

      const coaches = getSuitableCoaches(unassigned[0], opp.timeToken);
      if (coaches.length === 0) {
        console.log(`   ⚠️  ${opp.groupKey} @ ${opp.timeToken}: ${unassigned.length} students but NO COACHES`);
        continue;
      }

      const maxCap = getMaxCapacity(unassigned[0], settings);
      const numFullCourses = Math.floor(unassigned.length / 4);

      console.log(`   📍 ${opp.groupKey} @ ${opp.timeToken}: ${unassigned.length} students → ${numFullCourses} full courses possible (${coaches.length} coaches)`);

      let coursesCreated = 0;
      for (let courseNum = 0; courseNum < numFullCourses; courseNum++) {
        unassigned = opp.students.filter(s => !assignedStudents.has(String(s._id)));
        if (unassigned.length < 4) {
          console.log(`      ⚠️  Only ${unassigned.length} students left, stopping`);
          break;
        }

        const coachIndex = courseNum % coaches.length;
        const coach = coaches[coachIndex];

        const course = getOrCreateCourse(opp.day, opp.hour, coach);

        if (course.students.length > 0) {
          console.log(`      ⚠️  Coach ${coach.firstName} already has course, trying next`);
          continue;
        }

        const numToAssign = Math.min(4, maxCap);
        for (let i = 0; i < numToAssign; i++) {
          const student = unassigned[i];
          course.students.push(student);
          student.day = opp.day;
          student.hour = opp.hour;
          student.coach = String(coach._id);
          assignedStudents.add(String(student._id));
          stats.phase1++;
        }
        coursesCreated++;
      }

      if (coursesCreated > 0) {
        console.log(`      ✅ Created ${coursesCreated} full courses`);
      }
    }

    console.log(`✅ Phase 1: ${stats.phase1} students → ${Array.from(courseMap.values()).filter(c => c.students.length === 4).length} full courses (${(performance.now() - p1Start).toFixed(0)}ms)`);

    // ========================================
    // PHASE 2: FILL EXISTING COURSES TO CAPACITY
    // ========================================
    console.log(`🎯 PHASE 2: Filling existing courses to capacity...`);
    const p2Start = performance.now();

    const unassigned2 = students.filter(s => !assignedStudents.has(String(s._id)));
    unassigned2.sort((a, b) => (a.availableTimes || []).length - (b.availableTimes || []).length);

    for (const student of unassigned2) {
      let bestMatch = null;

      for (const timeToken of (student.availableTimes || [])) {
        const [day, hourStr] = timeToken.split(" ");
        const hour = parseInt(hourStr);
        const coaches = getSuitableCoaches(student, timeToken);

        for (const coach of coaches) {
          const courseKey = `${day}-${hour}-${coach._id}`;
          const course = courseMap.get(courseKey);

          if (!course || course.students.length === 0 || course.students.length >= 4) continue;

          const allCompatible = course.students.every(s => canBeInSameCourse(student, s));
          if (!allCompatible) continue;

          const maxCap = getMaxCapacity(student, settings);
          if (course.students.length >= maxCap) continue;

          if (!bestMatch || course.students.length > bestMatch.course.students.length) {
            bestMatch = { course, coach };
          }
        }
      }

      if (bestMatch) {
        const maxCap = getMaxCapacity(student, settings);
        if (bestMatch.course.students.length < maxCap) {
          bestMatch.course.students.push(student);
          student.day = bestMatch.course.day;
          student.hour = bestMatch.course.hour;
          student.coach = String(bestMatch.coach._id);
          assignedStudents.add(String(student._id));
          stats.phase2++;
        }
      }
    }

    console.log(`✅ Phase 2: +${stats.phase2} students filled into existing courses (${(performance.now() - p2Start).toFixed(0)}ms)`);

    // ========================================
    // PHASE 3: CREATE SMALLER COURSES (2-3 students)
    // ========================================
    console.log(`🎯 PHASE 3: Creating smaller courses (2-3 students)...`);
    const p3Start = performance.now();

    const unassigned3 = students.filter(s => !assignedStudents.has(String(s._id)));
    unassigned3.sort((a, b) => (a.availableTimes || []).length - (b.availableTimes || []).length);

    for (const student of unassigned3) {
      let bestMatch = null;

      for (const timeToken of (student.availableTimes || [])) {
        const [day, hourStr] = timeToken.split(" ");
        const hour = parseInt(hourStr);
        const coaches = getSuitableCoaches(student, timeToken);

        for (const coach of coaches) {
          const course = getOrCreateCourse(day, hour, coach);

          if (course.students.length >= 4) continue;

          if (course.students.length > 0) {
            const allCompatible = course.students.every(s => canBeInSameCourse(student, s));
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
        const maxCap = getMaxCapacity(student, settings);
        if (bestMatch.course.students.length < maxCap) {
          bestMatch.course.students.push(student);
          student.day = bestMatch.course.day;
          student.hour = bestMatch.course.hour;
          student.coach = String(bestMatch.coach._id);
          assignedStudents.add(String(student._id));
          stats.phase3++;
        }
      }
    }

    console.log(`✅ Phase 3: +${stats.phase3} students in smaller courses (${(performance.now() - p3Start).toFixed(0)}ms)`);

    // ========================================
    // PHASE 4: RELAXED MODE (adjacent levels)
    // ========================================
    console.log(`🎯 PHASE 4: Relaxed mode (adjacent level mixing)...`);
    const p4Start = performance.now();

    const unassigned4 = students.filter(s => !assignedStudents.has(String(s._id)));

    const hardToPlace = unassigned4.filter(student => {
      if (!student.availableTimes || student.availableTimes.length > 2) return false;

      for (const timeToken of student.availableTimes) {
        const coaches = getSuitableCoaches(student, timeToken);
        if (coaches.length === 0) continue;

        for (const coach of coaches) {
          const [day, hourStr] = timeToken.split(" ");
          const hour = parseInt(hourStr);
          const courseKey = `${day}-${hour}-${coach._id}`;
          const course = courseMap.get(courseKey);

          if (!course) return false;

          if (course.students.length < 4) {
            const allCompatible = course.students.every(s => canBeInSameCourse(student, s));
            if (allCompatible) return false;
          }
        }
      }

      return true;
    });

    if (hardToPlace.length === 0) {
      console.log(`✅ Phase 4: SKIPPED - All students can be placed without level mixing`);
    } else {
      console.log(`   Processing ${hardToPlace.length}/${unassigned4.length} truly hard-to-place students`);
    }

    for (const student of hardToPlace) {
      let bestMatch = null;

      for (const timeToken of (student.availableTimes || [])) {
        const [day, hourStr] = timeToken.split(" ");
        const hour = parseInt(hourStr);
        const coaches = getSuitableCoaches(student, timeToken);

        for (const coach of coaches) {
          const course = getOrCreateCourse(day, hour, coach);

          if (course.students.length >= 4) continue;

          if (course.students.length > 0) {
            const allSameAdult = course.students.every(s => s.adult === student.adult);
            if (!allSameAdult) continue;

            if (student.adult) {
              const allSameGender = course.students.every(s => s.sex === student.sex);
              if (!allSameGender) continue;

              const levels = [...new Set(course.students.map(s => s.skillLevel))];
              const allCompat = levels.every(l => areAdultSkillLevelsCompatible(student.skillLevel, l));
              const wouldCreateThird = !levels.includes(student.skillLevel) && levels.length >= 2;
              if (!allCompat || wouldCreateThird) continue;
            } else {
              const groups = [...new Set(course.students.map(s => s.trainigGroup))];
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
        const maxCap = getMaxCapacity(student, settings);
        if (bestMatch.course.students.length < maxCap) {
          bestMatch.course.students.push(student);
          student.day = bestMatch.course.day;
          student.hour = bestMatch.course.hour;
          student.coach = String(bestMatch.coach._id);
          assignedStudents.add(String(student._id));
          stats.phase4++;
        }
      }
    }

    console.log(`✅ Phase 4: +${stats.phase4} students with adjacent level mixing (${(performance.now() - p4Start).toFixed(0)}ms)`);

    // ========================================
    // PHASE 5: SINGLES (last resort)
    // ========================================
    console.log(`🎯 PHASE 5: Single student courses (last resort)...`);
    const p5Start = performance.now();

    const unassigned5 = students.filter(s => !assignedStudents.has(String(s._id)));

    for (const student of unassigned5) {
      if (!student.availableTimes || student.availableTimes.length === 0) continue;

      let assigned = false;

      for (const timeToken of student.availableTimes) {
        const [day, hourStr] = timeToken.split(" ");
        const hour = parseInt(hourStr);
        const coaches = getSuitableCoaches(student, timeToken);

        for (const coach of coaches) {
          const course = getOrCreateCourse(day, hour, coach);

          const maxCap = getMaxCapacity(student, settings);
          if (course.students.length >= maxCap) {
            continue;
          }

          course.students.push(student);
          student.day = day;
          student.hour = hour;
          student.coach = String(coach._id);
          assignedStudents.add(String(student._id));
          stats.phase5++;
          assigned = true;
          break;
        }

        if (assigned) break;
      }
    }

    console.log(`✅ Phase 5: +${stats.phase5} single students (${(performance.now() - p5Start).toFixed(0)}ms)`);

    // ========================================
    // FINALIZE
    // ========================================
    const updatedSchedule = Array.from(courseMap.values());
    const studentsNotSet = students.filter(s => !assignedStudents.has(String(s._id)));

    students.forEach(s => {
      if (!assignedStudents.has(String(s._id))) {
        s.day = null;
        s.hour = null;
        s.coach = null;
      }
    });

    const totalTime = performance.now() - startTime;
    const totalAssigned = stats.phase0 + stats.phase1 + stats.phase2 + stats.phase3 + stats.phase4 + stats.phase5;

    const courseSizes = { 1: 0, 2: 0, 3: 0, 4: 0 };
    updatedSchedule.forEach(c => {
      const size = Math.min(c.students.length, 4);
      courseSizes[size]++;
    });

    console.log(`\n🎉 FILL-FIRST ALGORITHM Complete in ${totalTime.toFixed(0)}ms`);
    console.log(`\n📊 Results by Phase:`);
    console.log(`   Phase 0 (Critical reserve):  ${stats.phase0} students`);
    console.log(`   Phase 1 (Full courses):      ${stats.phase1} students`);
    console.log(`   Phase 2 (Fill existing):     ${stats.phase2} students`);
    console.log(`   Phase 3 (Smaller courses):   ${stats.phase3} students`);
    console.log(`   Phase 4 (Adjacent mixing):   ${stats.phase4} students`);
    console.log(`   Phase 5 (Singles):           ${stats.phase5} students`);
    console.log(`   Total Assigned:              ${totalAssigned}/${students.length} (${(totalAssigned/students.length*100).toFixed(1)}%)`);
    console.log(`   Unassigned:                  ${studentsNotSet.length}`);
    console.log(`\n📊 Course Size Distribution:`);
    console.log(`   4+ students: ${courseSizes[4]} courses`);
    console.log(`   3 students:  ${courseSizes[3]} courses`);
    console.log(`   2 students:  ${courseSizes[2]} courses`);
    console.log(`   1 student:   ${courseSizes[1]} courses`);
    console.log(`   Total:       ${updatedSchedule.length} courses`);
    console.log(`   Efficiency:  ${((courseSizes[4] + courseSizes[3])/updatedSchedule.length*100).toFixed(1)}% courses have 3-4 students\n`);

    // Verify NO parallel courses
    console.log('\n🔍 VERIFYING NO PARALLEL COURSES...');
    const coursesByTimeSlot = new Map();
    let parallelCoursesFound = 0;

    for (const course of updatedSchedule) {
      const timeKey = `${course.day} ${course.hour}`;
      if (!coursesByTimeSlot.has(timeKey)) coursesByTimeSlot.set(timeKey, []);
      coursesByTimeSlot.get(timeKey).push(course);
    }

    for (const [timeKey, coursesAtTime] of coursesByTimeSlot) {
      const coachCounts = new Map();
      for (const course of coursesAtTime) {
        const count = coachCounts.get(course.coachName) || 0;
        coachCounts.set(course.coachName, count + 1);
      }

      for (const [coachName, count] of coachCounts) {
        if (count > 1) {
          console.log(`   ❌ PARALLEL COURSE FOUND: ${coachName} has ${count} courses at ${timeKey}`);
          parallelCoursesFound++;
        }
      }
    }

    if (parallelCoursesFound === 0) {
      console.log('   ✅ NO PARALLEL COURSES - All coaches have max 1 course per time slot!');
    } else {
      console.log(`   ❌ FOUND ${parallelCoursesFound} parallel course violations!`);
    }

    // Save plan to JSON
    const planData = {
      metadata: {
        generatedAt: new Date().toISOString(),
        algorithm: 'Fill-First (resetScheduleOptimized.js)',
        totalCourses: updatedSchedule.length,
        totalStudents: students.length,
        assignedStudents: totalAssigned,
        unassignedStudents: studentsNotSet.length,
        fullCourses: courseSizes[4],
        threeCourses: courseSizes[3],
        twoCourses: courseSizes[2],
        singleCourses: courseSizes[1],
        efficiency: ((courseSizes[4] + courseSizes[3])/updatedSchedule.length*100).toFixed(1) + '%',
        parallelCoursesFound: parallelCoursesFound
      },
      courses: updatedSchedule.map(c => ({
        day: c.day,
        hour: c.hour,
        coach: c.coachName,
        coachId: c.coachId,
        numStudents: c.students.length,
        students: c.students.map(s => ({
          id: String(s._id),
          firstName: s.firstName,
          lastName: s.lastName,
          adult: s.adult,
          skillLevel: s.skillLevel,
          trainigGroup: s.trainigGroup,
          sex: s.sex
        }))
      })),
      unassigned: studentsNotSet.map(s => ({
        id: String(s._id),
        firstName: s.firstName,
        lastName: s.lastName,
        adult: s.adult,
        skillLevel: s.skillLevel,
        trainigGroup: s.trainigGroup,
        availableTimes: s.availableTimes || []
      }))
    };

    const fs = await import('fs');
    fs.writeFileSync(
      join(__dirname, 'correct-optimal-plan.json'),
      JSON.stringify(planData, null, 2)
    );

    console.log('\n✅ Plan saved to correct-optimal-plan.json');

    return planData;

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('\n🔗 Disconnected from MongoDB');
  }
}

generateOptimalPlan().catch(console.error);
