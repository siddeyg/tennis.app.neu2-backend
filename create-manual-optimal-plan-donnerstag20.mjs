import fs from 'fs';

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║   CREATING MANUAL OPTIMAL PLAN - DONNERSTAG 20 FOCUS      ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

const students = JSON.parse(fs.readFileSync('students-for-manual-plan.json', 'utf8'));
const coaches = JSON.parse(fs.readFileSync('coaches-for-manual-plan.json', 'utf8'));

console.log(`📊 Loaded: ${students.length} students, ${coaches.length} coaches\n`);

// Helper to find student by name
const findStudent = (firstName, lastName) => {
  return students.find(s => s.firstName === firstName && s.lastName === lastName);
};

// Helper to create course entry
const createCourse = (day, hour, coach, groupLabel, studentNames) => {
  const studentObjs = studentNames.map(name => {
    const [first, ...lastParts] = name.split(' ');
    const last = lastParts.join(' ');
    const s = findStudent(first, last);
    if (!s) {
      console.warn(`⚠️  Student not found: ${name}`);
      return null;
    }
    return {
      id: String(s._id),
      firstName: s.firstName,
      lastName: s.lastName,
      name: `${s.firstName} ${s.lastName}`,
      gender: s.sex || 'unknown',
      level: s.adult ? (s.skillLevel || 'unknown') : (s.trainigGroup || 'unknown'),
      adult: s.adult || false
    };
  }).filter(s => s !== null);

  return {
    day,
    hour,
    groupLabel,
    coach,
    students: studentObjs
  };
};

console.log('🎯 Building manual optimal plan based on DONNERSTAG_20_RECOMMENDATION.md...\n');

const courses = [];

// ============================================================================
// DONNERSTAG 20:00 - THE MAIN FOCUS (Per recommendation)
// ============================================================================

console.log('✨ DONNERSTAG 20:00 (Priority from recommendation):');

courses.push(createCourse(
  'Donnerstag', 20, 'Helge Padberg',
  'adult-weiblich-Anfänger mit Grundkenntnissen',
  ['Friederike Förster', 'Kristina Müller', 'Marie Köhler', 'Silke Hoesch']
));
console.log('   ✅ weiblich-Anfänger mit Grundkenntnissen: 4 students (FULL)');

courses.push(createCourse(
  'Donnerstag', 20, 'Helge Padberg',
  'adult-weiblich-Fortgeschritten',
  ['Rebecca Mau', 'Anneke Malinowski', 'Nicole Berg', 'Svenja Gloger']
));
console.log('   ✅ weiblich-Fortgeschritten: 4 students (FULL)');

courses.push(createCourse(
  'Donnerstag', 20, 'Helge Padberg',
  'adult-männlich-Anfänger',
  ['Antonio Schmandke', 'Áron Horváth', 'Stefan Löwe']
));
console.log('   ✅ männlich-Anfänger: 3 students');

courses.push(createCourse(
  'Donnerstag', 20, 'Helge Padberg',
  'adult-männlich-Anfänger mit Grundkenntnissen',
  ['Jan Volkhardt', 'Jonas Plath']
));
console.log('   ✅ männlich-Anfänger mit Grundkenntnissen: 2 students');

courses.push(createCourse(
  'Donnerstag', 20, 'Helge Padberg',
  'adult-weiblich-Anfänger',
  ['Eva Plath', 'Kinga Fülöp']
));
console.log('   ✅ weiblich-Anfänger: 2 students');

courses.push(createCourse(
  'Donnerstag', 20, 'Helge Padberg',
  'adult-männlich-Fortgeschritten',
  ['Thiemo Meyfarth', 'Roby Patani']
));
console.log('   ✅ männlich-Fortgeschritten: 2 students');

courses.push(createCourse(
  'Donnerstag', 20, 'Helge Padberg',
  'adult-männlich-Leistungsspieler:innen / Turnierspieler:innen',
  ['Lennart Maak']
));
console.log('   ✅ männlich-Leistungsspieler:innen: 1 student');

console.log('\n✨ Total at Donnerstag 20: 7 courses, 18 students\n');

// ============================================================================
// CHILDREN COURSES - Maintain high efficiency from perfect plan
// ============================================================================

console.log('📚 CHILDREN COURSES (based on perfect plan optimization):');

// Montag 17 - Gelb Team (3 full courses)
courses.push(createCourse('Montag', 17, 'Nicole Kreienborg', 'child-Gelb Team',
  ['Dana Stoffels', 'Matthis Hundrup', 'Moritz Hoesch', 'Linus Hoesch']));
courses.push(createCourse('Montag', 17, 'Nicole Kreienborg', 'child-Gelb Team',
  ['Leonard Welle', 'Luke Fuss', 'Benno Koch-Gombert', 'Valentin Agsten']));
courses.push(createCourse('Montag', 17, 'Nicole Kreienborg', 'child-Gelb Team',
  ['Marlene Tripp', 'Justus Jahn', 'Arthur Schelz', 'Christopher Jahn']));

// Montag 17 - Gelb Hobby (1 full course)
courses.push(createCourse('Montag', 17, 'Nicole Kreienborg', 'child-Gelb Hobby',
  ['Leni Doutch', 'Johannes Küster', 'Elin Küster', 'Frida Schulmann']));

// Montag 16 - Grün (1 full course)
courses.push(createCourse('Montag', 16, 'Nicole Kreienborg', 'child-Grün',
  ['Clara Malinowski', 'Emilia Burchart', 'Malou Brieger', 'Lenna Wolff']));

// Dienstag 16 - Grün (1 full course)
courses.push(createCourse('Dienstag', 16, 'Nicole Kreienborg', 'child-Grün',
  ['Clara Schmitz-Hübsch', 'Jolin Kunsch', 'Gruber Ella', 'Vincent Schrade']));

// Mittwoch 16 - Orange (1 full course)
courses.push(createCourse('Mittwoch', 16, 'Nicole Kreienborg', 'child-Orange',
  ['Florian Elias Andrä', 'Henrik Hoesch', 'Liam Döring', 'Maja Schrempp']));

// Mittwoch 16 - Rot (1 full course)
courses.push(createCourse('Mittwoch', 16, 'Nicole Kreienborg', 'child-Rot',
  ['Maja Dietzler', 'Victoria Schmitt', 'Laura Heidemann', 'Mia Lange']));

// Donnerstag 17 - Gelb Hobby (1 full course)
courses.push(createCourse('Donnerstag', 17, 'Nicole Kreienborg', 'child-Gelb Hobby',
  ['Clara Schrempp', 'Finn Gruber', 'Jaron Lockmann', 'Levi Schüler']));

// Freitag 16 - Orange (1 full course)
courses.push(createCourse('Freitag', 16, 'Nicole Kreienborg', 'child-Orange',
  ['Paul Koch-Gombert', 'Florian Elias', 'Julius Hof', 'Paula Nettekoven']));

// Freitag 16 - Gelb Team (1 full course)
courses.push(createCourse('Freitag', 16, 'Nicole Kreienborg', 'child-Gelb Team',
  ['Lara-Marie Wiedbrauck', 'Marie Wolff', 'Nadim El Gharabawy', 'Nadia El Gharabawy']));

// Freitag 17 - Gelb Team (1 full course)
courses.push(createCourse('Freitag', 17, 'Nicole Kreienborg', 'child-Gelb Team',
  ['Veerle Meijboom', 'Claire Loheider', 'Helene Muck', 'Jana Frankenberg']));

// Freitag 17 - Gelb Hobby (1 full course)
courses.push(createCourse('Freitag', 17, 'Nicole Kreienborg', 'child-Gelb Hobby',
  ['Henry King', 'Jasper Trump', 'Vogel Julius', 'Philipp Kluth']));

// Samstag 12 - Kinderland (1 full course)
courses.push(createCourse('Samstag', 12, 'Nicole Kreienborg', 'child-Kinderland',
  ['Alexander Ganiev Chang', 'Lysander Pruys', 'Nic K', 'Alexander Ganiev']));

// Samstag 12 - Rot (1 full course)
courses.push(createCourse('Samstag', 12, 'Nicole Kreienborg', 'child-Rot',
  ['Fender Meijboom', 'Mats Vogel', 'Mert Bakir', 'Josef Wong']));

console.log('   ✅ 15 full children courses created');

// Children - smaller courses
courses.push(createCourse('Samstag', 12, 'Nicole Kreienborg', 'child-Gelb Team',
  ['Benjamin Coers', 'Ben Frankenberg', 'Joris Muck']));
courses.push(createCourse('Mittwoch', 15, 'Nicole Kreienborg', 'child-Kinderland',
  ['Marlene Zock', 'Charlotte Jansen']));
courses.push(createCourse('Dienstag', 17, 'Nicole Kreienborg', 'child-Gelb Team',
  ['Paulina Muck', 'Laura Metzer']));
courses.push(createCourse('Dienstag', 17, 'Nicole Kreienborg', 'child-Gelb Hobby',
  ['Juno Glaser', 'Madita Böckenförde Leininger']));
courses.push(createCourse('Donnerstag', 16, 'Nicole Kreienborg', 'child-Orange',
  ['Moritz Burchart', 'Leila Maria', 'Ben Lange']));
courses.push(createCourse('Donnerstag', 15, 'Nicole Kreienborg', 'child-Orange',
  ['Laura Wiedbrauck']));
courses.push(createCourse('Montag', 17, 'Nicole Kreienborg', 'child-Gelb Team',
  ['Annika Jahn']));
courses.push(createCourse('Mittwoch', 16, 'Nicole Kreienborg', 'child-Grün',
  ['Schieferdecker Colleen']));
courses.push(createCourse('Samstag', 12, 'Nicole Kreienborg', 'child-Gelb Hobby',
  ['Stella Hilgers']));

console.log('   ✅ 9 smaller children courses created\n');

// ============================================================================
// REMAINING ADULT COURSES
// ============================================================================

console.log('👔 REMAINING ADULT COURSES:\n');

// Samstag 11 - weiblich-Anfänger mit Grundkenntnissen (MODIFIED - removed students at Do 20)
courses.push(createCourse('Samstag', 11, 'Nicole Kreienborg', 'adult-weiblich-Anfänger mit Grundkenntnissen',
  ['Sandra Bourbeck', 'Ilonka Döge', 'Claudia Frank']));
console.log('   Samstag 11 - weiblich-Anfänger mit Grundkenntnissen: 3 students');

// Freitag 18 - weiblich-Anfänger mit Grundkenntnissen (MODIFIED - removed students at Do 20)
courses.push(createCourse('Freitag', 18, 'Falko', 'adult-weiblich-Anfänger mit Grundkenntnissen',
  ['Sabrina Schenk', 'Lara Jansen']));
console.log('   Freitag 18 - weiblich-Anfänger mit Grundkenntnissen: 2 students');

// Freitag 18 - männlich-Fortgeschritten (now has space)
courses.push(createCourse('Freitag', 18, 'Falko', 'adult-männlich-Fortgeschritten',
  ['Tom Jansen']));
console.log('   Freitag 18 - männlich-Fortgeschritten: 1 student');

// Donnerstag 16 - weiblich-Anfänger mit Grundkenntnissen (now has space)
courses.push(createCourse('Donnerstag', 16, 'Nicole Kreienborg', 'adult-weiblich-Anfänger mit Grundkenntnissen',
  ['Damla Darilmaz']));
console.log('   Donnerstag 16 - weiblich-Anfänger mit Grundkenntnissen: 1 student');

// Other adult singles/pairs
courses.push(createCourse('Donnerstag', 10, 'Nicole Kreienborg', 'adult-weiblich-Fortgeschritten',
  ['Barbara Bursch-Brustkern', 'Ulrike Patani']));
courses.push(createCourse('Donnerstag', 10, 'Nicole Kreienborg', 'adult-weiblich-Anfänger mit Grundkenntnissen',
  ['Helga Heydweiller']));
courses.push(createCourse('Samstag', 10, 'Nicole Kreienborg', 'adult-weiblich-Fortgeschritten',
  ['Andrea Muck', 'Andrea Frankenberg', 'Maike Just']));
courses.push(createCourse('Montag', 11, 'Nicole Kreienborg', 'adult-männlich-Anfänger',
  ['Marius Grosch']));
courses.push(createCourse('Dienstag', 11, 'Nicole Kreienborg', 'adult-weiblich-Fortgeschritten',
  ['Sabine Löhrl']));
courses.push(createCourse('Freitag', 15, 'Falko', 'adult-männlich-Leistungsspieler:innen / Turnierspieler:innen',
  ['Lukas Lederer']));
courses.push(createCourse('Montag', 16, 'Nicole Kreienborg', 'adult-weiblich-Erfahrene Spieler:innen / Mannschaftsspieler:innen',
  ['Elsa Schreiber']));
courses.push(createCourse('Montag', 18, 'Nicole Kreienborg', 'adult-weiblich-Anfänger mit Grundkenntnissen',
  ['Julia Leininger']));
courses.push(createCourse('Montag', 18, 'Nicole Kreienborg', 'adult-weiblich-Fortgeschritten',
  ['Claudia Gregor-Lawrenz']));

console.log('   ✅ 9 other adult courses created\n');

// ============================================================================
// Calculate statistics
// ============================================================================

const stats = {
  totalCourses: courses.length,
  course4: courses.filter(c => c.students.length === 4).length,
  course3: courses.filter(c => c.students.length === 3).length,
  course2: courses.filter(c => c.students.length === 2).length,
  course1: courses.filter(c => c.students.length === 1).length,
  assigned: courses.reduce((sum, c) => sum + c.students.length, 0),
  unassigned: students.length - courses.reduce((sum, c) => sum + c.students.length, 0),
  adultCourses: courses.filter(c => c.groupLabel.startsWith('adult-')).length,
  childCourses: courses.filter(c => c.groupLabel.startsWith('child-')).length
};

const efficiency = ((stats.course3 + stats.course4) / stats.totalCourses * 100).toFixed(1);

// ============================================================================
// Save plan
// ============================================================================

const plan = {
  metadata: {
    title: "Manual Optimal Plan - Donnerstag 20:00 Focus",
    created: new Date().toISOString(),
    createdBy: "Manual Planning",
    description: "Hand-crafted optimal schedule with Donnerstag 20:00 for 18 adults (based on DONNERSTAG_20_RECOMMENDATION.md)"
  },
  statistics: stats,
  courses: courses.map((c, i) => ({
    id: i + 1,
    ...c
  }))
};

fs.writeFileSync('manual-optimal-donnerstag20.json', JSON.stringify(plan, null, 2));

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║   MANUAL PLAN RESULTS                                      ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

console.log('📊 STATISTICS:\n');
console.log(`   Total Students: ${students.length}`);
console.log(`   Assigned: ${stats.assigned}`);
console.log(`   Unassigned: ${stats.unassigned}\n`);

console.log(`   Total Courses: ${stats.totalCourses}\n`);
console.log(`   4 students: ${stats.course4} courses (${(stats.course4 / stats.totalCourses * 100).toFixed(1)}%) ⭐`);
console.log(`   3 students: ${stats.course3} courses (${(stats.course3 / stats.totalCourses * 100).toFixed(1)}%)`);
console.log(`   2 students: ${stats.course2} courses (${(stats.course2 / stats.totalCourses * 100).toFixed(1)}%)`);
console.log(`   1 student:  ${stats.course1} courses (${(stats.course1 / stats.totalCourses * 100).toFixed(1)}%)\n`);

console.log(`   Efficiency: ${efficiency}% courses are 3-4 students\n`);

console.log(`   Adult Courses: ${stats.adultCourses}`);
console.log(`   Child Courses: ${stats.childCourses}\n`);

console.log(`✅ Saved to: manual-optimal-donnerstag20.json\n`);

// Show Donnerstag 20 summary
const do20Courses = plan.courses.filter(c => c.day === 'Donnerstag' && c.hour === 20);
console.log('📅 DONNERSTAG 20:00 SUMMARY:\n');
console.log(`   Courses: ${do20Courses.length}`);
console.log(`   Students: ${do20Courses.reduce((sum, c) => sum + c.students.length, 0)}`);
console.log(`   Full courses: ${do20Courses.filter(c => c.students.length === 4).length}\n`);

do20Courses.forEach(c => {
  console.log(`   ${c.groupLabel} (${c.students.length}): ${c.students.map(s => s.name).join(', ')}`);
});

console.log('\n✅ Manual plan complete!');
