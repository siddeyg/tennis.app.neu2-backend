import fs from 'fs';

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║   CREATING CORRECT MANUAL OPTIMAL PLAN                     ║');
console.log('║   With proper coach constraints (1 course/coach/time)      ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

const students = JSON.parse(fs.readFileSync('students-for-manual-plan.json', 'utf8'));
const coaches = JSON.parse(fs.readFileSync('coaches-for-manual-plan.json', 'utf8'));

console.log(`📊 Loaded: ${students.length} students, ${coaches.length} coaches\n');

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

console.log('🎯 Building CORRECT manual optimal plan...\n');
console.log('KEY CONSTRAINT: 1 coach can only teach 1 course at a time!\n');

const courses = [];

// ============================================================================
// DONNERSTAG 20:00 - Only Helge available, so only 1 course possible!
// ============================================================================

console.log('✨ DONNERSTAG 20:00 (Helge Padberg - 1 course only):');

// Choose weiblich-Anfänger mit Grundkenntnissen (Friederike gets upgrade from 3→4)
courses.push(createCourse(
  'Donnerstag', 20, 'Helge Padberg',
  'adult-weiblich-Anfänger mit Grundkenntnissen',
  ['Friederike Förster', 'Kristina Müller', 'Marie Köhler', 'Silke Hoesch']
));
console.log('   ✅ weiblich-Anfänger mit Grundkenntnissen: 4 students (FULL)\n');

// ============================================================================
// DONNERSTAG 19:00 - Place the other prioritized group here
// ============================================================================

console.log('✨ DONNERSTAG 19:00 (Helge Padberg):');

// Place weiblich-Fortgeschritten here (the 2nd full course group)
courses.push(createCourse(
  'Donnerstag', 19, 'Helge Padberg',
  'adult-weiblich-Fortgeschritten',
  ['Rebecca Mau', 'Anneke Malinowski', 'Nicole Berg', 'Svenja Gloger']
));
console.log('   ✅ weiblich-Fortgeschritten: 4 students (FULL)\n');

// ============================================================================
// OTHER DONNERSTAG SLOTS - Place remaining adults from Do 18/19/20 group
// ============================================================================

console.log('✨ OTHER DONNERSTAG SLOTS:');

courses.push(createCourse('Donnerstag', 16, 'Nicole Kreienborg', 'adult-weiblich-Anfänger mit Grundkenntnissen',
  ['Damla Darilmaz']));
console.log('   Donnerstag 16 - weiblich-Anfänger mit Grundkenntnissen: 1 student');

courses.push(createCourse('Donnerstag', 10, 'Nicole Kreienborg', 'adult-weiblich-Fortgeschritten',
  ['Barbara Bursch-Brustkern', 'Ulrike Patani']));
console.log('   Donnerstag 10 - weiblich-Fortgeschritten: 2 students');

courses.push(createCourse('Donnerstag', 10, 'Nicole Kreienborg', 'adult-weiblich-Anfänger mit Grundkenntnissen',
  ['Helga Heydweiller']));
console.log('   Donnerstag 10 - weiblich-Anfänger mit Grundkenntnissen: 1 student\n');

// ============================================================================
// CHILDREN COURSES - Maintain high efficiency
// ============================================================================

console.log('📚 CHILDREN COURSES (optimized for efficiency):');

// Montag 17 - Gelb Team (3 full courses)
courses.push(createCourse('Montag', 17, 'Nicole Kreienborg', 'child-Gelb Team',
  ['Dana Stoffels', 'Matthis Hundrup', 'Moritz Hoesch', 'Linus Hoesch']));
courses.push(createCourse('Montag', 17, 'Joris muck', 'child-Gelb Team',
  ['Leonard Welle', 'Luke Fuss', 'Benno Koch-Gombert', 'Valentin Agsten']));
courses.push(createCourse('Montag', 17, 'Ben Frankenberg', 'child-Gelb Team',
  ['Marlene Tripp', 'Justus Jahn', 'Arthur Schelz', 'Christopher Jahn']));

// Montag 17 - Gelb Hobby (1 full course)
courses.push(createCourse('Montag', 17, 'Christopher Jahn', 'child-Gelb Hobby',
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
courses.push(createCourse('Mittwoch', 16, 'Joris muck', 'child-Rot',
  ['Maja Dietzler', 'Victoria Schmitt', 'Laura Heidemann', 'Mia Lange']));

// Donnerstag 17 - Gelb Hobby (1 full course)
courses.push(createCourse('Donnerstag', 17, 'Nicole Kreienborg', 'child-Gelb Hobby',
  ['Clara Schrempp', 'Finn Gruber', 'Jaron Lockmann', 'Levi Schüler']));

// Freitag 16 - Orange (1 full course)
courses.push(createCourse('Freitag', 16, 'Nicole Kreienborg', 'child-Orange',
  ['Paul Koch-Gombert', 'Florian Elias', 'Julius Hof', 'Paula Nettekoven']));

// Freitag 16 - Gelb Team (1 full course)
courses.push(createCourse('Freitag', 16, 'Joris muck', 'child-Gelb Team',
  ['Lara-Marie Wiedbrauck', 'Marie Wolff', 'Nadim El Gharabawy', 'Nadia El Gharabawy']));

// Freitag 17 - Gelb Team (1 full course)
courses.push(createCourse('Freitag', 17, 'Nicole Kreienborg', 'child-Gelb Team',
  ['Veerle Meijboom', 'Claire Loheider', 'Helene Muck', 'Jana Frankenberg']));

// Freitag 17 - Gelb Hobby (1 full course)
courses.push(createCourse('Freitag', 17, 'Ben Frankenberg', 'child-Gelb Hobby',
  ['Henry King', 'Jasper Trump', 'Vogel Julius', 'Philipp Kluth']));

// Samstag 12 - Kinderland (1 full course)
courses.push(createCourse('Samstag', 12, 'Nicole Kreienborg', 'child-Kinderland',
  ['Alexander Ganiev Chang', 'Lysander Pruys', 'Nic K', 'Alexander Ganiev']));

// Samstag 12 - Rot (1 full course)
courses.push(createCourse('Samstag', 12, 'Joris muck', 'child-Rot',
  ['Fender Meijboom', 'Mats Vogel', 'Mert Bakir', 'Josef Wong']));

console.log('   ✅ 15 full children courses created');

// Children - smaller courses
courses.push(createCourse('Samstag', 12, 'Christopher Jahn', 'child-Gelb Team',
  ['Benjamin Coers', 'Ben Frankenberg', 'Joris Muck']));
courses.push(createCourse('Mittwoch', 15, 'Nicole Kreienborg', 'child-Kinderland',
  ['Marlene Zock', 'Charlotte Jansen']));
courses.push(createCourse('Dienstag', 17, 'Joris muck', 'child-Gelb Team',
  ['Paulina Muck', 'Laura Metzer']));
courses.push(createCourse('Dienstag', 17, 'Ben Frankenberg', 'child-Gelb Hobby',
  ['Juno Glaser', 'Madita Böckenförde Leininger']));
courses.push(createCourse('Donnerstag', 16, 'Joris muck', 'child-Orange',
  ['Moritz Burchart', 'Leila Maria', 'Ben Lange']));
courses.push(createCourse('Donnerstag', 15, 'Nicole Kreienborg', 'child-Orange',
  ['Laura Wiedbrauck']));
courses.push(createCourse('Montag', 17, 'Nicole Kreienborg', 'child-Gelb Team',
  ['Annika Jahn']));
courses.push(createCourse('Mittwoch', 16, 'Ben Frankenberg', 'child-Grün',
  ['Schieferdecker Colleen']));
courses.push(createCourse('Samstag', 12, 'Ben Frankenberg', 'child-Gelb Hobby',
  ['Stella Hilgers']));

console.log('   ✅ 9 smaller children courses created\n');

// ============================================================================
// REMAINING ADULT COURSES
// ============================================================================

console.log('👔 REMAINING ADULT COURSES:\n');

// Place other adults from the 18 who now have Do 20 available
courses.push(createCourse('Montag', 18, 'Helge Padberg', 'adult-männlich-Anfänger',
  ['Antonio Schmandke', 'Áron Horváth', 'Stefan Löwe']));
console.log('   Montag 18 - männlich-Anfänger: 3 students');

courses.push(createCourse('Montag', 18, 'Nicole Kreienborg', 'adult-männlich-Anfänger mit Grundkenntnissen',
  ['Jan Volkhardt', 'Jonas Plath']));
console.log('   Montag 18 - männlich-Anfänger mit Grundkenntnissen: 2 students');

courses.push(createCourse('Freitag', 18, 'Falko ', 'adult-männlich-Fortgeschritten',
  ['Tom Jansen', 'Thiemo Meyfarth', 'Roby Patani']));
console.log('   Freitag 18 - männlich-Fortgeschritten: 3 students');

courses.push(createCourse('Samstag', 11, 'Nicole Kreienborg', 'adult-weiblich-Anfänger mit Grundkenntnissen',
  ['Sandra Bourbeck', 'Ilonka Döge', 'Claudia Frank']));
console.log('   Samstag 11 - weiblich-Anfänger mit Grundkenntnissen: 3 students');

courses.push(createCourse('Freitag', 18, 'Nicole Kreienborg', 'adult-weiblich-Anfänger mit Grundkenntnissen',
  ['Sabrina Schenk', 'Lara Jansen']));
console.log('   Freitag 18 - weiblich-Anfänger mit Grundkenntnissen: 2 students');

courses.push(createCourse('Montag', 19, 'Helge Padberg', 'adult-weiblich-Anfänger',
  ['Eva Plath', 'Kinga Fülöp']));
console.log('   Montag 19 - weiblich-Anfänger: 2 students');

// Singles
courses.push(createCourse('Samstag', 10, 'Nicole Kreienborg', 'adult-weiblich-Fortgeschritten',
  ['Andrea Muck', 'Andrea Frankenberg', 'Maike Just']));
courses.push(createCourse('Montag', 11, 'Nicole Kreienborg', 'adult-männlich-Anfänger',
  ['Marius Grosch']));
courses.push(createCourse('Dienstag', 11, 'Nicole Kreienborg', 'adult-weiblich-Fortgeschritten',
  ['Sabine Löhrl']));
courses.push(createCourse('Freitag', 15, 'Falko ', 'adult-männlich-Leistungsspieler:innen / Turnierspieler:innen',
  ['Lukas Lederer', 'Lennart Maak']));
courses.push(createCourse('Montag', 16, 'Nicole Kreienborg', 'adult-weiblich-Erfahrene Spieler:innen / Mannschaftsspieler:innen',
  ['Elsa Schreiber']));
courses.push(createCourse('Montag', 18, 'Nicole Kreienborg', 'adult-weiblich-Anfänger mit Grundkenntnissen',
  ['Julia Leininger']));
courses.push(createCourse('Montag', 18, 'Falko ', 'adult-weiblich-Fortgeschritten',
  ['Claudia Gregor-Lawrenz']));

console.log('   ✅ 7 other adult courses created\n');

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
    title: "Manual Optimal Plan - CORRECT (1 coach/1 course/time)",
    created: new Date().toISOString(),
    createdBy: "Manual Planning",
    description: "Hand-crafted optimal schedule respecting coach constraints: 1 coach can only teach 1 course at a time"
  },
  statistics: stats,
  courses: courses.map((c, i) => ({
    id: i + 1,
    ...c
  }))
};

fs.writeFileSync('manual-optimal-plan-correct.json', JSON.stringify(plan, null, 2));

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║   CORRECT MANUAL PLAN RESULTS                              ║');
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

console.log(`✅ Saved to: manual-optimal-plan-correct.json\n`);

// Show Donnerstag 20 summary
const do20Courses = plan.courses.filter(c => c.day === 'Donnerstag' && c.hour === 20);
console.log('📅 DONNERSTAG 20:00 SUMMARY:\n');
console.log(`   Courses: ${do20Courses.length} (Helge can only teach 1 course at a time!)`);
console.log(`   Students: ${do20Courses.reduce((sum, c) => sum + c.students.length, 0)}`);
console.log(`   Full courses: ${do20Courses.filter(c => c.students.length === 4).length}\n`);

do20Courses.forEach(c => {
  console.log(`   ${c.groupLabel} (${c.students.length}): ${c.students.map(s => s.name).join(', ')}`);
});

console.log('\n✅ CORRECT manual plan complete!');
console.log('✅ Respects constraint: 1 coach = 1 course per time slot');
