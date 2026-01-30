// Data Analysis Script for Tennis Training Schedule
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config({ path: './.env.development' });

// Connect to MongoDB
await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/tennis-coach');

// Define schemas
const studentSchema = new mongoose.Schema({}, { strict: false });
const coachSchema = new mongoose.Schema({}, { strict: false });
const Student = mongoose.model('Student', studentSchema);
const Coach = mongoose.model('Coach', coachSchema);

async function analyzeData() {
  console.log('\n=== TENNIS TRAINING DATA ANALYSIS ===\n');

  // Fetch all data
  const students = await Student.find({});
  const coaches = await Coach.find({});

  console.log(`Total Students: ${students.length}`);
  console.log(`Total Coaches: ${coaches.length}\n`);

  // === ADULT STUDENTS ANALYSIS ===
  const adults = students.filter(s => s.adult === true);
  const children = students.filter(s => s.adult === false || !s.adult);

  console.log('=== ADULT STUDENTS ===');
  console.log(`Total Adults: ${adults.length}`);

  // Group by skill level
  const adultsBySkill = {};
  adults.forEach(s => {
    const skill = s.skillLevel || 'Nicht angegeben';
    adultsBySkill[skill] = (adultsBySkill[skill] || 0) + 1;
  });
  console.log('\nAdults by Skill Level:');
  Object.entries(adultsBySkill).sort((a, b) => b[1] - a[1]).forEach(([skill, count]) => {
    console.log(`  ${skill}: ${count}`);
  });

  // Assigned adults
  const assignedAdults = adults.filter(s => s.day && s.hour);
  console.log(`\nAssigned Adults: ${assignedAdults.length}/${adults.length}`);

  // === CHILDREN STUDENTS ANALYSIS ===
  console.log('\n=== CHILDREN STUDENTS ===');
  console.log(`Total Children: ${children.length}`);

  // Group by training group
  const childrenByGroup = {};
  children.forEach(s => {
    const group = s.trainigGroup || 'Nicht angegeben';
    childrenByGroup[group] = (childrenByGroup[group] || 0) + 1;
  });
  console.log('\nChildren by Training Group:');
  Object.entries(childrenByGroup).sort((a, b) => b[1] - a[1]).forEach(([group, count]) => {
    console.log(`  ${group}: ${count}`);
  });

  // Group by team
  const childrenByTeam = {};
  children.forEach(s => {
    const team = s.team || 'Kein Team';
    childrenByTeam[team] = (childrenByTeam[team] || 0) + 1;
  });
  console.log('\nChildren by Team:');
  Object.entries(childrenByTeam).sort((a, b) => b[1] - a[1]).forEach(([team, count]) => {
    console.log(`  ${team}: ${count}`);
  });

  // Assigned children
  const assignedChildren = children.filter(s => s.day && s.hour);
  console.log(`\nAssigned Children: ${assignedChildren.length}/${children.length}`);

  // === COURSE ANALYSIS ===
  console.log('\n=== CURRENT COURSES (MIXED LEVEL ANALYSIS) ===');

  // Group assigned students by day/hour
  const courses = {};
  students.filter(s => s.day && s.hour).forEach(s => {
    const key = `${s.day} ${s.hour}`;
    if (!courses[key]) {
      courses[key] = [];
    }
    courses[key].push(s);
  });

  let mixedSkillCourses = 0;
  let mixedTeamCourses = 0;
  let mixedAdultChildCourses = 0;

  console.log(`\nTotal Active Courses: ${Object.keys(courses).length}`);
  console.log('\nCourses with Issues:');

  Object.entries(courses).sort((a, b) => a[0].localeCompare(b[0])).forEach(([time, studentList]) => {
    const hasAdults = studentList.some(s => s.adult);
    const hasChildren = studentList.some(s => !s.adult);
    const skillLevels = [...new Set(studentList.filter(s => s.adult).map(s => s.skillLevel).filter(Boolean))];
    const trainingGroups = [...new Set(studentList.filter(s => !s.adult).map(s => s.trainigGroup).filter(Boolean))];
    const teams = [...new Set(studentList.filter(s => s.team).map(s => s.team))];

    const issues = [];

    if (hasAdults && hasChildren) {
      issues.push('MIXED ADULT/CHILD');
      mixedAdultChildCourses++;
    }

    if (skillLevels.length > 1) {
      issues.push(`Mixed Skills: ${skillLevels.join(', ')}`);
      mixedSkillCourses++;
    }

    if (trainingGroups.length > 1) {
      issues.push(`Mixed Groups: ${trainingGroups.join(', ')}`);
    }

    if (teams.length > 1 && !teams.includes('Kein Team') && teams[0]) {
      issues.push(`Mixed Teams: ${teams.join(', ')}`);
      mixedTeamCourses++;
    }

    if (issues.length > 0) {
      console.log(`\n  ${time} (${studentList.length} students):`);
      issues.forEach(issue => console.log(`    - ${issue}`));
      studentList.forEach(s => {
        const detail = s.adult ? s.skillLevel : `${s.trainigGroup}${s.team ? ' / ' + s.team : ''}`;
        console.log(`      • ${s.firstName} ${s.lastName}: ${detail}`);
      });
    }
  });

  console.log(`\n\nSummary:`);
  console.log(`  Mixed Adult/Child Courses: ${mixedAdultChildCourses}`);
  console.log(`  Mixed Skill Level Courses: ${mixedSkillCourses}`);
  console.log(`  Mixed Team Courses: ${mixedTeamCourses}`);

  // === AVAILABILITY ANALYSIS ===
  console.log('\n=== AVAILABILITY OVERLAP ANALYSIS ===');

  // Adult availability by skill level
  console.log('\nAdult Availability by Skill Level:');
  Object.keys(adultsBySkill).forEach(skill => {
    const studentsInSkill = adults.filter(s => s.skillLevel === skill);
    const allTimes = {};
    studentsInSkill.forEach(s => {
      (s.availableTimes || []).forEach(time => {
        allTimes[time] = (allTimes[time] || 0) + 1;
      });
    });

    const topTimes = Object.entries(allTimes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([time, count]) => `${time} (${count})`);

    if (topTimes.length > 0) {
      console.log(`  ${skill}: ${topTimes.join(', ')}`);
    }
  });

  // Children availability by training group
  console.log('\nChildren Availability by Training Group:');
  Object.keys(childrenByGroup).forEach(group => {
    const studentsInGroup = children.filter(s => s.trainigGroup === group);
    const allTimes = {};
    studentsInGroup.forEach(s => {
      (s.availableTimes || []).forEach(time => {
        allTimes[time] = (allTimes[time] || 0) + 1;
      });
    });

    const topTimes = Object.entries(allTimes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([time, count]) => `${time} (${count})`);

    if (topTimes.length > 0) {
      console.log(`  ${group}: ${topTimes.join(', ')}`);
    }
  });

  // === COACH ANALYSIS ===
  console.log('\n=== COACH CAPACITY ANALYSIS ===');
  console.log(`\nCoaches teaching adults: ${coaches.filter(c => c.isCoachingAdult).length}`);
  console.log(`Coaches teaching children: ${coaches.filter(c => c.isCoachingChildren).length}`);

  coaches.forEach(c => {
    const availableSlots = (c.availableTimes || []).length;
    const assignedStudents = students.filter(s =>
      String(s.coach) === String(c._id) ||
      s.coach === `${c.firstName} ${c.lastName}`
    );

    if (assignedStudents.length > 0) {
      console.log(`\n  ${c.firstName} ${c.lastName}:`);
      console.log(`    Available slots: ${availableSlots}`);
      console.log(`    Assigned students: ${assignedStudents.length}`);
      console.log(`    Adult: ${c.isCoachingAdult ? 'Yes' : 'No'}, Children: ${c.isCoachingChildren ? 'Yes' : 'No'}`);
    }
  });

  mongoose.connection.close();
  console.log('\n=== Analysis Complete ===\n');
}

analyzeData().catch(err => {
  console.error('Error:', err);
  mongoose.connection.close();
  process.exit(1);
});
