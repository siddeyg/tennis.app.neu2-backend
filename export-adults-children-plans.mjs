import fs from 'fs';

const plan = JSON.parse(fs.readFileSync('manual-optimal-donnerstag20.json', 'utf8'));

console.log('📄 Creating adults-only and children-only plans...\n');

// ============================================================================
// ADULTS ONLY
// ============================================================================

const adultsOnly = {
  ...plan,
  metadata: {
    ...plan.metadata,
    title: "Manual Optimal Plan - Erwachsene (18+) - Donnerstag 20 Focus"
  },
  courses: plan.courses.filter(c => c.groupLabel.startsWith('adult-'))
};

adultsOnly.statistics = {
  totalCourses: adultsOnly.courses.length,
  course4: adultsOnly.courses.filter(c => c.students.length === 4).length,
  course3: adultsOnly.courses.filter(c => c.students.length === 3).length,
  course2: adultsOnly.courses.filter(c => c.students.length === 2).length,
  course1: adultsOnly.courses.filter(c => c.students.length === 1).length,
  assigned: adultsOnly.courses.reduce((sum, c) => sum + c.students.length, 0),
  unassigned: 0
};

fs.writeFileSync('manual-optimal-donnerstag20-adults.json', JSON.stringify(adultsOnly, null, 2));

console.log('✅ Adults plan JSON saved');
console.log(`   Adults: ${adultsOnly.statistics.assigned} students, ${adultsOnly.statistics.totalCourses} courses`);
console.log(`   Full courses: ${adultsOnly.statistics.course4} (${(adultsOnly.statistics.course4 / adultsOnly.statistics.totalCourses * 100).toFixed(1)}%)\n`);

// Adults HTML
const days = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const hours = [10, 11, 12, 15, 16, 17, 18, 19, 20];

const gridAdults = {};
days.forEach(day => {
  hours.forEach(hour => {
    const key = `${day}-${hour}`;
    gridAdults[key] = adultsOnly.courses.filter(c => c.day === day && c.hour === hour);
  });
});

let htmlAdults = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Manual Plan - Erwachsene (18+) - ${new Date().toLocaleDateString('de-DE')}</title>
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
  <h1>👔 Manual Plan - Erwachsene (18+)</h1>

  <div class="stats">
    <h2>📊 Statistics - Adults Only</h2>
    <p><strong>Generated:</strong> ${new Date().toLocaleString('de-DE')}</p>

    <div class="stats-grid">
      <div class="stat-card">
        <h3>Total Adults</h3>
        <div class="value">${adultsOnly.statistics.assigned}</div>
        <small>All adults assigned</small>
      </div>

      <div class="stat-card">
        <h3>Total Courses</h3>
        <div class="value">${adultsOnly.statistics.totalCourses}</div>
        <small>Adult courses per week</small>
      </div>

      <div class="stat-card">
        <h3>Full Courses (4 students)</h3>
        <div class="value">${adultsOnly.statistics.course4} (${(adultsOnly.statistics.course4 / adultsOnly.statistics.totalCourses * 100).toFixed(1)}%)</div>
        <small>${adultsOnly.statistics.course4 * 4} adults in optimal courses</small>
      </div>

      <div class="stat-card">
        <h3>Efficiency</h3>
        <div class="value">${((adultsOnly.statistics.course3 + adultsOnly.statistics.course4) / adultsOnly.statistics.totalCourses * 100).toFixed(1)}%</div>
        <small>Courses with 3-4 students</small>
      </div>
    </div>

    <div class="stat-card" style="margin-top: 15px; background: #fff3e6; border-left: 4px solid #ff6600;">
      <h3>🔥 Donnerstag 20:00 Focus</h3>
      <p style="margin: 5px 0;"><strong>Courses:</strong> ${adultsOnly.courses.filter(c => c.day === 'Donnerstag' && c.hour === 20).length}</p>
      <p style="margin: 5px 0;"><strong>Adults:</strong> ${adultsOnly.courses.filter(c => c.day === 'Donnerstag' && c.hour === 20).reduce((sum, c) => sum + c.students.length, 0)}</p>
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

hours.forEach(hour => {
  htmlAdults += `
      <tr>
        <td class="time-cell">${hour}:00</td>`;

  days.forEach(day => {
    const key = `${day}-${hour}`;
    const courses = gridAdults[key];

    htmlAdults += `
        <td${day === 'Donnerstag' && hour === 20 ? ' style="background: #fff3e6;"' : ''}>`;

    courses.forEach(course => {
      const sizeClass = `course-${course.students.length}`;
      const isDo20 = day === 'Donnerstag' && hour === 20;

      htmlAdults += `
          <div class="course ${sizeClass}${isDo20 ? ' highlight-do20' : ''}">
            <div class="coach">👨‍🏫 ${course.coach}</div>`;

      course.students.forEach(s => {
        htmlAdults += `
            <div class="student">• ${s.name} <span class="level">(${s.level})</span></div>`;
      });

      htmlAdults += `
          </div>`;
    });

    htmlAdults += `
        </td>`;
  });

  htmlAdults += `
      </tr>`;
});

htmlAdults += `
    </tbody>
  </table>
</body>
</html>`;

fs.writeFileSync('manual-optimal-donnerstag20-adults.html', htmlAdults);
console.log('✅ manual-optimal-donnerstag20-adults.html created');

// ============================================================================
// CHILDREN ONLY
// ============================================================================

const childrenOnly = {
  ...plan,
  metadata: {
    ...plan.metadata,
    title: "Manual Optimal Plan - Kinder (Unter 18)"
  },
  courses: plan.courses.filter(c => c.groupLabel.startsWith('child-'))
};

childrenOnly.statistics = {
  totalCourses: childrenOnly.courses.length,
  course4: childrenOnly.courses.filter(c => c.students.length === 4).length,
  course3: childrenOnly.courses.filter(c => c.students.length === 3).length,
  course2: childrenOnly.courses.filter(c => c.students.length === 2).length,
  course1: childrenOnly.courses.filter(c => c.students.length === 1).length,
  assigned: childrenOnly.courses.reduce((sum, c) => sum + c.students.length, 0),
  unassigned: 0
};

fs.writeFileSync('manual-optimal-donnerstag20-children.json', JSON.stringify(childrenOnly, null, 2));

console.log('✅ Children plan JSON saved');
console.log(`   Children: ${childrenOnly.statistics.assigned} students, ${childrenOnly.statistics.totalCourses} courses`);
console.log(`   Full courses: ${childrenOnly.statistics.course4} (${(childrenOnly.statistics.course4 / childrenOnly.statistics.totalCourses * 100).toFixed(1)}%)\n`);

// Children HTML
const gridChildren = {};
days.forEach(day => {
  hours.forEach(hour => {
    const key = `${day}-${hour}`;
    gridChildren[key] = childrenOnly.courses.filter(c => c.day === day && c.hour === hour);
  });
});

let htmlChildren = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Manual Plan - Kinder (Unter 18) - ${new Date().toLocaleDateString('de-DE')}</title>
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
  </style>
</head>
<body>
  <h1>👶 Manual Plan - Kinder (Unter 18)</h1>

  <div class="stats">
    <h2>📊 Statistics - Children Only</h2>
    <p><strong>Generated:</strong> ${new Date().toLocaleString('de-DE')}</p>

    <div class="stats-grid">
      <div class="stat-card">
        <h3>Total Children</h3>
        <div class="value">${childrenOnly.statistics.assigned}</div>
        <small>All children assigned</small>
      </div>

      <div class="stat-card">
        <h3>Total Courses</h3>
        <div class="value">${childrenOnly.statistics.totalCourses}</div>
        <small>Children courses per week</small>
      </div>

      <div class="stat-card">
        <h3>Full Courses (4 students)</h3>
        <div class="value">${childrenOnly.statistics.course4} (${(childrenOnly.statistics.course4 / childrenOnly.statistics.totalCourses * 100).toFixed(1)}%)</div>
        <small>${childrenOnly.statistics.course4 * 4} children in optimal courses</small>
      </div>

      <div class="stat-card">
        <h3>Efficiency</h3>
        <div class="value">${((childrenOnly.statistics.course3 + childrenOnly.statistics.course4) / childrenOnly.statistics.totalCourses * 100).toFixed(1)}%</div>
        <small>Courses with 3-4 students</small>
      </div>
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

hours.forEach(hour => {
  htmlChildren += `
      <tr>
        <td class="time-cell">${hour}:00</td>`;

  days.forEach(day => {
    const key = `${day}-${hour}`;
    const courses = gridChildren[key];

    htmlChildren += `
        <td>`;

    courses.forEach(course => {
      const sizeClass = `course-${course.students.length}`;

      htmlChildren += `
          <div class="course ${sizeClass}">
            <div class="coach">👨‍🏫 ${course.coach}</div>`;

      course.students.forEach(s => {
        htmlChildren += `
            <div class="student">• ${s.name} <span class="level">(${s.level})</span></div>`;
      });

      htmlChildren += `
          </div>`;
    });

    htmlChildren += `
        </td>`;
  });

  htmlChildren += `
      </tr>`;
});

htmlChildren += `
    </tbody>
  </table>
</body>
</html>`;

fs.writeFileSync('manual-optimal-donnerstag20-children.html', htmlChildren);
console.log('✅ manual-optimal-donnerstag20-children.html created\n');

console.log('📦 All plans exported successfully!');
