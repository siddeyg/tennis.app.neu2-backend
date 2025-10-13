import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config({path:'./.env.development'});
await mongoose.connect(process.env.MONGO_URI||'mongodb://localhost:27017/tennis-coach');

const SavedSchedule = mongoose.model('SavedSchedule', new mongoose.Schema({}, {strict: false}), 'savedschedules');
const Student = mongoose.model('Student', new mongoose.Schema({}, {strict: false}), 'students');

// Get system-generated optimal plan
const optimalPlan = await SavedSchedule.findOne({createdBy: 'system'}).sort({createdAt: -1}).lean();

// Get user-generated plan (last one not by system)
const userPlan = await SavedSchedule.findOne({createdBy: {$ne: 'system'}}).sort({createdAt: -1}).lean();

// Get current database state
const currentStudents = await Student.find({}).lean();
const currentCourses = {};
currentStudents.filter(s => s.day && s.hour).forEach(s => {
  const key = `${s.day} ${s.hour}`;
  if (!currentCourses[key]) currentCourses[key] = [];
  currentCourses[key].push(s);
});

console.log('\n╔════════════════════════════════════════════════════════════════════╗');
console.log('║         PLAN COMPARISON: CODE ALGORITHM vs MANUAL OPTIMAL          ║');
console.log('╚════════════════════════════════════════════════════════════════════╝\n');

const analyzePlan = (name, students, schedule) => {
  const sizes = {1:0, 2:0, 3:0, 4:0};
  let mixedSkill = 0, mixedGroup = 0, mixedAdultChild = 0;

  schedule.forEach(course => {
    const courseStudents = students.filter(s =>
      course.students.includes(s._id) || course.students.some(sid => String(sid) === String(s._id))
    );
    const sz = Math.min(courseStudents.length, 4);
    if (sz > 0) sizes[sz]++;

    const hasAdults = courseStudents.some(s => s.adult);
    const hasChildren = courseStudents.some(s => !s.adult);
    const skills = [...new Set(courseStudents.filter(s => s.adult).map(s => s.skillLevel).filter(Boolean))];
    const groups = [...new Set(courseStudents.filter(s => !s.adult).map(s => s.trainigGroup).filter(Boolean))];

    if (hasAdults && hasChildren) mixedAdultChild++;
    else if (skills.length > 1) mixedSkill++;
    else if (groups.length > 1) mixedGroup++;
  });

  const totalMixed = mixedSkill + mixedGroup + mixedAdultChild;
  const efficient = sizes[3] + sizes[4];
  const inefficient = sizes[1] + sizes[2];
  const efficiencyScore = ((sizes[4]*100 + sizes[3]*75 + sizes[2]*50 + sizes[1]*25) / schedule.length).toFixed(1);
  const mixingPenalty = totalMixed * 5;
  const overallScore = Math.max(0, parseFloat(efficiencyScore) - mixingPenalty).toFixed(1);

  return {
    name,
    totalStudents: students.length,
    totalCourses: schedule.length,
    sizes,
    mixedSkill,
    mixedGroup,
    mixedAdultChild,
    totalMixed,
    efficient,
    inefficient,
    efficiencyScore,
    mixingPenalty,
    overallScore
  };
};

// Analyze current database state
const currentSchedule = Object.entries(currentCourses).map(([time, students]) => {
  const [day, hour] = time.split(' ');
  return {
    day,
    hour: parseInt(hour),
    students: students.map(s => s._id)
  };
});

const current = analyzePlan('CURRENT DATABASE (Code Algorithm)', currentStudents, currentSchedule);
const optimal = optimalPlan ? analyzePlan('OPTIMAL (Manual)', optimalPlan.students, optimalPlan.schedule) : null;
const user = userPlan ? analyzePlan('USER SAVED', userPlan.students, userPlan.schedule) : null;

// Display comparison table
console.log('═══════════════════════════════════════════════════════════════════════\n');

const printMetric = (label, currentVal, optimalVal, highlight = false) => {
  const currentStr = String(currentVal).padEnd(15);
  const optimalStr = optimalVal !== null ? String(optimalVal).padEnd(15) : 'N/A'.padEnd(15);
  const symbol = highlight ? (parseFloat(optimalVal) < parseFloat(currentVal) ? '✅' : '❌') : ' ';
  console.log(`${label.padEnd(30)} ${currentStr} ${optimalStr} ${symbol}`);
};

console.log('METRIC'.padEnd(30) + ' CODE ALGORITHM'.padEnd(16) + ' MANUAL OPTIMAL'.padEnd(16) + '\n');
console.log('─'.repeat(70));

printMetric('Total Students', current.totalStudents, optimal?.totalStudents);
printMetric('Total Courses', current.totalCourses, optimal?.totalCourses);
console.log('─'.repeat(70));

printMetric('1-student courses', `${current.sizes[1]} (${(current.sizes[1]/current.totalCourses*100).toFixed(1)}%)`,
            optimal ? `${optimal.sizes[1]} (${(optimal.sizes[1]/optimal.totalCourses*100).toFixed(1)}%)` : null, true);
printMetric('2-student courses', `${current.sizes[2]} (${(current.sizes[2]/current.totalCourses*100).toFixed(1)}%)`,
            optimal ? `${optimal.sizes[2]} (${(optimal.sizes[2]/optimal.totalCourses*100).toFixed(1)}%)` : null);
printMetric('3-student courses', `${current.sizes[3]} (${(current.sizes[3]/current.totalCourses*100).toFixed(1)}%)`,
            optimal ? `${optimal.sizes[3]} (${(optimal.sizes[3]/optimal.totalCourses*100).toFixed(1)}%)` : null);
printMetric('4+ student courses', `${current.sizes[4]} (${(current.sizes[4]/current.totalCourses*100).toFixed(1)}%)`,
            optimal ? `${optimal.sizes[4]} (${(optimal.sizes[4]/optimal.totalCourses*100).toFixed(1)}%)` : null);
console.log('─'.repeat(70));

printMetric('Efficient (3-4 students)', `${current.efficient} (${(current.efficient/current.totalCourses*100).toFixed(1)}%)`,
            optimal ? `${optimal.efficient} (${(optimal.efficient/optimal.totalCourses*100).toFixed(1)}%)` : null);
printMetric('Inefficient (<3 students)', `${current.inefficient} (${(current.inefficient/current.totalCourses*100).toFixed(1)}%)`,
            optimal ? `${optimal.inefficient} (${(optimal.inefficient/optimal.totalCourses*100).toFixed(1)}%)` : null, true);
console.log('─'.repeat(70));

printMetric('Adult/Child Mixed', current.mixedAdultChild, optimal?.mixedAdultChild, true);
printMetric('Skill Level Mixed', current.mixedSkill, optimal?.mixedSkill, true);
printMetric('Training Group Mixed', current.mixedGroup, optimal?.mixedGroup, true);
printMetric('TOTAL MIXED', `${current.totalMixed} (${(current.totalMixed/current.totalCourses*100).toFixed(1)}%)`,
            optimal ? `${optimal.totalMixed} (${(optimal.totalMixed/optimal.totalCourses*100).toFixed(1)}%)` : null, true);
console.log('─'.repeat(70));

printMetric('Capacity Score', `${current.efficiencyScore}/100`, optimal ? `${optimal.efficiencyScore}/100` : null);
printMetric('Mixing Penalty', `-${current.mixingPenalty}`, optimal ? `-${optimal.mixingPenalty}` : null);
printMetric('OVERALL SCORE', `${current.overallScore}/100`, optimal ? `${optimal.overallScore}/100` : null);

console.log('═══════════════════════════════════════════════════════════════════════\n');

// Detailed analysis
console.log('🔍 DETAILED WEAKNESS ANALYSIS - CODE ALGORITHM\n');

const weaknesses = [];
const suggestions = [];

// Weakness 1: Too many mixed courses
if (current.totalMixed > optimal?.totalMixed || 0) {
  const diff = current.totalMixed - (optimal?.totalMixed || 0);
  weaknesses.push(`❌ CRITICAL: ${current.totalMixed} mixed-level courses (${diff} more than optimal)`);
  weaknesses.push(`   - Adult/Child Mixed: ${current.mixedAdultChild} courses (NEVER acceptable)`);
  weaknesses.push(`   - Skill Level Mixed: ${current.mixedSkill} courses`);
  weaknesses.push(`   - Training Group Mixed: ${current.mixedGroup} courses`);

  suggestions.push(`🔧 FIX: The evaluateCourse() function is not strictly enforcing level matching`);
  suggestions.push(`   → In Phase 1, add explicit rejection for ANY level mismatch`);
  suggestions.push(`   → Check adult/child mixing FIRST before any other criteria`);
  suggestions.push(`   → Make skillLevel/trainigGroup matching truly mandatory, not optional`);
}

// Weakness 2: Too few full courses
if (current.sizes[4] < (optimal?.sizes[4] || 0)) {
  const diff = (optimal?.sizes[4] || 0) - current.sizes[4];
  weaknesses.push(`\n❌ LOW EFFICIENCY: Only ${current.sizes[4]} full courses (${diff} fewer than optimal)`);

  suggestions.push(`\n🔧 FIX: Phase 1 is not prioritizing high-overlap slots`);
  suggestions.push(`   → Pre-analyze time slots with 4+ students from SAME group`);
  suggestions.push(`   → Sort opportunities by student count (highest first)`);
  suggestions.push(`   → Create full courses BEFORE considering partial fills`);
}

// Weakness 3: Too many singles
if (current.sizes[1] > (optimal?.sizes[1] || 0)) {
  const diff = current.sizes[1] - (optimal?.sizes[1] || 0);
  weaknesses.push(`\n❌ FRAGMENTATION: ${current.sizes[1]} single-student courses (${diff} more than optimal)`);

  suggestions.push(`\n🔧 FIX: Algorithm is creating new empty courses too readily`);
  suggestions.push(`   → In Phase 3, prefer filling existing courses over creating new ones`);
  suggestions.push(`   → Add logic: "Only create new course if no existing compatible course exists"`);
  suggestions.push(`   → Increase bestMatch preference for courses with 2-3 students`);
}

// Weakness 4: Overall efficiency
const efficiencyGap = parseFloat(optimal?.efficiencyScore || 0) - parseFloat(current.efficiencyScore);
if (efficiencyGap > 5) {
  weaknesses.push(`\n❌ CAPACITY UTILIZATION: ${current.efficiencyScore}/100 (${efficiencyGap.toFixed(1)} points below optimal)`);

  suggestions.push(`\n🔧 FIX: Reorder algorithm phases`);
  suggestions.push(`   → NEW ORDER: 1) Find 4-student opportunities, 2) Fill to capacity, 3) Create 2-3 courses, 4) Relaxed, 5) Singles`);
  suggestions.push(`   → CURRENT ORDER seems to scatter students too early`);
}

// Print weaknesses
if (weaknesses.length > 0) {
  weaknesses.forEach(w => console.log(w));
  console.log('\n');
}

// Print suggestions
console.log('💡 OPTIMIZATION SUGGESTIONS FOR CODE\n');
console.log('═══════════════════════════════════════════════════════════════════════\n');

if (suggestions.length > 0) {
  suggestions.forEach((s, i) => console.log(s));
} else {
  console.log('✅ Code algorithm is already optimal!\n');
}

console.log('\n═══════════════════════════════════════════════════════════════════════');

// Specific code changes needed
console.log('\n📝 SPECIFIC CODE CHANGES NEEDED IN resetSchedule.js:\n');

console.log('1. FIX ADULT/CHILD MIXING (CRITICAL):');
console.log('   In evaluateCourse(), line ~118:');
console.log('   CURRENT: Checks adult/child after other criteria');
console.log('   CHANGE TO: Check adult/child FIRST and return immediately if fails\n');

console.log('2. FIX SKILL LEVEL MATCHING (CRITICAL):');
console.log('   In evaluateCourse(), line ~154-165:');
console.log('   CURRENT: Uses "!allMatchSkillLevel" which may allow empty course bypass');
console.log('   CHANGE TO: Explicit check - if course has students, ALL must match exactly\n');

console.log('3. ADD FILL-FIRST LOGIC (HIGH PRIORITY):');
console.log('   Before Phase 1 (line ~345):');
console.log('   ADD: Pre-analysis step to find time slots with 4+ same-level students');
console.log('   ADD: Create these full courses FIRST before greedy assignment\n');

console.log('4. FIX PHASE 2 PREFERENCE (MEDIUM PRIORITY):');
console.log('   In Phase 2 (line ~459-496):');
console.log('   CURRENT: Prefers fuller courses but still creates new ones');
console.log('   CHANGE TO: Skip courses with length === 0 to force filling existing ones\n');

console.log('5. OPTIMIZE SORTING (LOW PRIORITY):');
console.log('   Phase 1 sorting (line ~351):');
console.log('   CURRENT: Sorts by availableTimes.length (scarcity-first)');
console.log('   CONSIDER: Sort by "students in same group at same time" (opportunity-first)\n');

console.log('═══════════════════════════════════════════════════════════════════════\n');

mongoose.connection.close();
