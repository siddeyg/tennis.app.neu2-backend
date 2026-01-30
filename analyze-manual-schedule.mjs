import mongoose from 'mongoose';
import Student from './src/models/Student.js';
import Coach from './src/models/Coach.js';
import Schedule from './src/models/Schedule.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load development environment
dotenv.config({ path: path.resolve(__dirname, '.env.development') });

console.log('🔍 Manual Schedule Analysis - Finding Automation Patterns\n');

async function analyzeManualSchedule() {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Fetch all data
    const students = await Student.find().lean();
    const coaches = await Coach.find().lean();
    const schedule = await Schedule.find().lean();

    console.log('📊 Database Overview:');
    console.log(`   Students: ${students.length}`);
    console.log(`   Coaches: ${coaches.length}`);
    console.log(`   Schedule items: ${schedule.length}\n`);

    // Analysis results
    const analysis = {
      timestamp: new Date().toISOString(),
      overview: {
        totalStudents: students.length,
        totalCoaches: coaches.length,
        totalScheduleItems: schedule.length
      },
      students: [],
      coaches: [],
      patterns: {
        assignmentOutsideAvailability: [],
        multipleAssignments: [],
        coachSpecialization: [],
        levelMixing: [],
        timeSlotPreferences: {},
        courseCapacities: {}
      }
    };

    // Analyze each student
    console.log('🔍 Analyzing Students...\n');

    for (const student of students) {
      const studentData = {
        _id: String(student._id),
        name: `${student.firstName} ${student.lastName}`,
        adult: student.adult,
        skillLevel: student.skillLevel,
        trainigGroup: student.trainigGroup,
        sex: student.sex,
        member: student.member,
        frequence: student.frequence,
        availableTimes: student.availableTimes || [],
        assignments: student.assignments || [],
        legacyAssignment: {
          day: student.day,
          hour: student.hour,
          coach: student.coach
        }
      };

      // Check if assigned
      const hasAssignments = studentData.assignments.length > 0;
      const hasLegacy = studentData.legacyAssignment.day &&
                        studentData.legacyAssignment.hour !== null &&
                        studentData.legacyAssignment.hour !== undefined;

      studentData.isAssigned = hasAssignments || hasLegacy;

      // Analyze each assignment
      if (hasAssignments) {
        for (const assignment of studentData.assignments) {
          const timeSlot = `${assignment.day} ${assignment.hour}`;

          // Check if assignment is within available times
          const isAvailable = studentData.availableTimes.includes(timeSlot);

          if (!isAvailable) {
            analysis.patterns.assignmentOutsideAvailability.push({
              student: studentData.name,
              assignment: timeSlot,
              availableTimes: studentData.availableTimes,
              reason: 'Assigned to time slot outside student availability'
            });
          }
        }

        // Track multiple assignments
        if (studentData.assignments.length > 1) {
          analysis.patterns.multipleAssignments.push({
            student: studentData.name,
            frequence: studentData.frequence,
            assignmentCount: studentData.assignments.length,
            assignments: studentData.assignments.map(a => `${a.day} ${a.hour}`)
          });
        }
      }

      analysis.students.push(studentData);
    }

    // Analyze coaches
    console.log('🔍 Analyzing Coaches...\n');

    for (const coach of coaches) {
      const coachData = {
        _id: String(coach._id),
        name: `${coach.firstName} ${coach.lastName}`,
        availableTimes: coach.availableTimes || [],
        isCoachingAdult: coach.isCoachingAdult,
        isCoachingChildren: coach.isCoachingChildren,
        CoachingAdultLevels: coach.CoachingAdultLevels || [],
        CoachingChildrenLevels: coach.CoachingChildrenLevels || []
      };

      // Find students assigned to this coach
      const assignedStudents = students.filter(s => {
        if (s.assignments && s.assignments.length > 0) {
          return s.assignments.some(a => String(a.coach) === String(coach._id));
        }
        return String(s.coach) === String(coach._id);
      });

      coachData.assignedStudentCount = assignedStudents.length;
      coachData.assignedStudents = assignedStudents.map(s => ({
        name: `${s.firstName} ${s.lastName}`,
        adult: s.adult,
        level: s.adult ? s.skillLevel : s.trainigGroup,
        assignments: s.assignments || []
      }));

      // Check for specialization violations
      for (const student of assignedStudents) {
        const isAdult = student.adult;
        const level = isAdult ? student.skillLevel : student.trainigGroup;

        if (isAdult && !coach.isCoachingAdult) {
          analysis.patterns.coachSpecialization.push({
            coach: coachData.name,
            student: `${student.firstName} ${student.lastName}`,
            issue: 'Adult student assigned to coach who does not coach adults'
          });
        }

        if (!isAdult && !coach.isCoachingChildren) {
          analysis.patterns.coachSpecialization.push({
            coach: coachData.name,
            student: `${student.firstName} ${student.lastName}`,
            issue: 'Child student assigned to coach who does not coach children'
          });
        }

        if (isAdult && coach.isCoachingAdult && coach.CoachingAdultLevels.length > 0) {
          if (!coach.CoachingAdultLevels.includes(level)) {
            analysis.patterns.coachSpecialization.push({
              coach: coachData.name,
              student: `${student.firstName} ${student.lastName}`,
              level: level,
              coachLevels: coach.CoachingAdultLevels,
              issue: 'Adult student level not in coach\'s coaching levels'
            });
          }
        }

        if (!isAdult && coach.isCoachingChildren && coach.CoachingChildrenLevels.length > 0) {
          if (!coach.CoachingChildrenLevels.includes(level)) {
            analysis.patterns.coachSpecialization.push({
              coach: coachData.name,
              student: `${student.firstName} ${student.lastName}`,
              level: level,
              coachLevels: coach.CoachingChildrenLevels,
              issue: 'Child student level not in coach\'s coaching levels'
            });
          }
        }
      }

      analysis.coaches.push(coachData);
    }

    // Analyze schedule items for level mixing and capacity
    console.log('🔍 Analyzing Schedule Items...\n');

    for (const item of schedule) {
      const timeSlot = `${item.day} ${item.hour}`;

      if (!item.students || item.students.length === 0) continue;

      // Get full student data
      const courseStudents = item.students.map(studentId => {
        return students.find(s => String(s._id) === String(studentId));
      }).filter(s => s !== undefined);

      if (courseStudents.length === 0) continue;

      // Check for level mixing
      const adults = courseStudents.filter(s => s.adult);
      const children = courseStudents.filter(s => !s.adult);

      // Adult/child mixing (should NEVER happen)
      if (adults.length > 0 && children.length > 0) {
        analysis.patterns.levelMixing.push({
          timeSlot,
          issue: 'CRITICAL: Adults and children mixed',
          adults: adults.map(s => `${s.firstName} ${s.lastName}`),
          children: children.map(s => `${s.firstName} ${s.lastName}`)
        });
      }

      // Adult level mixing
      if (adults.length > 1) {
        const levels = [...new Set(adults.map(s => s.skillLevel))];
        if (levels.length > 1) {
          analysis.patterns.levelMixing.push({
            timeSlot,
            type: 'Adult level mixing',
            levels,
            students: adults.map(s => `${s.firstName} ${s.lastName} (${s.skillLevel})`)
          });
        }
      }

      // Children group mixing
      if (children.length > 1) {
        const groups = [...new Set(children.map(s => s.trainigGroup))];
        if (groups.length > 1) {
          analysis.patterns.levelMixing.push({
            timeSlot,
            type: 'Children group mixing',
            groups,
            students: children.map(s => `${s.firstName} ${s.lastName} (${s.trainigGroup})`)
          });
        }
      }

      // Track course capacities
      const capacity = courseStudents.length;
      if (!analysis.patterns.courseCapacities[capacity]) {
        analysis.patterns.courseCapacities[capacity] = 0;
      }
      analysis.patterns.courseCapacities[capacity]++;

      // Track time slot usage
      if (!analysis.patterns.timeSlotPreferences[timeSlot]) {
        analysis.patterns.timeSlotPreferences[timeSlot] = 0;
      }
      analysis.patterns.timeSlotPreferences[timeSlot]++;
    }

    // Generate summary
    console.log('📈 Analysis Complete\n');
    console.log('=' .repeat(80));
    console.log('SUMMARY OF FINDINGS\n');

    console.log(`🎯 Assignments Outside Availability: ${analysis.patterns.assignmentOutsideAvailability.length}`);
    if (analysis.patterns.assignmentOutsideAvailability.length > 0) {
      console.log('   This suggests manual override of student availability preferences');
      analysis.patterns.assignmentOutsideAvailability.slice(0, 5).forEach(item => {
        console.log(`   - ${item.student}: ${item.assignment} (available: ${item.availableTimes.join(', ')})`);
      });
      if (analysis.patterns.assignmentOutsideAvailability.length > 5) {
        console.log(`   ... and ${analysis.patterns.assignmentOutsideAvailability.length - 5} more`);
      }
    }
    console.log();

    console.log(`👥 Multiple Assignments: ${analysis.patterns.multipleAssignments.length}`);
    if (analysis.patterns.multipleAssignments.length > 0) {
      console.log('   Students with 2+ courses per week:');
      analysis.patterns.multipleAssignments.slice(0, 5).forEach(item => {
        console.log(`   - ${item.student}: ${item.assignmentCount} courses (frequence: ${item.frequence})`);
      });
      if (analysis.patterns.multipleAssignments.length > 5) {
        console.log(`   ... and ${analysis.patterns.multipleAssignments.length - 5} more`);
      }
    }
    console.log();

    console.log(`⚠️  Coach Specialization Issues: ${analysis.patterns.coachSpecialization.length}`);
    if (analysis.patterns.coachSpecialization.length > 0) {
      console.log('   Assignments that violate coach qualifications:');
      analysis.patterns.coachSpecialization.slice(0, 5).forEach(item => {
        console.log(`   - ${item.coach} → ${item.student}: ${item.issue}`);
      });
      if (analysis.patterns.coachSpecialization.length > 5) {
        console.log(`   ... and ${analysis.patterns.coachSpecialization.length - 5} more`);
      }
    }
    console.log();

    console.log(`🔀 Level Mixing: ${analysis.patterns.levelMixing.length}`);
    if (analysis.patterns.levelMixing.length > 0) {
      console.log('   Courses with mixed levels:');
      analysis.patterns.levelMixing.slice(0, 5).forEach(item => {
        console.log(`   - ${item.timeSlot}: ${item.type || item.issue}`);
      });
      if (analysis.patterns.levelMixing.length > 5) {
        console.log(`   ... and ${analysis.patterns.levelMixing.length - 5} more`);
      }
    }
    console.log();

    console.log('📊 Course Capacity Distribution:');
    Object.keys(analysis.patterns.courseCapacities).sort((a, b) => b - a).forEach(capacity => {
      const count = analysis.patterns.courseCapacities[capacity];
      const percentage = (count / schedule.length * 100).toFixed(1);
      console.log(`   ${capacity} students: ${count} courses (${percentage}%)`);
    });
    console.log();

    console.log('⏰ Most Popular Time Slots:');
    const sortedSlots = Object.entries(analysis.patterns.timeSlotPreferences)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    sortedSlots.forEach(([slot, count]) => {
      console.log(`   ${slot}: ${count} courses`);
    });
    console.log();

    // Save full analysis to file
    const outputFile = 'manual-schedule-analysis.json';
    fs.writeFileSync(outputFile, JSON.stringify(analysis, null, 2));
    console.log(`💾 Full analysis saved to: ${outputFile}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

analyzeManualSchedule();
