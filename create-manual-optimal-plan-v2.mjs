import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env.development') });

const studentSchema = new mongoose.Schema({}, { strict: false });
const coachSchema = new mongoose.Schema({}, { strict: false });

const Student = mongoose.model('Student', studentSchema);
const Coach = mongoose.model('Coach', coachSchema);

/**
 * MANUAL OPTIMAL PLAN CREATION V2
 *
 * Strategy based on deep analysis:
 * 1. Reserve slots for critically constrained students FIRST (≤2 available times)
 * 2. Focus on high-overlap opportunities (Montag 16, Donnerstag 15-16, Freitag 15-17)
 * 3. Create full 4-student courses where 4+ students overlap
 * 4. Use Falko (Freitag 15-19) and Ben/Joris (Montag/Donnerstag 15-16) strategically
 * 5. Distribute Nicole's load across her 51 available slots
 * 6. Respect 1 coach = 1 course per time slot (NO parallel courses)
 * 7. Maximize full courses over total assignment rate
 */

async function createManualOptimalPlan() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const students = await Student.find().lean();
    const coaches = await Coach.find().lean();

    console.log('=' .repeat(80));
    console.log('MANUAL OPTIMAL PLAN CREATION V2');
    console.log('=' .repeat(80));
    console.log(`${students.length} students, ${coaches.length} coaches\n`);

    // Build coach lookup
    const coachMap = new Map();
    coaches.forEach(c => {
      coachMap.set(String(c._id), c);
      coachMap.set(`${c.firstName} ${c.lastName}`, c);
    });

    const nicole = coaches.find(c => c.firstName === 'Nicole');
    const falko = coaches.find(c => c.firstName === 'Falko');
    const helge = coaches.find(c => c.firstName === 'Helge');
    const joris = coaches.find(c => c.firstName === 'Joris');
    const ben = coaches.find(c => c.firstName === 'Ben');

    console.log('📋 Coach availability:');
    console.log(`  Nicole: ${nicole.availableTimes.length} slots (adult + children)`);
    console.log(`  Falko: ${falko.availableTimes.length} slots (adults only, Freitag 15-19)`);
    console.log(`  Helge: ${helge.availableTimes.length} slots (adults only)`);
    console.log(`  Joris: ${joris.availableTimes.length} slots (children only)`);
    console.log(`  Ben: ${ben.availableTimes.length} slots (children only)`);

    // Track course assignments
    const courses = [];
    const assigned = new Set();
    let courseId = 1;

    // Helper function to create a course
    const createCourse = (day, hour, coach, students, reasoning) => {
      const course = {
        id: courseId++,
        day,
        hour,
        coachId: String(coach._id),
        coachName: `${coach.firstName} ${coach.lastName}`,
        students: students.map(s => ({
          id: String(s._id),
          firstName: s.firstName,
          lastName: s.lastName,
          adult: s.adult,
          skillLevel: s.skillLevel,
          trainigGroup: s.trainigGroup,
          sex: s.sex
        })),
        numStudents: students.length,
        reasoning
      };

      students.forEach(s => assigned.add(String(s._id)));
      courses.push(course);

      const isFull = students.length === 4 ? '✅ FULL' : '';
      console.log(`  Course ${course.id}: ${day} ${hour}:00 | ${coach.firstName} | ${students.length} students ${isFull}`);
      console.log(`    → ${students.map(s => `${s.firstName} ${s.lastName}`).join(', ')}`);
      console.log(`    💡 ${reasoning}\n`);

      return course;
    };

    // Helper to find students
    const findStudents = (filter) => {
      return students.filter(s => !assigned.has(String(s._id)) && filter(s));
    };

    // Track which coaches are used at which time slots
    const coachUsage = new Map(); // key: "day hour coachId" → true

    const isCoachAvailable = (day, hour, coach) => {
      const key = `${day} ${hour} ${coach._id}`;
      return !coachUsage.has(key);
    };

    const markCoachUsed = (day, hour, coach) => {
      const key = `${day} ${hour} ${coach._id}`;
      coachUsage.set(key, true);
    };

    console.log('\n🎯 PHASE 1: Reserve slots for CRITICALLY CONSTRAINED students (≤2 slots)\n');

    // Critical students identified from analysis
    const criticalPlacements = [
      // Adults
      { name: 'Andrea Muck', time: 'Samstag 10', coach: nicole, level: 'Fortgeschritten W' },
      { name: 'Andrea Frankenberg', time: 'Samstag 10', coach: nicole, level: 'Fortgeschritten W' },
      { name: 'Maike Just', time: 'Samstag 10', coach: nicole, level: 'Fortgeschritten W' },
      { name: 'Claudia Frank', time: 'Samstag 11', coach: nicole, level: 'Anfänger mit Grundkenntnissen W' },
      { name: 'Helga Heydweiller', time: 'Donnerstag 10', coach: nicole, level: 'Anfänger mit Grundkenntnissen W' },
      { name: 'Julia Leininger', time: 'Montag 18', coach: nicole, level: 'Anfänger mit Grundkenntnissen W' },
      { name: 'Claudia Gregor-Lawrenz', time: 'Montag 19', coach: nicole, level: 'Fortgeschritten W' },
      // Children
      { name: 'Josef Wong', time: 'Samstag 12', coach: nicole, level: 'Rot' },
      { name: 'Maja Dietzler', time: 'Mittwoch 16', coach: nicole, level: 'Rot' },
      { name: 'Joris Muck', time: 'Samstag 13', coach: nicole, level: 'Gelb Team' },
      { name: 'Paulina Muck', time: 'Dienstag 17', coach: nicole, level: 'Gelb Team' },
      { name: 'Juno Glaser', time: 'Dienstag 18', coach: nicole, level: 'Gelb Hobby' }
    ];

    const criticalCourseMap = new Map(); // key: "day hour coachId level"

    for (const placement of criticalPlacements) {
      const [day, hourStr] = placement.time.split(' ');
      const hour = parseInt(hourStr);

      const student = students.find(s =>
        s.firstName === placement.name.split(' ')[0] &&
        s.lastName === placement.name.split(' ').slice(1).join(' ')
      );

      if (!student || assigned.has(String(student._id))) continue;

      // Try to add to existing course or create new one
      const levelKey = student.adult
        ? `adult-${student.sex}-${student.skillLevel}`
        : `child-${student.trainigGroup}`;

      const courseKey = `${day} ${hour} ${placement.coach._id} ${levelKey}`;
      let course = criticalCourseMap.get(courseKey);

      if (!course) {
        // Create new course
        course = {
          day, hour,
          coach: placement.coach,
          students: [],
          levelKey
        };
        criticalCourseMap.set(courseKey, course);
        markCoachUsed(day, hour, placement.coach);
      }

      if (course.students.length < 4) {
        course.students.push(student);
        assigned.add(String(student._id));
      }
    }

    // Finalize critical courses
    for (const course of criticalCourseMap.values()) {
      createCourse(
        course.day,
        course.hour,
        course.coach,
        course.students,
        `Critical students (≤2 slots) - Reserved FIRST to prevent blocking`
      );
    }

    console.log(`✅ Phase 1: ${assigned.size} critical students placed\n`);

    console.log('\n🎯 PHASE 2: Create FULL COURSES at high-overlap opportunities\n');

    // Top opportunities from analysis (where we can create full courses)
    const opportunities = [
      {
        time: 'Montag 16',
        groups: [
          { key: 'child-Gelb Team', coach: nicole, maxCourses: 1 },
          { key: 'child-Gelb Hobby', coach: ben, maxCourses: 1 }
        ]
      },
      {
        time: 'Donnerstag 16',
        groups: [
          { key: 'child-Gelb Team', coach: nicole, maxCourses: 1 },
          { key: 'child-Orange', coach: ben, maxCourses: 1 }
        ]
      },
      {
        time: 'Donnerstag 15',
        groups: [
          { key: 'child-Gelb Team', coach: nicole, maxCourses: 1 },
          { key: 'child-Orange', coach: ben, maxCourses: 1 }
        ]
      },
      {
        time: 'Freitag 17',
        groups: [
          { key: 'child-Gelb Team', coach: nicole, maxCourses: 1 },
          { key: 'adult-weiblich-Anfänger mit Grundkenntnissen', coach: falko, maxCourses: 1 }
        ]
      },
      {
        time: 'Freitag 16',
        groups: [
          { key: 'child-Gelb Team', coach: nicole, maxCourses: 1 },
          { key: 'adult-weiblich-Anfänger mit Grundkenntnissen', coach: falko, maxCourses: 1 }
        ]
      },
      {
        time: 'Freitag 18',
        groups: [
          { key: 'child-Gelb Team', coach: nicole, maxCourses: 1 },
          { key: 'adult-weiblich-Anfänger mit Grundkenntnissen', coach: falko, maxCourses: 1 }
        ]
      },
      {
        time: 'Freitag 19',
        groups: [
          { key: 'child-Gelb Team', coach: nicole, maxCourses: 1 },
          { key: 'adult-weiblich-Anfänger mit Grundkenntnissen', coach: falko, maxCourses: 1 }
        ]
      },
      {
        time: 'Montag 17',
        groups: [
          { key: 'child-Gelb Team', coach: nicole, maxCourses: 1 }
        ]
      },
      {
        time: 'Mittwoch 17',
        groups: [
          { key: 'child-Gelb Team', coach: nicole, maxCourses: 1 }
        ]
      },
      {
        time: 'Dienstag 17',
        groups: [
          { key: 'child-Gelb Team', coach: nicole, maxCourses: 1 }
        ]
      },
      {
        time: 'Samstag 11',
        groups: [
          { key: 'adult-weiblich-Anfänger mit Grundkenntnissen', coach: nicole, maxCourses: 1 }
        ]
      },
      {
        time: 'Donnerstag 18',
        groups: [
          { key: 'adult-weiblich-Fortgeschritten', coach: nicole, maxCourses: 1 }
        ]
      },
      {
        time: 'Samstag 14',
        groups: [
          { key: 'child-Kinderland', coach: nicole, maxCourses: 1 }
        ]
      },
      {
        time: 'Samstag 15',
        groups: [
          { key: 'child-Orange', coach: nicole, maxCourses: 1 }
        ]
      },
      {
        time: 'Dienstag 16',
        groups: [
          { key: 'child-Grün', coach: nicole, maxCourses: 1 }
        ]
      }
    ];

    for (const opp of opportunities) {
      const [day, hourStr] = opp.time.split(' ');
      const hour = parseInt(hourStr);

      for (const group of opp.groups) {
        if (!isCoachAvailable(day, hour, group.coach)) {
          console.log(`  ⚠️  ${day} ${hour} - ${group.coach.firstName} already assigned, skipping ${group.key}`);
          continue;
        }

        let filter;
        if (group.key.startsWith('adult-')) {
          const parts = group.key.split('-');
          const gender = parts[1];
          const skillLevel = parts.slice(2).join('-');
          filter = (s) =>
            s.adult &&
            s.sex === gender &&
            s.skillLevel === skillLevel &&
            s.availableTimes?.includes(opp.time);
        } else {
          const trainigGroup = group.key.split('-')[1];
          filter = (s) =>
            !s.adult &&
            s.trainigGroup === trainigGroup &&
            s.availableTimes?.includes(opp.time);
        }

        const candidates = findStudents(filter);

        if (candidates.length >= 4) {
          // Create full course!
          const courseStudents = candidates.slice(0, 4);
          createCourse(
            day,
            hour,
            group.coach,
            courseStudents,
            `High-overlap opportunity: ${candidates.length} ${group.key} available → FULL COURSE`
          );
          markCoachUsed(day, hour, group.coach);
        } else if (candidates.length >= 2) {
          // Create smaller course if still good efficiency
          createCourse(
            day,
            hour,
            group.coach,
            candidates,
            `Good opportunity: ${candidates.length} ${group.key} available`
          );
          markCoachUsed(day, hour, group.coach);
        }
      }
    }

    console.log(`✅ Phase 2: ${assigned.size} students placed in optimized courses\n`);

    console.log('\n🎯 PHASE 3: Fill remaining students into best available slots\n');

    // Get all unassigned students sorted by flexibility (least flexible first)
    const remaining = students
      .filter(s => !assigned.has(String(s._id)))
      .sort((a, b) => {
        const flexA = a.availableTimes?.length || 0;
        const flexB = b.availableTimes?.length || 0;
        return flexA - flexB;
      });

    console.log(`${remaining.length} students remaining to place\n`);

    for (const student of remaining) {
      if (!student.availableTimes || student.availableTimes.length === 0) continue;

      let placed = false;

      // Try to find a compatible existing course
      for (const time of student.availableTimes) {
        if (placed) break;

        const [day, hourStr] = time.split(' ');
        const hour = parseInt(hourStr);

        // Find compatible existing courses
        const compatibleCourses = courses.filter(c => {
          if (c.day !== day || c.hour !== hour) return false;
          if (c.numStudents >= 4) return false;

          const coach = coachMap.get(c.coachId);
          if (!coach) return false;

          // Check coach qualification
          if (student.adult && !coach.isCoachingAdult) return false;
          if (!student.adult && !coach.isCoachingChildren) return false;

          // Check level/group compatibility
          if (c.students.length === 0) return true;

          const firstStudent = c.students[0];
          if (student.adult !== firstStudent.adult) return false;

          if (student.adult) {
            return student.sex === firstStudent.sex && student.skillLevel === firstStudent.skillLevel;
          } else {
            return student.trainigGroup === firstStudent.trainigGroup;
          }
        });

        if (compatibleCourses.length > 0) {
          // Add to fullest compatible course
          const targetCourse = compatibleCourses.sort((a, b) => b.numStudents - a.numStudents)[0];
          targetCourse.students.push({
            id: String(student._id),
            firstName: student.firstName,
            lastName: student.lastName,
            adult: student.adult,
            skillLevel: student.skillLevel,
            trainigGroup: student.trainigGroup,
            sex: student.sex
          });
          targetCourse.numStudents++;
          assigned.add(String(student._id));
          placed = true;

          const nowFull = targetCourse.numStudents === 4 ? ' → NOW FULL!' : '';
          console.log(`  Added ${student.firstName} ${student.lastName} to Course ${targetCourse.id} (${targetCourse.numStudents}/4)${nowFull}`);
        }
      }

      // If still not placed, create new single course
      if (!placed && student.availableTimes.length > 0) {
        const time = student.availableTimes[0];
        const [day, hourStr] = time.split(' ');
        const hour = parseInt(hourStr);

        // Find available coach
        const qualifiedCoaches = coaches.filter(c => {
          if (!c.availableTimes?.includes(time)) return false;
          if (student.adult && !c.isCoachingAdult) return false;
          if (!student.adult && !c.isCoachingChildren) return false;
          return isCoachAvailable(day, hour, c);
        });

        if (qualifiedCoaches.length > 0) {
          const coach = qualifiedCoaches[0];
          createCourse(
            day,
            hour,
            coach,
            [student],
            `Single placement for remaining student`
          );
          markCoachUsed(day, hour, coach);
        }
      }
    }

    console.log(`\n✅ Phase 3: ${assigned.size} total students placed\n`);

    // Calculate statistics
    const courseSizes = { 1: 0, 2: 0, 3: 0, 4: 0 };
    courses.forEach(c => {
      const size = Math.min(c.numStudents, 4);
      courseSizes[size]++;
    });

    const unassigned = students.filter(s => !assigned.has(String(s._id)));

    console.log('=' .repeat(80));
    console.log('MANUAL OPTIMAL PLAN - RESULTS');
    console.log('=' .repeat(80));
    console.log(`\n📊 Course Distribution:`);
    console.log(`   Full (4):     ${courseSizes[4]} courses`);
    console.log(`   Three (3):    ${courseSizes[3]} courses`);
    console.log(`   Two (2):      ${courseSizes[2]} courses`);
    console.log(`   Single (1):   ${courseSizes[1]} courses`);
    console.log(`   TOTAL:        ${courses.length} courses`);
    console.log(`   Efficiency:   ${((courseSizes[4] + courseSizes[3]) / courses.length * 100).toFixed(1)}% have 3-4 students`);

    console.log(`\n📊 Student Assignment:`);
    console.log(`   Assigned:     ${assigned.size}/${students.length} (${(assigned.size/students.length*100).toFixed(1)}%)`);
    console.log(`   Unassigned:   ${unassigned.length}`);

    if (unassigned.length > 0) {
      console.log(`\n❌ Unassigned students:`);
      unassigned.forEach(s => {
        const level = s.adult ? s.skillLevel : s.trainigGroup;
        console.log(`   - ${s.firstName} ${s.lastName} (${level}): ${s.availableTimes?.join(', ') || 'No times'}`);
      });
    }

    // Verify NO parallel courses
    console.log(`\n🔍 Verifying NO parallel courses...`);
    const timeSlotCheck = new Map();
    let conflicts = 0;

    for (const course of courses) {
      const key = `${course.day} ${course.hour}`;
      if (!timeSlotCheck.has(key)) timeSlotCheck.set(key, []);
      timeSlotCheck.get(key).push(course);
    }

    for (const [time, coursesAtTime] of timeSlotCheck) {
      const coachCounts = new Map();
      for (const course of coursesAtTime) {
        const count = coachCounts.get(course.coachName) || 0;
        coachCounts.set(course.coachName, count + 1);
      }

      for (const [coachName, count] of coachCounts) {
        if (count > 1) {
          console.log(`   ❌ ${time}: ${coachName} has ${count} courses (CONFLICT!)`);
          conflicts++;
        }
      }
    }

    if (conflicts === 0) {
      console.log(`   ✅ NO CONFLICTS - Each coach has max 1 course per time slot\n`);
    } else {
      console.log(`   ❌ Found ${conflicts} conflicts!\n`);
    }

    // Save plan
    const planData = {
      metadata: {
        createdAt: new Date().toISOString(),
        method: 'Manual V2 - Strategic Planning with Deep Analysis',
        totalCourses: courses.length,
        fullCourses: courseSizes[4],
        threeCourses: courseSizes[3],
        twoCourses: courseSizes[2],
        singleCourses: courseSizes[1],
        assignedStudents: assigned.size,
        totalStudents: students.length,
        unassignedStudents: unassigned.length,
        efficiency: ((courseSizes[4] + courseSizes[3]) / courses.length * 100).toFixed(1) + '%',
        parallelConflicts: conflicts
      },
      courses,
      unassigned: unassigned.map(s => ({
        id: String(s._id),
        firstName: s.firstName,
        lastName: s.lastName,
        adult: s.adult,
        skillLevel: s.skillLevel,
        trainigGroup: s.trainigGroup,
        availableTimes: s.availableTimes || []
      }))
    };

    fs.writeFileSync(
      join(__dirname, 'manual-optimal-plan-v2.json'),
      JSON.stringify(planData, null, 2)
    );

    console.log('✅ Manual optimal plan V2 saved to manual-optimal-plan-v2.json\n');

    return planData;

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
  }
}

createManualOptimalPlan().catch(console.error);
