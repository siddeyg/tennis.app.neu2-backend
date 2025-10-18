import fs from 'fs';

const plan = JSON.parse(fs.readFileSync('manual-optimal-donnerstag20.json', 'utf8'));

console.log('📄 Exporting manual Donnerstag 20 plan to HTML...\n');

const days = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const hours = [10, 11, 12, 15, 16, 17, 18, 19, 20];

// Group courses by day and hour
const grid = {};
days.forEach(day => {
  hours.forEach(hour => {
    const key = `${day}-${hour}`;
    grid[key] = plan.courses.filter(c => c.day === day && c.hour === hour);
  });
});

const html = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Manual Optimal Plan - Donnerstag 20 Focus - ${new Date().toLocaleDateString('de-DE')}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    h1 { color: #333; text-align: center; }
    .stats { background: white; padding: 20px; margin-bottom: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .stats h2 { margin-top: 0; color: #2c5; }
    .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-top: 15px; }
    .stat-card { background: #f8f9fa; padding: 15px; border-radius: 6px; border-left: 4px solid #2c5; }
    .stat-card h3 { margin: 0 0 5px 0; font-size: 14px; color: #666; }
    .stat-card .value { font-size: 24px; font-weight: bold; color: #333; }
    table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-top: 20px; }
    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; vertical-align: top; }
    th { background: #2c5; color: white; font-weight: bold; position: sticky; top: 0; }
    .time-cell { font-weight: bold; background: #f8f9fa; white-space: nowrap; }
    .course { margin-bottom: 8px; padding: 8px; border-radius: 4px; }
    .course-4 { background: #d4edda; border-left: 4px solid #28a745; }
    .course-3 { background: #fff3cd; border-left: 4px solid #ffc107; }
    .course-2 { background: #ffe6cc; border-left: 4px solid #fd7e14; }
    .course-1 { background: #f8d7da; border-left: 4px solid #dc3545; }
    .coach { font-weight: bold; color: #0066cc; margin-bottom: 4px; font-size: 12px; }
    .student { font-size: 11px; margin-left: 8px; }
    .level { color: #666; font-style: italic; font-size: 10px; }
    .highlight-do20 { border: 3px solid #ff6600 !important; background: #fff3e6 !important; }
  </style>
</head>
<body>
  <h1>🏆 Manual Optimal Plan - Donnerstag 20:00 Focus</h1>

  <div class="stats">
    <h2>📊 Statistics</h2>
    <p><strong>Generated:</strong> ${new Date().toLocaleString('de-DE')}</p>
    <p><strong>Method:</strong> Manual Planning based on DONNERSTAG_20_RECOMMENDATION.md</p>

    <div class="stats-grid">
      <div class="stat-card">
        <h3>Total Students</h3>
        <div class="value">${plan.statistics.assigned}/${plan.statistics.assigned + plan.statistics.unassigned}</div>
        <small>Assignment Rate: ${(plan.statistics.assigned / (plan.statistics.assigned + plan.statistics.unassigned) * 100).toFixed(1)}%</small>
      </div>

      <div class="stat-card">
        <h3>Total Courses</h3>
        <div class="value">${plan.statistics.totalCourses}</div>
        <small>Coach hours per week</small>
      </div>

      <div class="stat-card">
        <h3>Full Courses (4 students)</h3>
        <div class="value">${plan.statistics.course4} (${(plan.statistics.course4 / plan.statistics.totalCourses * 100).toFixed(1)}%)</div>
        <small>${plan.statistics.course4 * 4} students in optimal courses</small>
      </div>

      <div class="stat-card">
        <h3>Efficiency</h3>
        <div class="value">${((plan.statistics.course3 + plan.statistics.course4) / plan.statistics.totalCourses * 100).toFixed(1)}%</div>
        <small>Courses with 3-4 students</small>
      </div>
    </div>

    <p style="margin-top: 15px;"><strong>Course Breakdown:</strong></p>
    <ul style="margin: 5px 0;">
      <li>4-student courses: <strong>${plan.statistics.course4}</strong> (${(plan.statistics.course4 / plan.statistics.totalCourses * 100).toFixed(1)}%)</li>
      <li>3-student courses: <strong>${plan.statistics.course3}</strong> (${(plan.statistics.course3 / plan.statistics.totalCourses * 100).toFixed(1)}%)</li>
      <li>2-student courses: <strong>${plan.statistics.course2}</strong> (${(plan.statistics.course2 / plan.statistics.totalCourses * 100).toFixed(1)}%)</li>
      <li>1-student courses: <strong>${plan.statistics.course1}</strong> (${(plan.statistics.course1 / plan.statistics.totalCourses * 100).toFixed(1)}%)</li>
    </ul>

    <div class="stat-card" style="margin-top: 15px; background: #fff3e6; border-left: 4px solid #ff6600;">
      <h3>🔥 Donnerstag 20:00 Highlight</h3>
      <p style="margin: 5px 0;"><strong>Courses:</strong> ${plan.courses.filter(c => c.day === 'Donnerstag' && c.hour === 20).length}</p>
      <p style="margin: 5px 0;"><strong>Students:</strong> ${plan.courses.filter(c => c.day === 'Donnerstag' && c.hour === 20).reduce((sum, c) => sum + c.students.length, 0)}</p>
      <p style="margin: 5px 0;"><strong>Full Courses:</strong> ${plan.courses.filter(c => c.day === 'Donnerstag' && c.hour === 20 && c.students.length === 4).length}</p>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="time-cell">Zeit</th>
        <th>Montag</th>
        <th>Dienstag</th>
        <th>Mittwoch</th>
        <th>Donnerstag</th>
        <th>Freitag</th>
        <th>Samstag</th>
      </tr>
    </thead>
    <tbody>`;

let htmlBody = '';
hours.forEach(hour => {
  htmlBody += `
      <tr>
        <td class="time-cell">${hour}:00</td>`;

  days.forEach(day => {
    const key = `${day}-${hour}`;
    const courses = grid[key];

    htmlBody += `
        <td${day === 'Donnerstag' && hour === 20 ? ' style="background: #fff3e6;"' : ''}>`;

    courses.forEach(course => {
      const sizeClass = `course-${course.students.length}`;
      const isDo20 = day === 'Donnerstag' && hour === 20;

      htmlBody += `
          <div class="course ${sizeClass}${isDo20 ? ' highlight-do20' : ''}">
            <div class="coach">👨‍🏫 ${course.coach}</div>`;

      course.students.forEach(s => {
        htmlBody += `
            <div class="student">• ${s.name} <span class="level">(${s.level})</span></div>`;
      });

      htmlBody += `
          </div>`;
    });

    htmlBody += `
        </td>`;
  });

  htmlBody += `
      </tr>`;
});

const htmlEnd = `
    </tbody>
  </table>

</body>
</html>`;

const finalHtml = html + htmlBody + htmlEnd;
fs.writeFileSync('manual-optimal-donnerstag20.html', finalHtml);

console.log('✅ manual-optimal-donnerstag20.html created\n');

// Create CSV too
const csvHeaders = ['Kurs ID', 'Tag', 'Uhrzeit', 'Trainer', 'Gruppe', 'Kursgröße', 'Schüler Name', 'Schüler Level', 'Geschlecht'];
let csv = csvHeaders.join(',') + '\n';

plan.courses.forEach(course => {
  course.students.forEach(student => {
    const row = [
      course.id,
      course.day,
      `${course.hour}:00`,
      `"${course.coach}"`,
      `"${course.groupLabel}"`,
      course.students.length,
      `"${student.name}"`,
      `"${student.level}"`,
      student.gender
    ];
    csv += row.join(',') + '\n';
  });
});

fs.writeFileSync('manual-optimal-donnerstag20.csv', csv);
console.log('✅ manual-optimal-donnerstag20.csv created\n');

console.log('📦 Full plan exported successfully!');
