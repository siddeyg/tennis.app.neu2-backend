import mongoose from 'mongoose';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({path:'./.env.development'});
await mongoose.connect(process.env.MONGO_URI||'mongodb://localhost:27017/tennis-coach');

const SavedSchedule = mongoose.model('SavedSchedule', new mongoose.Schema({}, {strict: false}), 'savedschedules');

console.log('\n=== Exporting Latest Plan to CSV ===\n');

// Get most recent saved schedule
const latestPlan = await SavedSchedule.findOne().sort({ createdAt: -1 });

if (!latestPlan) {
  console.log('L No saved plans found');
  process.exit(1);
}

console.log(`=Ä Found: ${latestPlan.name}`);

// Generate CSV - Course List Format
let csv = 'Course ID,Day,Hour,Coach,Student Count,Students,Levels\n';

latestPlan.schedule.forEach((course, index) => {
  const courseNum = index + 1;
  const day = course.day;
  const hour = course.hour;
  const coach = course.coachName || 'Kein Trainer';
  const studentCount = course.students.length;

  // Get student details
  const studentNames = course.students.map(sid => {
    const student = latestPlan.students.find(s => String(s._id) === String(sid));
    return student ? `${student.firstName} ${student.lastName}` : 'Unknown';
  }).join('; ');

  const levels = course.students.map(sid => {
    const student = latestPlan.students.find(s => String(s._id) === String(sid));
    if (!student) return 'Unknown';
    return student.adult ? student.skillLevel : student.trainigGroup;
  }).join('; ');

  csv += `${courseNum},"${day}",${hour},"${coach}",${studentCount},"${studentNames}","${levels}"\n`;
});

const csvFile = 'optimal-course-plan.csv';
fs.writeFileSync(csvFile, csv, 'utf8');
console.log(` CSV exported: ${csvFile}`);

// Generate CSV - Student List Format
let studentCsv = 'First Name,Last Name,Birth Date,Email,Phone,Address,Level/Group,Adult,Assigned Day,Assigned Hour,Assigned Coach,Available Times\n';

latestPlan.students.forEach(student => {
  // Find assignment
  const assignment = latestPlan.schedule.find(c => c.students.includes(student._id));
  const day = assignment ? assignment.day : '';
  const hour = assignment ? assignment.hour : '';
  const coach = assignment ? assignment.coachName : '';

  const levelGroup = student.adult ? student.skillLevel || '' : student.trainigGroup || '';
  const availableTimes = (student.availableTimes || []).join('; ');

  studentCsv += `"${student.firstName}","${student.lastName}","${student.birthDate || ''}","${student.email || ''}","${student.phone || ''}","${student.adress || ''}","${levelGroup}",${student.adult ? 'Yes' : 'No'},"${day}","${hour}","${coach}","${availableTimes}"\n`;
});

const studentCsvFile = 'optimal-course-plan-students.csv';
fs.writeFileSync(studentCsvFile, studentCsv, 'utf8');
console.log(` CSV exported (students): ${studentCsvFile}`);

// Generate statistics file
const stats = {
  planName: latestPlan.name,
  generated: latestPlan.createdAt,
  totalStudents: latestPlan.students.length,
  assignedStudents: latestPlan.students.length - (latestPlan.studentsNotSet?.length || 0),
  unassignedStudents: latestPlan.studentsNotSet?.length || 0,
  totalCourses: latestPlan.schedule.length,
  fullCourses: latestPlan.schedule.filter(c => c.students.length === 4).length,
  threeCourses: latestPlan.schedule.filter(c => c.students.length === 3).length,
  twoCourses: latestPlan.schedule.filter(c => c.students.length === 2).length,
  singleCourses: latestPlan.schedule.filter(c => c.students.length === 1).length,
  efficiency: (latestPlan.schedule.filter(c => c.students.length >= 3).length / latestPlan.schedule.length * 100).toFixed(1) + '%'
};

let statsTxt = `OPTIMAL COURSE PLAN STATISTICS
===============================

Plan Name: ${stats.planName}
Generated: ${new Date(stats.generated).toLocaleString('de-DE')}

STUDENTS
--------
Total: ${stats.totalStudents}
Assigned: ${stats.assignedStudents}
Unassigned: ${stats.unassignedStudents}

COURSES
-------
Total: ${stats.totalCourses}
  4 students: ${stats.fullCourses} (${(stats.fullCourses/stats.totalCourses*100).toFixed(1)}%)
  3 students: ${stats.threeCourses} (${(stats.threeCourses/stats.totalCourses*100).toFixed(1)}%)
  2 students: ${stats.twoCourses} (${(stats.twoCourses/stats.totalCourses*100).toFixed(1)}%)
  1 student: ${stats.singleCourses} (${(stats.singleCourses/stats.totalCourses*100).toFixed(1)}%)

Efficiency (3-4 students): ${stats.efficiency}
`;

if (latestPlan.studentsNotSet && latestPlan.studentsNotSet.length > 0) {
  statsTxt += `\nUNASSIGNED STUDENTS\n-------------------\n`;
  latestPlan.studentsNotSet.forEach(s => {
    statsTxt += `- ${s.firstName} ${s.lastName} (${s.adult ? s.skillLevel : s.trainigGroup})\n`;
  });
}

fs.writeFileSync('optimal-course-plan-stats.txt', statsTxt, 'utf8');
console.log(` Statistics exported: optimal-course-plan-stats.txt\n`);

await mongoose.connection.close();
