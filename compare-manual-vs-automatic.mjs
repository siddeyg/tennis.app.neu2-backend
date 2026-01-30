import mongoose from 'mongoose';
import Student from './src/models/Student.js';
import Coach from './src/models/Coach.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env.development') });

console.log('🔍 Deep Comparison: Manual Plan vs Automatic Plan\n');
console.log('Goal: Find hidden criteria that make manual plan better\n');

async function deepCompare() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Load manual plan data (saved earlier)
    const manualPlan = JSON.parse(fs.readFileSync('manual-schedule-analysis.json', 'utf8'));
    console.log('📁 Loaded manual plan analysis');
    console.log(`   Timestamp: ${manualPlan.timestamp}`);
    console.log(`   Students: ${manualPlan.overview.totalStudents}`);
    console.log();

    // Get current automatic plan
    const students = await Student.find().lean();
    const coaches = await Coach.find().lean();

    console.log('📁 Current automatic plan');
    console.log(`   Students: ${students.length}`);
    console.log(`   Coaches: ${coaches.length}`);
    console.log();

    const analysis = {
      timestamp: new Date().toISOString(),
      manualPlanDate: manualPlan.timestamp,
      differences: {
        assignmentChanges: [],
        timeSlotChanges: [],
        coachChanges: [],
        capacityChanges: [],
        levelMixingChanges: []
      },
      patterns: {
        preferredTimeSlots: {},
        preferredCoaches: {},
        avoidedTimeSlots: {},
        courseCapacityPreferences: {},
        studentGroupings: [],
        timeSlotAdjacency: [],
        coachWorkloadBalance: {},
        dayDistribution: {}
      },
      insights: []
    };

    // Build maps for comparison
    const manualStudentMap = {};
    manualPlan.students.forEach(s => {
      manualStudentMap[s._id] = s;
    });

    const currentStudentMap = {};
    students.forEach(s => {
      currentStudentMap[String(s._id)] = s;
    });

    console.log('🔎 ANALYZING ASSIGNMENT DIFFERENCES...\n');

    // Compare each student's assignment
    let movedCount = 0;
    let coachChangedCount = 0;
    let timeChangedCount = 0;
    let multiToSingleCount = 0;
    let singleToMultiCount = 0;

    for (const studentId in manualStudentMap) {
      const manualStudent = manualStudentMap[studentId];
      const currentStudent = currentStudentMap[studentId];

      if (!currentStudent) continue; // Student was deleted

      const manualAssignments = manualStudent.assignments || [];
      const currentAssignments = currentStudent.assignments || [];

      // Convert to comparable format
      const manualSlots = manualAssignments.map(a => `${a.day}_${a.hour}_${a.coach}`);
      const currentSlots = currentAssignments.map(a => `${a.day}_${a.hour}_${a.coach}`);

      // Check if assignments changed
      const slotsMatch =
        manualSlots.length === currentSlots.length &&
        manualSlots.every(slot => currentSlots.includes(slot));

      if (!slotsMatch) {
        movedCount++;

        const change = {
          student: manualStudent.name,
          level: manualStudent.adult ? manualStudent.skillLevel : manualStudent.trainigGroup,
          manual: {
            count: manualAssignments.length,
            slots: manualAssignments.map(a => ({
              day: a.day,
              hour: a.hour,
              coach: coaches.find(c => String(c._id) === String(a.coach))?.firstName + ' ' + coaches.find(c => String(c._id) === String(a.coach))?.lastName
            }))
          },
          automatic: {
            count: currentAssignments.length,
            slots: currentAssignments.map(a => ({
              day: a.day,
              hour: a.hour,
              coach: coaches.find(c => String(c._id) === String(a.coach))?.firstName + ' ' + coaches.find(c => String(c._id) === String(a.coach))?.lastName
            }))
          }
        };

        // Categorize change type
        if (manualAssignments.length > currentAssignments.length) {
          multiToSingleCount++;
          change.type = 'REDUCED_ASSIGNMENTS';
        } else if (manualAssignments.length < currentAssignments.length) {
          singleToMultiCount++;
          change.type = 'INCREASED_ASSIGNMENTS';
        } else if (manualAssignments.length === currentAssignments.length) {
          // Same number, different slots/coaches
          const manualDays = manualAssignments.map(a => a.day).sort();
          const currentDays = currentAssignments.map(a => a.day).sort();
          const manualHours = manualAssignments.map(a => a.hour).sort();
          const currentHours = currentAssignments.map(a => a.hour).sort();

          if (JSON.stringify(manualDays) !== JSON.stringify(currentDays) ||
              JSON.stringify(manualHours) !== JSON.stringify(currentHours)) {
            timeChangedCount++;
            change.type = 'TIME_CHANGED';
          } else {
            coachChangedCount++;
            change.type = 'COACH_CHANGED';
          }
        }

        analysis.differences.assignmentChanges.push(change);
      }
    }

    console.log(`Found ${movedCount} students with different assignments:`);
    console.log(`   ${multiToSingleCount} reduced (manual had more assignments)`);
    console.log(`   ${singleToMultiCount} increased (automatic has more assignments)`);
    console.log(`   ${timeChangedCount} time slot changed`);
    console.log(`   ${coachChangedCount} coach changed only`);
    console.log();

    // PATTERN 1: TIME SLOT PREFERENCES
    console.log('🕒 ANALYZING TIME SLOT PREFERENCES...\n');

    const manualTimeSlots = {};
    const automaticTimeSlots = {};

    manualPlan.students.forEach(s => {
      if (!s.assignments || s.assignments.length === 0) return;
      s.assignments.forEach(a => {
        const key = `${a.day} ${a.hour}`;
        if (!manualTimeSlots[key]) {
          manualTimeSlots[key] = { count: 0, levels: {}, students: [] };
        }
        manualTimeSlots[key].count++;
        const level = s.adult ? s.skillLevel : s.trainigGroup;
        manualTimeSlots[key].levels[level] = (manualTimeSlots[key].levels[level] || 0) + 1;
        manualTimeSlots[key].students.push(s.name);
      });
    });

    students.forEach(s => {
      if (!s.assignments || s.assignments.length === 0) return;
      s.assignments.forEach(a => {
        const key = `${a.day} ${a.hour}`;
        if (!automaticTimeSlots[key]) {
          automaticTimeSlots[key] = { count: 0, levels: {}, students: [] };
        }
        automaticTimeSlots[key].count++;
        const level = s.adult ? s.skillLevel : s.trainigGroup;
        automaticTimeSlots[key].levels[level] = (automaticTimeSlots[key].levels[level] || 0) + 1;
        automaticTimeSlots[key].students.push(`${s.firstName} ${s.lastName}`);
      });
    });

    // Find time slots used MORE in manual than automatic (preferred)
    for (const slot in manualTimeSlots) {
      const manualCount = manualTimeSlots[slot].count;
      const autoCount = automaticTimeSlots[slot]?.count || 0;

      if (manualCount > autoCount + 2) { // At least 3 more students
        analysis.patterns.preferredTimeSlots[slot] = {
          manualCount,
          autoCount,
          difference: manualCount - autoCount,
          manualLevels: manualTimeSlots[slot].levels,
          autoLevels: automaticTimeSlots[slot]?.levels || {}
        };
      }
    }

    // Find time slots used LESS in manual than automatic (avoided)
    for (const slot in automaticTimeSlots) {
      const autoCount = automaticTimeSlots[slot].count;
      const manualCount = manualTimeSlots[slot]?.count || 0;

      if (autoCount > manualCount + 2) { // Algorithm uses 3+ more
        analysis.patterns.avoidedTimeSlots[slot] = {
          manualCount,
          autoCount,
          difference: autoCount - manualCount,
          manualLevels: manualTimeSlots[slot]?.levels || {},
          autoLevels: automaticTimeSlots[slot].levels
        };
      }
    }

    console.log('Preferred time slots (manual uses MORE):');
    Object.entries(analysis.patterns.preferredTimeSlots)
      .sort((a, b) => b[1].difference - a[1].difference)
      .slice(0, 5)
      .forEach(([slot, data]) => {
        console.log(`   ${slot}: +${data.difference} students (${data.manualCount} manual vs ${data.autoCount} auto)`);
      });
    console.log();

    console.log('Avoided time slots (manual uses LESS):');
    Object.entries(analysis.patterns.avoidedTimeSlots)
      .sort((a, b) => b[1].difference - a[1].difference)
      .slice(0, 5)
      .forEach(([slot, data]) => {
        console.log(`   ${slot}: -${data.difference} students (${data.manualCount} manual vs ${data.autoCount} auto)`);
      });
    console.log();

    // PATTERN 2: COACH PREFERENCES
    console.log('👨‍🏫 ANALYZING COACH PREFERENCES...\n');

    const manualCoachAssignments = {};
    const automaticCoachAssignments = {};

    manualPlan.students.forEach(s => {
      if (!s.assignments || s.assignments.length === 0) return;
      s.assignments.forEach(a => {
        const coachId = String(a.coach);
        const level = s.adult ? s.skillLevel : s.trainigGroup;
        const key = `${coachId}_${level}`;

        if (!manualCoachAssignments[key]) {
          const coach = coaches.find(c => String(c._id) === coachId);
          manualCoachAssignments[key] = {
            coach: coach ? `${coach.firstName} ${coach.lastName}` : 'Unknown',
            level,
            count: 0
          };
        }
        manualCoachAssignments[key].count++;
      });
    });

    students.forEach(s => {
      if (!s.assignments || s.assignments.length === 0) return;
      s.assignments.forEach(a => {
        const coachId = String(a.coach);
        const level = s.adult ? s.skillLevel : s.trainigGroup;
        const key = `${coachId}_${level}`;

        if (!automaticCoachAssignments[key]) {
          const coach = coaches.find(c => String(c._id) === coachId);
          automaticCoachAssignments[key] = {
            coach: coach ? `${coach.firstName} ${coach.lastName}` : 'Unknown',
            level,
            count: 0
          };
        }
        automaticCoachAssignments[key].count++;
      });
    });

    // Find coach-level combinations preferred in manual
    for (const key in manualCoachAssignments) {
      const manual = manualCoachAssignments[key];
      const automatic = automaticCoachAssignments[key];

      if (!automatic || manual.count > automatic.count + 2) {
        analysis.patterns.preferredCoaches[key] = {
          coach: manual.coach,
          level: manual.level,
          manualCount: manual.count,
          autoCount: automatic?.count || 0,
          difference: manual.count - (automatic?.count || 0)
        };
      }
    }

    console.log('Preferred coach-level combinations (manual uses MORE):');
    Object.values(analysis.patterns.preferredCoaches)
      .sort((a, b) => b.difference - a.difference)
      .slice(0, 8)
      .forEach(data => {
        console.log(`   ${data.coach} → ${data.level}: +${data.difference} (${data.manualCount} manual vs ${data.autoCount} auto)`);
      });
    console.log();

    // PATTERN 3: COURSE CAPACITY PREFERENCES
    console.log('📊 ANALYZING COURSE CAPACITY PATTERNS...\n');

    // Group by time slot and count students per slot
    const manualCapacities = {};
    const automaticCapacities = {};

    Object.entries(manualTimeSlots).forEach(([slot, data]) => {
      const capacity = data.count;
      manualCapacities[capacity] = (manualCapacities[capacity] || 0) + 1;
    });

    Object.entries(automaticTimeSlots).forEach(([slot, data]) => {
      const capacity = data.count;
      automaticCapacities[capacity] = (automaticCapacities[capacity] || 0) + 1;
    });

    console.log('Course capacity distribution:');
    console.log('   Capacity | Manual | Automatic');
    const allCapacities = new Set([...Object.keys(manualCapacities), ...Object.keys(automaticCapacities)]);
    [...allCapacities].sort((a, b) => b - a).forEach(cap => {
      const manual = manualCapacities[cap] || 0;
      const auto = automaticCapacities[cap] || 0;
      const diff = manual - auto;
      const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '=';
      console.log(`   ${String(cap).padStart(8)} | ${String(manual).padStart(6)} | ${String(auto).padStart(9)} ${arrow}`);
    });
    console.log();

    // PATTERN 4: DAY DISTRIBUTION
    console.log('📅 ANALYZING DAY DISTRIBUTION...\n');

    const days = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
    const manualDayDist = {};
    const automaticDayDist = {};

    days.forEach(day => {
      manualDayDist[day] = 0;
      automaticDayDist[day] = 0;
    });

    Object.keys(manualTimeSlots).forEach(slot => {
      const day = slot.split(' ')[0];
      manualDayDist[day] += manualTimeSlots[slot].count;
    });

    Object.keys(automaticTimeSlots).forEach(slot => {
      const day = slot.split(' ')[0];
      automaticDayDist[day] += automaticTimeSlots[slot].count;
    });

    console.log('Students per day:');
    console.log('   Day        | Manual | Automatic | Diff');
    days.forEach(day => {
      const manual = manualDayDist[day];
      const auto = automaticDayDist[day];
      const diff = manual - auto;
      const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '=';
      console.log(`   ${day.padEnd(10)} | ${String(manual).padStart(6)} | ${String(auto).padStart(9)} | ${String(diff).padStart(4)} ${arrow}`);
    });
    console.log();

    // Save full analysis
    const outputFile = 'manual-vs-automatic-comparison.json';
    fs.writeFileSync(outputFile, JSON.stringify(analysis, null, 2));
    console.log(`💾 Full comparison saved to: ${outputFile}\n`);

    console.log('=' .repeat(80));
    console.log('KEY INSIGHTS\n');

    // Generate insights
    if (Object.keys(analysis.patterns.preferredTimeSlots).length > 0) {
      console.log('🕒 TIME SLOT PREFERENCES FOUND:');
      console.log('   Manual plan uses certain time slots MORE than algorithm suggests');
      console.log('   This could indicate:');
      console.log('   - Parent preference for specific times (school schedules)');
      console.log('   - Court availability constraints at other times');
      console.log('   - Coach quality preference (better coaches at these times)');
      console.log();
    }

    if (Object.keys(analysis.patterns.avoidedTimeSlots).length > 0) {
      console.log('🚫 AVOIDED TIME SLOTS FOUND:');
      console.log('   Manual plan uses certain slots LESS than algorithm suggests');
      console.log('   This could indicate:');
      console.log('   - Court maintenance/unavailability');
      console.log('   - Coach quality concerns');
      console.log('   - Parent pickup/dropoff difficulty');
      console.log('   - Conflicting events (school, other sports)');
      console.log();
    }

    if (Object.keys(analysis.patterns.preferredCoaches).length > 0) {
      console.log('👨‍🏫 COACH-LEVEL PREFERENCES FOUND:');
      console.log('   Manual plan assigns certain coaches to certain levels MORE');
      console.log('   This could indicate:');
      console.log('   - Coach expertise beyond qualifications (teaching style)');
      console.log('   - Student/parent requests for specific coaches');
      console.log('   - Coach performance/results with certain levels');
      console.log();
    }

    const manualHasMore = Object.entries(manualCapacities).filter(([cap, count]) =>
      cap > 4 && count > (automaticCapacities[cap] || 0)
    );

    if (manualHasMore.length > 0) {
      console.log('📊 CAPACITY PREFERENCES FOUND:');
      console.log('   Manual plan has MORE courses with 5+ students');
      console.log('   This could indicate:');
      console.log('   - Algorithm max capacity too conservative (default 4)');
      console.log('   - Certain levels can handle larger groups');
      console.log('   - Revenue optimization (more students per court)');
      console.log();
    }

    console.log('=' .repeat(80));

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

deepCompare();
