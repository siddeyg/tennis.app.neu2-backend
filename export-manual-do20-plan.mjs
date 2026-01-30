import fs from 'fs';

const plan = JSON.parse(fs.readFileSync('manual-optimal-plan-do20.json', 'utf8'));

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║   EXPORTING MANUAL PLAN (WITH DO 20) - ALL FORMATS        ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// ============================================================================
// HTML EXPORT
// ============================================================================

const generateHTML = (plan, title) => {
  const days = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const hours = Array.from({ length: 12 }, (_, i) => i + 10); // 10-21

  let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #2c3e50; }
    .stats { background: #ecf0f1; padding: 15px; margin: 20px 0; border-radius: 5px; }
    .stats h2 { margin-top: 0; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th { background: #3498db; color: white; padding: 10px; text-align: left; }
    td { border: 1px solid #ddd; padding: 8px; }
    tr:nth-child(even) { background: #f2f2f2; }
    .course-4 { background: #2ecc71 !important; color: white; }
    .course-3 { background: #f39c12 !important; }
    .course-2 { background: #e74c3c !important; color: white; }
    .course-1 { background: #95a5a6 !important; color: white; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="stats">
    <h2>Statistiken</h2>
    <p><strong>Gesamt Kurse:</strong> ${plan.statistics.totalCourses}</p>
    <p><strong>Vollständige Kurse (4 Schüler):</strong> ${plan.statistics.course4} (${(plan.statistics.course4 / plan.statistics.totalCourses * 100).toFixed(1)}%)</p>
    <p><strong>Gute Kurse (3 Schüler):</strong> ${plan.statistics.course3} (${(plan.statistics.course3 / plan.statistics.totalCourses * 100).toFixed(1)}%)</p>
    <p><strong>Paare (2 Schüler):</strong> ${plan.statistics.course2} (${(plan.statistics.course2 / plan.statistics.totalCourses * 100).toFixed(1)}%)</p>
    <p><strong>Einzelunterricht (1 Schüler):</strong> ${plan.statistics.course1} (${(plan.statistics.course1 / plan.statistics.totalCourses * 100).toFixed(1)}%)</p>
    <p><strong>Effizienz (3-4 Schüler):</strong> ${((plan.statistics.course3 + plan.statistics.course4) / plan.statistics.totalCourses * 100).toFixed(1)}%</p>
    <p><strong>Zugewiesene Schüler:</strong> ${plan.statistics.assigned} / ${plan.statistics.assigned + plan.statistics.unassigned}</p>
  </div>

  <h2>Kurse nach Zeit</h2>
  <table>
    <thead>
      <tr>
        <th>Kurs ID</th>
        <th>Tag</th>
        <th>Uhrzeit</th>
        <th>Trainer</th>
        <th>Gruppe</th>
        <th>Größe</th>
        <th>Schüler</th>
      </tr>
    </thead>
    <tbody>`;

  // Group courses by day and hour
  const coursesByTime = {};
  days.forEach(day => {
    hours.forEach(hour => {
      const key = `${day}-${hour}`;
      coursesByTime[key] = plan.courses.filter(c => c.day === day && c.hour === hour);
    });
  });

  // Sort and output
  days.forEach(day => {
    hours.forEach(hour => {
      const key = `${day}-${hour}`;
      const courses = coursesByTime[key];

      courses.forEach(course => {
        const size = course.students.length;
        const sizeClass = `course-${size}`;
        const studentNames = course.students.map(s => s.name).join(', ');

        html += `
      <tr class="${sizeClass}">
        <td>${course.id}</td>
        <td>${course.day}</td>
        <td>${course.hour}:00</td>
        <td>${course.coach}</td>
        <td>${course.groupLabel}</td>
        <td><strong>${size}</strong></td>
        <td>${studentNames}</td>
      </tr>`;
      });
    });
  });

  html += `
    </tbody>
  </table>

  <h2>Donnerstag 20:00 Hervorgehoben</h2>
  <table>
    <thead>
      <tr>
        <th>Kurs ID</th>
        <th>Gruppe</th>
        <th>Trainer</th>
        <th>Schüler</th>
      </tr>
    </thead>
    <tbody>`;

  const do20Courses = plan.courses.filter(c => c.day === 'Donnerstag' && c.hour === 20);
  do20Courses.forEach(course => {
    html += `
      <tr class="course-4">
        <td>${course.id}</td>
        <td>${course.groupLabel}</td>
        <td>${course.coach}</td>
        <td>`;
    course.students.forEach(s => {
      html += `<div>${s.name}</div>`;
    });
    html += `</td>
      </tr>`;
  });

  html += `
    </tbody>
  </table>

  <p style="margin-top: 40px; color: #7f8c8d;">
    <em>Generiert: ${new Date().toLocaleString('de-DE')}</em>
  </p>
</body>
</html>`;

  return html;
};

// ============================================================================
// CSV EXPORT
// ============================================================================

const generateCSV = (plan) => {
  const headers = ['Kurs ID', 'Tag', 'Uhrzeit', 'Trainer', 'Gruppe', 'Kursgröße', 'Schüler Name', 'Schüler Level', 'Geschlecht'];
  let csv = headers.join(',') + '\n';

  plan.courses.forEach(course => {
    course.students.forEach((student) => {
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

  return csv;
};

// ============================================================================
// GENERATE FILES
// ============================================================================

console.log('📄 Exporting MANUAL PLAN WITH DONNERSTAG 20...\n');

// Full plan
const htmlFull = generateHTML(plan, 'Manual Optimal Plan (Mit Donnerstag 20:00)');
fs.writeFileSync('manual-optimal-plan-do20-full.html', htmlFull);
console.log('✅ manual-optimal-plan-do20-full.html');

const csvFull = generateCSV(plan);
fs.writeFileSync('manual-optimal-plan-do20-full.csv', csvFull);
console.log('✅ manual-optimal-plan-do20-full.csv');

// Adults only
console.log('\n📄 Exporting ADULTS ONLY PLAN...\n');

const adultsOnly = {
  ...plan,
  courses: plan.courses.filter(c => c.groupLabel.startsWith('adult_'))
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

const htmlAdults = generateHTML(adultsOnly, 'Manual Optimal Plan - Erwachsene (Mit Donnerstag 20:00)');
fs.writeFileSync('manual-optimal-plan-do20-adults.html', htmlAdults);
console.log('✅ manual-optimal-plan-do20-adults.html');

const csvAdults = generateCSV(adultsOnly);
fs.writeFileSync('manual-optimal-plan-do20-adults.csv', csvAdults);
console.log('✅ manual-optimal-plan-do20-adults.csv');

fs.writeFileSync('manual-optimal-plan-do20-adults.json', JSON.stringify(adultsOnly, null, 2));
console.log('✅ manual-optimal-plan-do20-adults.json');

console.log(`\n   Erwachsene: ${adultsOnly.statistics.assigned} Schüler, ${adultsOnly.statistics.totalCourses} Kurse`);
console.log(`   Vollständige Kurse: ${adultsOnly.statistics.course4} (${(adultsOnly.statistics.course4 / adultsOnly.statistics.totalCourses * 100).toFixed(1)}%)`);

// Children only
console.log('\n📄 Exporting CHILDREN ONLY PLAN (Under 18)...\n');

const childrenOnly = {
  ...plan,
  courses: plan.courses.filter(c => c.groupLabel.startsWith('child_'))
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

const htmlChildren = generateHTML(childrenOnly, 'Manual Optimal Plan - Kinder (Unter 18)');
fs.writeFileSync('manual-optimal-plan-do20-children.html', htmlChildren);
console.log('✅ manual-optimal-plan-do20-children.html');

const csvChildren = generateCSV(childrenOnly);
fs.writeFileSync('manual-optimal-plan-do20-children.csv', csvChildren);
console.log('✅ manual-optimal-plan-do20-children.csv');

fs.writeFileSync('manual-optimal-plan-do20-children.json', JSON.stringify(childrenOnly, null, 2));
console.log('✅ manual-optimal-plan-do20-children.json');

console.log(`\n   Kinder: ${childrenOnly.statistics.assigned} Schüler, ${childrenOnly.statistics.totalCourses} Kurse`);
console.log(`   Vollständige Kurse: ${childrenOnly.statistics.course4} (${(childrenOnly.statistics.course4 / childrenOnly.statistics.totalCourses * 100).toFixed(1)}%)`);

// ============================================================================
// SUMMARY
// ============================================================================

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║   EXPORT SUMMARY                                           ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

console.log('📦 FILES CREATED:\n');
console.log('   FULL PLAN (All Students):');
console.log('   ├─ manual-optimal-plan-do20-full.html (visual schedule)');
console.log('   ├─ manual-optimal-plan-do20-full.csv (data export)');
console.log('   └─ manual-optimal-plan-do20.json (already exists)\n');

console.log('   ADULTS ONLY (18+):');
console.log('   ├─ manual-optimal-plan-do20-adults.html (visual schedule)');
console.log('   ├─ manual-optimal-plan-do20-adults.csv (data export)');
console.log('   └─ manual-optimal-plan-do20-adults.json (data file)\n');

console.log('   CHILDREN ONLY (Under 18):');
console.log('   ├─ manual-optimal-plan-do20-children.html (visual schedule)');
console.log('   ├─ manual-optimal-plan-do20-children.csv (data export)');
console.log('   └─ manual-optimal-plan-do20-children.json (data file)\n');

console.log('📊 BREAKDOWN:\n');
console.log(`   Total Students: ${plan.statistics.assigned}`);
console.log(`   ├─ Erwachsene: ${adultsOnly.statistics.assigned} (${adultsOnly.statistics.totalCourses} Kurse, ${adultsOnly.statistics.course4} vollständig)`);
console.log(`   └─ Kinder: ${childrenOnly.statistics.assigned} (${childrenOnly.statistics.totalCourses} Kurse, ${childrenOnly.statistics.course4} vollständig)\n`);

console.log('💡 NOTE: PDF export requires additional library (puppeteer).');
console.log('   You can print the HTML files to PDF from your browser (Ctrl+P).\n');

console.log('✨ DONNERSTAG 20:00 HIGHLIGHTS:\n');
const do20 = plan.courses.filter(c => c.day === 'Donnerstag' && c.hour === 20);
do20.forEach(c => {
  console.log(`   ${c.groupLabel}:`);
  c.students.forEach(s => console.log(`      - ${s.name}`));
  console.log();
});
