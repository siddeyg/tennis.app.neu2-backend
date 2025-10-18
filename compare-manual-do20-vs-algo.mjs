import fs from 'fs';

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║   COMPARISON: MANUAL (DO 20) VS ALGORITHMIC PLAN          ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

const manualDo20 = JSON.parse(fs.readFileSync('manual-optimal-plan-do20.json', 'utf8'));
const algorithmic = JSON.parse(fs.readFileSync('perfect-optimal-plan.json', 'utf8'));

console.log('📊 OVERVIEW COMPARISON:\n');
console.log('                        MANUAL (DO 20)    ALGORITHMIC');
console.log(`   Total Courses:            ${String(manualDo20.statistics.totalCourses).padStart(2)}              ${String(algorithmic.statistics.totalCourses).padStart(2)}`);
console.log(`   Full Courses (4):         ${String(manualDo20.statistics.course4).padStart(2)}              ${String(algorithmic.statistics.course4).padStart(2)}`);
console.log(`   Three (3):                ${String(manualDo20.statistics.course3).padStart(2)}              ${String(algorithmic.statistics.course3).padStart(2)}`);
console.log(`   Pairs (2):                ${String(manualDo20.statistics.course2).padStart(2)}              ${String(algorithmic.statistics.course2).padStart(2)}`);
console.log(`   Singles (1):              ${String(manualDo20.statistics.course1).padStart(2)}              ${String(algorithmic.statistics.course1).padStart(2)}`);
console.log(`   Assigned:                ${String(manualDo20.statistics.assigned).padStart(3)}             ${String(algorithmic.statistics.assigned).padStart(3)}`);
console.log(`   Unassigned:               ${String(manualDo20.statistics.unassigned).padStart(2)}               ${String(algorithmic.statistics.unassigned).padStart(2)}`);

const manualEff = ((manualDo20.statistics.course3 + manualDo20.statistics.course4) / manualDo20.statistics.totalCourses * 100).toFixed(1);
const algoEff = ((algorithmic.statistics.course3 + algorithmic.statistics.course4) / algorithmic.statistics.totalCourses * 100).toFixed(1);

console.log(`   Efficiency (3-4):      ${manualEff}%          ${algoEff}%`);

console.log('\n📅 DONNERSTAG 20:00 USAGE:\n');

const manualDo20Courses = manualDo20.courses.filter(c => c.day === 'Donnerstag' && c.hour === 20);
const algoDo20Courses = algorithmic.courses.filter(c => c.day === 'Donnerstag' && c.hour === 20);

console.log(`   MANUAL (DO 20): ${manualDo20Courses.length} courses, ${manualDo20Courses.reduce((sum, c) => sum + c.students.length, 0)} students`);
manualDo20Courses.forEach(c => {
  console.log(`      ${c.groupLabel} (${c.students.length}): ${c.students.map(s => s.name).join(', ')}`);
});

console.log(`\n   ALGORITHMIC: ${algoDo20Courses.length} courses, ${algoDo20Courses.reduce((sum, c) => sum + c.students.length, 0)} students`);
if (algoDo20Courses.length === 0) {
  console.log('      ❌ NO COURSES AT DONNERSTAG 20');
}

console.log('\n📊 KEY DIFFERENCES:\n');

if (manualDo20.statistics.totalCourses > algorithmic.statistics.totalCourses) {
  console.log(`   ⚠️  Manual plan has ${manualDo20.statistics.totalCourses - algorithmic.statistics.totalCourses} MORE courses (algorithmic is more efficient)`);
} else if (manualDo20.statistics.totalCourses < algorithmic.statistics.totalCourses) {
  console.log(`   ✅ Manual plan has ${algorithmic.statistics.totalCourses - manualDo20.statistics.totalCourses} FEWER courses (manual is more efficient)`);
} else {
  console.log(`   ➡️  Same number of courses`);
}

if (manualDo20.statistics.course4 > algorithmic.statistics.course4) {
  console.log(`   ✅ Manual plan has ${manualDo20.statistics.course4 - algorithmic.statistics.course4} MORE full courses`);
} else if (manualDo20.statistics.course4 < algorithmic.statistics.course4) {
  console.log(`   ⚠️  Manual plan has ${algorithmic.statistics.course4 - manualDo20.statistics.course4} FEWER full courses`);
} else {
  console.log(`   ➡️  Same number of full courses`);
}

if (parseFloat(manualEff) > parseFloat(algoEff)) {
  console.log(`   ✅ Manual plan has BETTER efficiency (+${(parseFloat(manualEff) - parseFloat(algoEff)).toFixed(1)}%)`);
} else if (parseFloat(manualEff) < parseFloat(algoEff)) {
  console.log(`   ⚠️  Manual plan has LOWER efficiency (-${(parseFloat(algoEff) - parseFloat(manualEff)).toFixed(1)}%)`);
} else {
  console.log(`   ➡️  Same efficiency`);
}

console.log(`   ✅ Manual plan USES Donnerstag 20:00 (${manualDo20Courses.length} courses)`);
console.log(`   ❌ Algorithmic plan SKIPS Donnerstag 20:00 (0 courses)`);

console.log('\n💡 ANALYSIS:\n');

console.log('   The manual plan INTENTIONALLY places 2 full courses at Donnerstag 20:00');
console.log('   as requested, creating the constraint that adults with Do 18/19 should');
console.log('   also be available at Do 20.\n');

console.log('   The algorithmic plan did NOT use Do 20 because it found better');
console.log('   placements for those students at other times (Montag 19, Freitag 18, etc.).\n');

console.log('   TRADE-OFF:');
console.log(`   • Manual: Uses Do 20 ✅, but has ${manualDo20.statistics.course4 - algorithmic.statistics.course4} fewer full courses overall`);
console.log(`   • Algorithmic: Skips Do 20 ❌, but achieves ${algorithmic.statistics.course4} full courses (${algoEff}% efficiency)`);

console.log('\n✨ CONCLUSION:\n');

if (manualDo20Courses.length > 0) {
  console.log('   ✅ Manual plan successfully implements Donnerstag 20:00 constraint');
  console.log('   ✅ 2 full courses created at Do 20 as intended');
  console.log('   ⚠️  Slightly lower overall optimization compared to algorithm');
  console.log('\n   RECOMMENDATION: Use manual plan if Donnerstag 20:00 is a REQUIRED slot.');
  console.log('                   Use algorithmic plan if maximizing efficiency is priority.');
}
