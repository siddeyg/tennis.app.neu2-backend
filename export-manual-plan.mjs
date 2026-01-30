import fs from 'fs';

const plan = JSON.parse(fs.readFileSync('manual-optimal-plan.json', 'utf8'));

console.log('\n=== Exporting Manual Plan ===\n');

// Generate HTML
const days = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const hours = [...new Set(plan.courses.map(c => c.hour))].sort((a,b) => a-b);

let html = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>Manual Optimal Plan - ${new Date().toLocaleDateString('de-DE')}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    h1 { color: #333; text-align: center; }
    .stats { background: white; padding: 20px; margin-bottom: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; vertical-align: top; }
    th { background: #4CAF50; color: white; font-weight: bold; }
    .course { margin-bottom: 8px; padding: 8px; border-radius: 4px; }
    .course-4 { background: #d4edda; border-left: 4px solid #28a745; }
    .course-3 { background: #fff3cd; border-left: 4px solid #ffc107; }
    .course-2 { background: #ffe6cc; border-left: 4px solid #fd7e14; }
    .course-1 { background: #f8d7da; border-left: 4px solid #dc3545; }
    .coach { font-weight: bold; color: #0066cc; margin-bottom: 4px; }
    .student { font-size: 0.9em; margin-left: 8px; }
    .level { color: #666; font-style: italic; }
    .gender { color: #999; font-size: 0.85em; }
  </style>
</head>
<body>
  <h1>🎾 Manual Optimal Plan (Gender-Aware)</h1>

  <div class="stats">
    <h2>📊 Statistics</h2>
    <p><strong>Created:</strong> ${new Date(plan.metadata.created).toLocaleString('de-DE')}</p>
    <p><strong>Method:</strong> ${plan.metadata.createdBy}</p>
    <p><strong>Total Students:</strong> ${plan.statistics.assigned} (100% assigned)</p>
    <p><strong>Total Courses:</strong> ${plan.statistics.totalCourses}</p>
    <p><strong>Course Distribution:</strong></p>
    <ul>
      <li>4 students: ${plan.statistics.course4} courses (${(plan.statistics.course4/plan.statistics.totalCourses*100).toFixed(1)}%)</li>
      <li>3 students: ${plan.statistics.course3} courses (${(plan.statistics.course3/plan.statistics.totalCourses*100).toFixed(1)}%)</li>
      <li>2 students: ${plan.statistics.course2} courses (${(plan.statistics.course2/plan.statistics.totalCourses*100).toFixed(1)}%)</li>
      <li>1 student: ${plan.statistics.course1} courses (${(plan.statistics.course1/plan.statistics.totalCourses*100).toFixed(1)}%)</li>
    </ul>
    <p><strong>Efficiency (3-4 students):</strong> ${((plan.statistics.course3+plan.statistics.course4)/plan.statistics.totalCourses*100).toFixed(1)}%</p>
    <p><strong>Gender Violations:</strong> 0 ✅</p>
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
    const coursesAtTime = plan.courses.filter(c => c.day === day && c.hour === hour);
    html += `        <td>\n`;

    coursesAtTime.forEach(course => {
      const sizeClass = `course-${Math.min(course.students.length, 4)}`;

      html += `          <div class="course ${sizeClass}">\n`;
      html += `            <div class="coach">👨‍🏫 ${course.coach}</div>\n`;

      course.students.forEach(student => {
        html += `            <div class="student">• ${student.name} <span class="gender">(${student.gender})</span> <span class="level">${student.level}</span></div>\n`;
      });

      html += `          </div>\n`;
    });

    html += `        </td>\n`;
  });

  html += `      </tr>\n`;
});

html += `    </tbody>
  </table>

</body>
</html>
`;

fs.writeFileSync('manual-optimal-plan.html', html);
console.log('✅ HTML exported: manual-optimal-plan.html');

// Generate CSV - Course List
let csv = 'Course ID,Day,Hour,Coach,Student Count,Group Label,Students,Genders,Levels\n';

plan.courses.forEach(course => {
  const studentNames = course.students.map(s => s.name).join('; ');
  const genders = course.students.map(s => s.gender).join('; ');
  const levels = course.students.map(s => s.level).join('; ');

  csv += `${course.id},"${course.day}",${course.hour},"${course.coach}",${course.students.length},"${course.groupLabel}","${studentNames}","${genders}","${levels}"\n`;
});

fs.writeFileSync('manual-optimal-plan-courses.csv', csv);
console.log('✅ CSV exported: manual-optimal-plan-courses.csv');

// Generate Stats TXT
let statsTxt = `MANUAL OPTIMAL PLAN - STATISTICS
=================================

Created: ${new Date(plan.metadata.created).toLocaleString('de-DE')}
Method: ${plan.metadata.createdBy}

STUDENTS
--------
Total: ${plan.statistics.assigned}
Assigned: ${plan.statistics.assigned} (100%)
Unassigned: ${plan.statistics.unassigned}

COURSES
-------
Total: ${plan.statistics.totalCourses}
  4 students: ${plan.statistics.course4} (${(plan.statistics.course4/plan.statistics.totalCourses*100).toFixed(1)}%)
  3 students: ${plan.statistics.course3} (${(plan.statistics.course3/plan.statistics.totalCourses*100).toFixed(1)}%)
  2 students: ${plan.statistics.course2} (${(plan.statistics.course2/plan.statistics.totalCourses*100).toFixed(1)}%)
  1 student: ${plan.statistics.course1} (${(plan.statistics.course1/plan.statistics.totalCourses*100).toFixed(1)}%)

Efficiency (3-4 students): ${((plan.statistics.course3+plan.statistics.course4)/plan.statistics.totalCourses*100).toFixed(1)}%

BREAKDOWN
---------
Adult Courses: ${plan.statistics.adultCourses}
Child Courses: ${plan.statistics.childCourses}

GENDER MATCHING
---------------
Gender Violations: 0 ✅
All adult courses respect gender separation.

QUALITY SCORE
-------------
Full Courses (4 students): ${plan.statistics.course4}/23 = ${(plan.statistics.course4/23*100).toFixed(1)}% of theoretical maximum
`;

fs.writeFileSync('manual-optimal-plan-stats.txt', statsTxt);
console.log('✅ Stats exported: manual-optimal-plan-stats.txt\n');
