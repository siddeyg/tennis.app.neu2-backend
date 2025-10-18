import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('📦 Exporting correct optimal plan...\n');

// Read the plan
const planData = JSON.parse(fs.readFileSync(join(__dirname, 'correct-optimal-plan.json'), 'utf8'));

const days = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const hours = Array.from({ length: 12 }, (_, i) => i + 10); // 10-21

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function generateHTML(courses, title, filename) {
  let html = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #333; }
    .metadata { background: #f0f0f0; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
    .metadata p { margin: 5px 0; }
    table { border-collapse: collapse; width: 100%; margin-top: 20px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #4CAF50; color: white; position: sticky; top: 0; }
    .time-cell { font-weight: bold; background-color: #f9f9f9; }
    .course { background-color: #e8f5e9; padding: 10px; margin: 5px 0; border-radius: 4px; }
    .course-header { font-weight: bold; margin-bottom: 5px; color: #2e7d32; }
    .student { margin: 3px 0; padding-left: 10px; }
    .empty { color: #999; font-style: italic; }
    .warning { background-color: #fff3cd; }
    .full-course { background-color: #d4edda; border-left: 4px solid #28a745; }
    .stats { display: flex; gap: 20px; margin-bottom: 20px; }
    .stat-box { background: #e3f2fd; padding: 15px; border-radius: 5px; flex: 1; }
    .stat-box h3 { margin: 0 0 10px 0; color: #1976d2; }
  </style>
</head>
<body>
  <h1>${title}</h1>

  <div class="metadata">
    <p><strong>Generiert:</strong> ${new Date(planData.metadata.generatedAt).toLocaleString('de-DE')}</p>
    <p><strong>Algorithmus:</strong> ${planData.metadata.algorithm}</p>
    <p><strong>Parallel Courses:</strong> ${planData.metadata.parallelCoursesFound === 0 ? '✅ NONE' : '❌ ' + planData.metadata.parallelCoursesFound}</p>
  </div>

  <div class="stats">
    <div class="stat-box">
      <h3>Kurse</h3>
      <p>Gesamt: ${planData.metadata.totalCourses}</p>
      <p>Voll (4): ${planData.metadata.fullCourses}</p>
      <p>Drei: ${planData.metadata.threeCourses}</p>
      <p>Zwei: ${planData.metadata.twoCourses}</p>
      <p>Einzel: ${planData.metadata.singleCourses}</p>
    </div>
    <div class="stat-box">
      <h3>Schüler</h3>
      <p>Gesamt: ${planData.metadata.totalStudents}</p>
      <p>Zugewiesen: ${planData.metadata.assignedStudents}</p>
      <p>Nicht zugewiesen: ${planData.metadata.unassignedStudents}</p>
    </div>
    <div class="stat-box">
      <h3>Effizienz</h3>
      <p>${planData.metadata.efficiency}</p>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Zeit</th>
        ${days.map(day => `<th>${day}</th>`).join('')}
      </tr>
    </thead>
    <tbody>`;

  for (const hour of hours) {
    html += `\n      <tr>\n        <td class="time-cell">${hour}:00</td>`;

    for (const day of days) {
      const coursesAtSlot = courses.filter(c => c.day === day && c.hour === hour);

      if (coursesAtSlot.length === 0) {
        html += `\n        <td class="empty">-</td>`;
      } else {
        html += `\n        <td>`;
        for (const course of coursesAtSlot) {
          const isFull = course.numStudents === 4;
          const courseClass = isFull ? 'course full-course' : 'course';

          html += `\n          <div class="${courseClass}">`;
          html += `\n            <div class="course-header">${course.coach} (${course.numStudents}/${4})</div>`;

          for (const student of course.students) {
            const level = student.adult ? student.skillLevel : student.trainigGroup;
            const gender = student.adult ? (student.sex === 'männlich' ? 'M' : 'W') : '';
            html += `\n            <div class="student">${student.firstName} ${student.lastName} (${level}${gender ? ' ' + gender : ''})</div>`;
          }

          html += `\n          </div>`;
        }
        html += `\n        </td>`;
      }
    }

    html += `\n      </tr>`;
  }

  html += `
    </tbody>
  </table>

  ${planData.unassigned.length > 0 ? `
  <h2 style="margin-top: 40px;">Nicht zugewiesene Schüler (${planData.unassigned.length})</h2>
  <ul>
    ${planData.unassigned.map(s => {
      const level = s.adult ? s.skillLevel : s.trainigGroup;
      return `<li>${s.firstName} ${s.lastName} (${level}) - Verfügbare Zeiten: ${s.availableTimes.join(', ') || 'Keine'}</li>`;
    }).join('\n    ')}
  </ul>
  ` : ''}

</body>
</html>`;

  fs.writeFileSync(join(__dirname, filename), html);
  console.log(`✅ Exported ${filename}`);
}

function generateCSV(courses, filename, includeCourseDetails = true) {
  let csv = '';

  if (includeCourseDetails) {
    // Course-based CSV
    csv = 'Tag,Stunde,Trainer,Anzahl Schüler,Schüler\n';

    const sortedCourses = [...courses].sort((a, b) => {
      const dayDiff = days.indexOf(a.day) - days.indexOf(b.day);
      if (dayDiff !== 0) return dayDiff;
      return a.hour - b.hour;
    });

    for (const course of sortedCourses) {
      const studentNames = course.students
        .map(s => `${s.firstName} ${s.lastName} (${s.adult ? s.skillLevel : s.trainigGroup})`)
        .join('; ');

      csv += `${course.day},${course.hour},${course.coach},${course.numStudents},"${studentNames}"\n`;
    }
  } else {
    // Student-based CSV
    csv = 'Vorname,Nachname,Erwachsen,Level/Gruppe,Geschlecht,Tag,Stunde,Trainer\n';

    const allStudents = [];
    for (const course of courses) {
      for (const student of course.students) {
        allStudents.push({
          ...student,
          day: course.day,
          hour: course.hour,
          coach: course.coach
        });
      }
    }

    allStudents.sort((a, b) => a.lastName.localeCompare(b.lastName));

    for (const student of allStudents) {
      const level = student.adult ? student.skillLevel : student.trainigGroup;
      const gender = student.adult ? student.sex : '';
      csv += `${student.firstName},${student.lastName},${student.adult ? 'Ja' : 'Nein'},${level},${gender},${student.day},${student.hour},${student.coach}\n`;
    }
  }

  fs.writeFileSync(join(__dirname, filename), csv);
  console.log(`✅ Exported ${filename}`);
}

function generateJSON(courses, filename) {
  const data = {
    metadata: planData.metadata,
    courses: courses
  };
  fs.writeFileSync(join(__dirname, filename), JSON.stringify(data, null, 2));
  console.log(`✅ Exported ${filename}`);
}

// =============================================================================
// EXPORT ALL PLANS
// =============================================================================

console.log('📄 Exporting FULL plan (all students)...');
generateHTML(planData.courses, 'Optimaler Trainingsplan - Alle Schüler', 'correct-plan-full.html');
generateCSV(planData.courses, 'correct-plan-full-courses.csv', true);
generateCSV(planData.courses, 'correct-plan-full-students.csv', false);
generateJSON(planData.courses, 'correct-plan-full.json');

console.log('\n📄 Exporting ADULTS plan...');
const adultCourses = planData.courses
  .map(course => ({
    ...course,
    students: course.students.filter(s => s.adult)
  }))
  .filter(course => course.students.length > 0);

generateHTML(adultCourses, 'Optimaler Trainingsplan - Erwachsene', 'correct-plan-adults.html');
generateCSV(adultCourses, 'correct-plan-adults-courses.csv', true);
generateCSV(adultCourses, 'correct-plan-adults-students.csv', false);
generateJSON(adultCourses, 'correct-plan-adults.json');

console.log('\n📄 Exporting CHILDREN plan...');
const childrenCourses = planData.courses
  .map(course => ({
    ...course,
    students: course.students.filter(s => !s.adult)
  }))
  .filter(course => course.students.length > 0);

generateHTML(childrenCourses, 'Optimaler Trainingsplan - Kinder', 'correct-plan-children.html');
generateCSV(childrenCourses, 'correct-plan-children-courses.csv', true);
generateCSV(childrenCourses, 'correct-plan-children-students.csv', false);
generateJSON(childrenCourses, 'correct-plan-children.json');

console.log('\n🎉 Export complete!\n');
console.log('Files generated:');
console.log('  FULL: correct-plan-full.html, .csv (courses + students), .json');
console.log('  ADULTS: correct-plan-adults.html, .csv (courses + students), .json');
console.log('  CHILDREN: correct-plan-children.html, .csv (courses + students), .json');
