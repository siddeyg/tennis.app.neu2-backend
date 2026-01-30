import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env.development') });

const studentSchema = new mongoose.Schema({}, { strict: false });
const coachSchema = new mongoose.Schema({}, { strict: false });

const Student = mongoose.model('Student', studentSchema);
const Coach = mongoose.model('Coach', coachSchema);

async function analyzeForManualPlan() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const students = await Student.find().lean();
    const coaches = await Coach.find().lean();

    console.log('=' .repeat(80));
    console.log('DEEP ANALYSIS FOR MANUAL OPTIMAL PLAN');
    console.log('=' .repeat(80));
    console.log(`Total: ${students.length} students, ${coaches.length} coaches\n`);

    // =============================================================================
    // COACH ANALYSIS
    // =============================================================================
    console.log('📋 COACH ANALYSIS');
    console.log('-' .repeat(80));

    const coachAvailability = new Map();

    coaches.forEach(coach => {
      const slots = coach.availableTimes || [];
      console.log(`\n${coach.firstName} ${coach.lastName}:`);
      console.log(`  - Available: ${slots.length} time slots`);
      console.log(`  - Can coach adults: ${coach.isCoachingAdult ? 'YES' : 'NO'}`);
      console.log(`  - Can coach children: ${coach.isCoachingChildren ? 'YES' : 'NO'}`);

      if (coach.isCoachingAdult && coach.CoachingAdultLevels?.length > 0) {
        console.log(`  - Adult levels: ${coach.CoachingAdultLevels.join(', ')}`);
      }
      if (coach.isCoachingChildren && coach.CoachingChildrenLevels?.length > 0) {
        console.log(`  - Children levels: ${coach.CoachingChildrenLevels.join(', ')}`);
      }

      slots.forEach(slot => {
        if (!coachAvailability.has(slot)) coachAvailability.set(slot, []);
        coachAvailability.get(slot).push(coach);
      });
    });

    // =============================================================================
    // STUDENT GROUPING
    // =============================================================================
    console.log('\n\n📋 STUDENT GROUPING BY LEVEL/GROUP');
    console.log('-' .repeat(80));

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

    // Sort by group size descending
    const sortedGroups = Array.from(studentGroups.entries())
      .sort((a, b) => b[1].length - a[1].length);

    sortedGroups.forEach(([groupKey, groupStudents]) => {
      console.log(`\n${groupKey}: ${groupStudents.length} students`);

      // Analyze flexibility
      const flexibilities = groupStudents.map(s => s.availableTimes?.length || 0);
      const avgFlex = flexibilities.reduce((a, b) => a + b, 0) / flexibilities.length;
      const minFlex = Math.min(...flexibilities);
      const maxFlex = Math.max(...flexibilities);

      console.log(`  Flexibility: avg=${avgFlex.toFixed(1)}, min=${minFlex}, max=${maxFlex}`);

      // Show critically constrained students (≤2 slots)
      const constrained = groupStudents.filter(s => (s.availableTimes?.length || 0) <= 2);
      if (constrained.length > 0) {
        console.log(`  ⚠️  CONSTRAINED (≤2 slots): ${constrained.length} students`);
        constrained.forEach(s => {
          console.log(`    - ${s.firstName} ${s.lastName}: ${s.availableTimes.join(', ')}`);
        });
      }
    });

    // =============================================================================
    // OVERLAP ANALYSIS - Find best opportunities for full courses
    // =============================================================================
    console.log('\n\n📋 OVERLAP ANALYSIS - Opportunities for Full Courses');
    console.log('-' .repeat(80));

    const opportunities = [];

    studentGroups.forEach((groupStudents, groupKey) => {
      const timeSlotCounts = new Map();

      groupStudents.forEach(s => {
        (s.availableTimes || []).forEach(time => {
          if (!timeSlotCounts.has(time)) timeSlotCounts.set(time, []);
          timeSlotCounts.get(time).push(s);
        });
      });

      timeSlotCounts.forEach((studentsAtTime, timeToken) => {
        const numFullCourses = Math.floor(studentsAtTime.length / 4);
        if (numFullCourses > 0) {
          const [day, hourStr] = timeToken.split(' ');
          const coaches = coachAvailability.get(timeToken) || [];

          // Check if coaches are qualified
          const isAdult = groupKey.startsWith('adult-');
          const qualifiedCoaches = coaches.filter(c =>
            isAdult ? c.isCoachingAdult : c.isCoachingChildren
          );

          opportunities.push({
            groupKey,
            timeToken,
            day,
            hour: parseInt(hourStr),
            numStudents: studentsAtTime.length,
            numFullCourses,
            numCoaches: qualifiedCoaches.length,
            students: studentsAtTime,
            coaches: qualifiedCoaches
          });
        }
      });
    });

    // Sort by potential (num full courses * num coaches available)
    opportunities.sort((a, b) => {
      const scoreA = a.numFullCourses * Math.min(a.numCoaches, 3);
      const scoreB = b.numFullCourses * Math.min(b.numCoaches, 3);
      return scoreB - scoreA;
    });

    console.log(`\nFound ${opportunities.length} opportunities for full courses:\n`);

    let totalPotentialFullCourses = 0;

    opportunities.slice(0, 30).forEach((opp, i) => {
      const realized = Math.min(opp.numFullCourses, opp.numCoaches);
      totalPotentialFullCourses += realized;

      console.log(`${i+1}. ${opp.groupKey} @ ${opp.timeToken}`);
      console.log(`   Students: ${opp.numStudents} → ${opp.numFullCourses} full courses possible`);
      console.log(`   Coaches: ${opp.numCoaches} available → CAN REALIZE ${realized} courses`);

      if (opp.numCoaches === 0) {
        console.log(`   ❌ NO COACHES AVAILABLE - Cannot create any courses`);
      } else if (opp.numCoaches < opp.numFullCourses) {
        console.log(`   ⚠️  LIMITED by coach availability`);
      }

      console.log('');
    });

    console.log(`\n🎯 THEORETICAL MAXIMUM: ~${totalPotentialFullCourses} full courses (top 30 opportunities)`);

    // =============================================================================
    // TIME SLOT CAPACITY ANALYSIS
    // =============================================================================
    console.log('\n\n📋 TIME SLOT CAPACITY ANALYSIS');
    console.log('-' .repeat(80));

    const days = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
    const hours = Array.from({ length: 12 }, (_, i) => i + 10);

    for (const day of days) {
      console.log(`\n${day}:`);

      for (const hour of hours) {
        const timeToken = `${day} ${hour}`;
        const coaches = coachAvailability.get(timeToken) || [];
        const coachesAdult = coaches.filter(c => c.isCoachingAdult).length;
        const coachesChildren = coaches.filter(c => c.isCoachingChildren).length;

        // Count students available at this time
        const studentsHere = students.filter(s =>
          s.availableTimes?.includes(timeToken)
        );
        const adultsHere = studentsHere.filter(s => s.adult).length;
        const childrenHere = studentsHere.filter(s => !s.adult).length;

        if (coaches.length > 0 || studentsHere.length > 0) {
          console.log(`  ${hour}:00 - Coaches: ${coaches.length} (${coachesAdult}A/${coachesChildren}K) | Students: ${studentsHere.length} (${adultsHere}A/${childrenHere}K)`);

          // Check for mismatches
          if (adultsHere > 0 && coachesAdult === 0) {
            console.log(`    ⚠️  ${adultsHere} adults but NO adult coaches`);
          }
          if (childrenHere > 0 && coachesChildren === 0) {
            console.log(`    ⚠️  ${childrenHere} children but NO children coaches`);
          }
        }
      }
    }

    // =============================================================================
    // SAVE ANALYSIS DATA
    // =============================================================================
    const analysisData = {
      metadata: {
        analyzedAt: new Date().toISOString(),
        totalStudents: students.length,
        totalCoaches: coaches.length
      },
      coaches: coaches.map(c => ({
        id: String(c._id),
        name: `${c.firstName} ${c.lastName}`,
        availableSlots: c.availableTimes?.length || 0,
        coachesAdult: c.isCoachingAdult,
        coachesChildren: c.isCoachingChildren,
        times: c.availableTimes || []
      })),
      studentGroups: sortedGroups.map(([key, students]) => ({
        groupKey: key,
        count: students.length,
        students: students.map(s => ({
          id: String(s._id),
          name: `${s.firstName} ${s.lastName}`,
          availableTimes: s.availableTimes || [],
          flexibility: s.availableTimes?.length || 0
        }))
      })),
      opportunities: opportunities.map(opp => ({
        groupKey: opp.groupKey,
        timeToken: opp.timeToken,
        numStudents: opp.numStudents,
        numFullCourses: opp.numFullCourses,
        numCoaches: opp.numCoaches,
        realizedCourses: Math.min(opp.numFullCourses, opp.numCoaches),
        students: opp.students.map(s => ({
          id: String(s._id),
          name: `${s.firstName} ${s.lastName}`
        })),
        coaches: opp.coaches.map(c => ({
          id: String(c._id),
          name: `${c.firstName} ${c.lastName}`
        }))
      })),
      theoreticalMaximum: totalPotentialFullCourses
    };

    const fs = await import('fs');
    fs.writeFileSync(
      join(__dirname, 'manual-plan-analysis.json'),
      JSON.stringify(analysisData, null, 2)
    );

    console.log('\n\n✅ Analysis saved to manual-plan-analysis.json');

    return analysisData;

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
  }
}

analyzeForManualPlan().catch(console.error);
