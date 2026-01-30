import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({path:'./.env.development'});
await mongoose.connect(process.env.MONGO_URI||'mongodb://localhost:27017/tennis-coach');

const Student = mongoose.model('Student', new mongoose.Schema({}, {strict: false}), 'students');
const Coach = mongoose.model('Coach', new mongoose.Schema({}, {strict: false}), 'coaches');

const students = await Student.find({}).lean();
const coaches = await Coach.find({}).lean();
const perfectPlan = JSON.parse(fs.readFileSync('perfect-optimal-plan.json', 'utf8'));

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║   EXPORTING PERFECT PLAN - ALL FORMATS                     ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// ===========================================
// HELPER: Generate HTML
// ===========================================
const generateHTML = (plan, title, description) => {
  const days = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  const hours = Array.from(new Set(plan.courses.map(c => c.hour))).sort((a,b) => a-b);

  const stats = plan.statistics || {
    totalCourses: plan.courses.length,
    course4: plan.courses.filter(c => c.students.length === 4).length,
    course3: plan.courses.filter(c => c.students.length === 3).length,
    course2: plan.courses.filter(c => c.students.length === 2).length,
    course1: plan.courses.filter(c => c.students.length === 1).length,
    assigned: plan.courses.reduce((sum, c) => sum + c.students.length, 0)
  };

  const efficiency = ((stats.course4 + stats.course3) / stats.totalCourses * 100).toFixed(1);

  let html = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    h1 { color: #333; text-align: center; margin-bottom: 10px; }
    .subtitle { text-align: center; color: #666; margin-bottom: 30px; }
    .stats { background: white; padding: 20px; margin-bottom: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .stats h2 { margin-top: 0; color: #28a745; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 15px; }
    .stat-card { background: #f8f9fa; padding: 15px; border-radius: 6px; border-left: 4px solid #28a745; }
    .stat-card h3 { margin: 0 0 5px 0; font-size: 14px; color: #666; }
    .stat-card .value { font-size: 28px; font-weight: bold; color: #333; }
    .stat-card .subvalue { font-size: 12px; color: #666; }
    table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-top: 20px; page-break-inside: auto; }
    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; vertical-align: top; page-break-inside: avoid; }
    th { background: #28a745; color: white; font-weight: bold; position: sticky; top: 0; }
    .time-cell { font-weight: bold; background: #f8f9fa; white-space: nowrap; width: 80px; }
    .course { margin-bottom: 8px; padding: 8px; border-radius: 4px; page-break-inside: avoid; }
    .course-4 { background: #d4edda; border-left: 4px solid #28a745; }
    .course-3 { background: #fff3cd; border-left: 4px solid #ffc107; }
    .course-2 { background: #ffe6cc; border-left: 4px solid #fd7e14; }
    .course-1 { background: #f8d7da; border-left: 4px solid #dc3545; }
    .coach { font-weight: bold; color: #0066cc; margin-bottom: 4px; font-size: 12px; }
    .student { font-size: 11px; margin-left: 8px; line-height: 1.4; }
    .level { color: #666; font-style: italic; font-size: 10px; }
    .footer { text-align: center; margin-top: 30px; padding: 20px; color: #666; font-size: 12px; }
    @media print {
      body { background: white; }
      .stats, table { box-shadow: none; }
      th { background: #28a745 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .course-4 { background: #d4edda !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .course-3 { background: #fff3cd !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .course-2 { background: #ffe6cc !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .course-1 { background: #f8d7da !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <h1>🎾 ${title}</h1>
  <div class="subtitle">${description}</div>

  <div class="stats">
    <h2>📊 Statistik</h2>
    <div class="stats-grid">
      <div class="stat-card">
        <h3>Schüler Gesamt</h3>
        <div class="value">${stats.assigned}</div>
        <div class="subvalue">100% zugewiesen</div>
      </div>
      <div class="stat-card">
        <h3>Kurse Gesamt</h3>
        <div class="value">${stats.totalCourses}</div>
        <div class="subvalue">Trainerstunden pro Woche</div>
      </div>
      <div class="stat-card">
        <h3>Volle Kurse (4 Schüler)</h3>
        <div class="value">${stats.course4}</div>
        <div class="subvalue">${(stats.course4/stats.totalCourses*100).toFixed(1)}% aller Kurse</div>
      </div>
      <div class="stat-card">
        <h3>Effizienz</h3>
        <div class="value">${efficiency}%</div>
        <div class="subvalue">Kurse mit 3-4 Schülern</div>
      </div>
    </div>
    <p style="margin-top: 20px;"><strong>Kursverteilung:</strong></p>
    <ul style="margin: 5px 0;">
      <li>4 Schüler: <strong>${stats.course4}</strong> Kurse (${(stats.course4/stats.totalCourses*100).toFixed(1)}%)</li>
      <li>3 Schüler: <strong>${stats.course3}</strong> Kurse (${(stats.course3/stats.totalCourses*100).toFixed(1)}%)</li>
      <li>2 Schüler: <strong>${stats.course2}</strong> Kurse (${(stats.course2/stats.totalCourses*100).toFixed(1)}%)</li>
      <li>1 Schüler: <strong>${stats.course1}</strong> Kurse (${(stats.course1/stats.totalCourses*100).toFixed(1)}%)</li>
    </ul>
  </div>

  <table>
    <thead>
      <tr>
        <th class="time-cell">Zeit</th>
`;

  days.forEach(day => {
    html += `        <th>${day}</th>\n`;
  });

  html += `      </tr>
    </thead>
    <tbody>
`;

  hours.forEach(hour => {
    html += `      <tr>\n        <td class="time-cell">${hour}:00</td>\n`;

    days.forEach(day => {
      const coursesAtTime = plan.courses.filter(c => c.day === day && c.hour === hour);
      html += `        <td>\n`;

      coursesAtTime.forEach(course => {
        const sizeClass = `course-${Math.min(course.students.length, 4)}`;

        html += `          <div class="course ${sizeClass}">\n`;
        html += `            <div class="coach">👨‍🏫 ${course.coach}</div>\n`;

        course.students.forEach(student => {
          html += `            <div class="student">• ${student.name} <span class="level">(${student.level})</span></div>\n`;
        });

        html += `          </div>\n`;
      });

      html += `        </td>\n`;
    });

    html += `      </tr>\n`;
  });

  html += `    </tbody>
  </table>

  <div class="footer">
    <p>Erstellt am: ${new Date().toLocaleString('de-DE')}</p>
    <p>TC GW Am Kreuzberg - Trainingsplan ${new Date().getFullYear()}</p>
  </div>

</body>
</html>
`;

  return html;
};

// ===========================================
// HELPER: Generate CSV (manual implementation)
// ===========================================
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
        course.groupLabel,
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

// ===========================================
// EXPORT 1: Full Perfect Plan
// ===========================================
console.log('📄 Exporting FULL PERFECT PLAN...\n');

// HTML (already exists from previous script, regenerate for consistency)
const fullHTML = generateHTML(
  perfectPlan,
  'Perfect Optimal Plan - Vollständig',
  'Optimaler Trainingsplan für alle Schüler (Erwachsene + Kinder)'
);
fs.writeFileSync('perfect-optimal-plan-full.html', fullHTML);
console.log('✅ perfect-optimal-plan-full.html');

// CSV
const fullCSV = generateCSV(perfectPlan);
fs.writeFileSync('perfect-optimal-plan-full.csv', fullCSV);
console.log('✅ perfect-optimal-plan-full.csv');

// ===========================================
// EXPORT 2: Adults Only Plan
// ===========================================
console.log('\n📄 Exporting ADULTS ONLY PLAN...\n');

const adultCourses = perfectPlan.courses
  .filter(c => c.groupLabel.startsWith('adult'))
  .map((c, idx) => ({ ...c, id: idx + 1 }));

const adultPlan = {
  metadata: {
    title: "Perfect Optimal Plan - Erwachsene",
    created: new Date().toISOString(),
    createdBy: "Automated Optimization Algorithm",
    description: "Optimaler Trainingsplan nur für Erwachsene"
  },
  statistics: {
    totalCourses: adultCourses.length,
    course4: adultCourses.filter(c => c.students.length === 4).length,
    course3: adultCourses.filter(c => c.students.length === 3).length,
    course2: adultCourses.filter(c => c.students.length === 2).length,
    course1: adultCourses.filter(c => c.students.length === 1).length,
    assigned: adultCourses.reduce((sum, c) => sum + c.students.length, 0),
    unassigned: 0
  },
  courses: adultCourses
};

// HTML
const adultHTML = generateHTML(
  adultPlan,
  'Perfect Optimal Plan - Erwachsene',
  'Optimaler Trainingsplan nur für Erwachsene (18+)'
);
fs.writeFileSync('perfect-optimal-plan-adults.html', adultHTML);
console.log('✅ perfect-optimal-plan-adults.html');

// CSV
const adultCSV = generateCSV(adultPlan);
fs.writeFileSync('perfect-optimal-plan-adults.csv', adultCSV);
console.log('✅ perfect-optimal-plan-adults.csv');

// JSON
fs.writeFileSync('perfect-optimal-plan-adults.json', JSON.stringify(adultPlan, null, 2));
console.log('✅ perfect-optimal-plan-adults.json');

console.log(`\n   Adults: ${adultPlan.statistics.assigned} Schüler, ${adultPlan.statistics.totalCourses} Kurse`);
console.log(`   Full courses: ${adultPlan.statistics.course4} (${(adultPlan.statistics.course4/adultPlan.statistics.totalCourses*100).toFixed(1)}%)`);

// ===========================================
// EXPORT 3: Children Only Plan (Under 18)
// ===========================================
console.log('\n📄 Exporting CHILDREN ONLY PLAN (Under 18)...\n');

const childCourses = perfectPlan.courses
  .filter(c => c.groupLabel.startsWith('child'))
  .map((c, idx) => ({ ...c, id: idx + 1 }));

const childPlan = {
  metadata: {
    title: "Perfect Optimal Plan - Kinder",
    created: new Date().toISOString(),
    createdBy: "Automated Optimization Algorithm",
    description: "Optimaler Trainingsplan nur für Kinder (unter 18)"
  },
  statistics: {
    totalCourses: childCourses.length,
    course4: childCourses.filter(c => c.students.length === 4).length,
    course3: childCourses.filter(c => c.students.length === 3).length,
    course2: childCourses.filter(c => c.students.length === 2).length,
    course1: childCourses.filter(c => c.students.length === 1).length,
    assigned: childCourses.reduce((sum, c) => sum + c.students.length, 0),
    unassigned: 0
  },
  courses: childCourses
};

// HTML
const childHTML = generateHTML(
  childPlan,
  'Perfect Optimal Plan - Kinder',
  'Optimaler Trainingsplan nur für Kinder (unter 18 Jahre)'
);
fs.writeFileSync('perfect-optimal-plan-children.html', childHTML);
console.log('✅ perfect-optimal-plan-children.html');

// CSV
const childCSV = generateCSV(childPlan);
fs.writeFileSync('perfect-optimal-plan-children.csv', childCSV);
console.log('✅ perfect-optimal-plan-children.csv');

// JSON
fs.writeFileSync('perfect-optimal-plan-children.json', JSON.stringify(childPlan, null, 2));
console.log('✅ perfect-optimal-plan-children.json');

console.log(`\n   Children: ${childPlan.statistics.assigned} Schüler, ${childPlan.statistics.totalCourses} Kurse`);
console.log(`   Full courses: ${childPlan.statistics.course4} (${(childPlan.statistics.course4/childPlan.statistics.totalCourses*100).toFixed(1)}%)`);

// ===========================================
// SUMMARY
// ===========================================
console.log('\n\n╔════════════════════════════════════════════════════════════╗');
console.log('║   EXPORT SUMMARY                                           ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

console.log('📦 FILES CREATED:\n');

console.log('   FULL PLAN (All Students):');
console.log('   ├─ perfect-optimal-plan-full.html (visual schedule)');
console.log('   ├─ perfect-optimal-plan-full.csv (data export)');
console.log('   └─ perfect-optimal-plan.json (already exists)\n');

console.log('   ADULTS ONLY (18+):');
console.log('   ├─ perfect-optimal-plan-adults.html (visual schedule)');
console.log('   ├─ perfect-optimal-plan-adults.csv (data export)');
console.log('   └─ perfect-optimal-plan-adults.json (data file)\n');

console.log('   CHILDREN ONLY (Under 18):');
console.log('   ├─ perfect-optimal-plan-children.html (visual schedule)');
console.log('   ├─ perfect-optimal-plan-children.csv (data export)');
console.log('   └─ perfect-optimal-plan-children.json (data file)\n');

console.log('📊 BREAKDOWN:\n');
console.log(`   Total Students: ${perfectPlan.statistics.assigned}`);
console.log(`   ├─ Adults: ${adultPlan.statistics.assigned} (${adultPlan.statistics.totalCourses} courses, ${adultPlan.statistics.course4} full)`);
console.log(`   └─ Children: ${childPlan.statistics.assigned} (${childPlan.statistics.totalCourses} courses, ${childPlan.statistics.course4} full)\n`);

console.log('💡 NOTE: PDF export requires additional library (puppeteer).');
console.log('   You can print the HTML files to PDF from your browser (Ctrl+P).\n');

mongoose.connection.close();
