import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config({path:'./.env.development'});
await mongoose.connect(process.env.MONGO_URI||'mongodb://localhost:27017/tennis-coach');

const SavedSchedule = mongoose.model('SavedSchedule', new mongoose.Schema({}, {strict: false}), 'savedschedules');

// Get the most recent saved schedule created by system
const savedPlan = await SavedSchedule.findOne({createdBy: 'system'}).sort({createdAt: -1}).lean();

if (!savedPlan) {
  console.log('No saved schedule found!');
  process.exit(1);
}

console.log('\n════════════════════════════════════════════════');
console.log(`   ANALYZING: ${savedPlan.name}`);
console.log('════════════════════════════════════════════════\n');

const students = savedPlan.students;
const schedule = savedPlan.schedule;
const studentsNotSet = savedPlan.studentsNotSet;

console.log('📊 BASIC STATISTICS');
console.log(`   Total Students: ${students.length}`);
console.log(`   Total Courses: ${schedule.length}`);
console.log(`   Assigned: ${students.length - studentsNotSet.length}/${students.length}`);
console.log(`   Unassigned: ${studentsNotSet.length}\n`);

// Analyze course sizes
const sizes={1:0,2:0,3:0,4:0};
schedule.forEach(c=>{
  const sz=Math.min(c.students.length,4);
  sizes[sz]++;
});

console.log('📈 COURSE CAPACITY ANALYSIS');
console.log(`   ┌─────────────────────────────────────┐`);
console.log(`   │  1 student:  ${sizes[1].toString().padStart(2)} courses (${((sizes[1]/schedule.length)*100).toFixed(1).padStart(4)}%)  │`);
console.log(`   │  2 students: ${sizes[2].toString().padStart(2)} courses (${((sizes[2]/schedule.length)*100).toFixed(1).padStart(4)}%)  │`);
console.log(`   │  3 students: ${sizes[3].toString().padStart(2)} courses (${((sizes[3]/schedule.length)*100).toFixed(1).padStart(4)}%)  │`);
console.log(`   │  4+ students: ${sizes[4].toString().padStart(2)} courses (${((sizes[4]/schedule.length)*100).toFixed(1).padStart(4)}%)  │`);
console.log(`   └─────────────────────────────────────┘\n`);

const efficient=sizes[3]+sizes[4];
const inefficient=sizes[1]+sizes[2];
console.log(`   ✅ Efficient (3-4 students): ${efficient} courses (${(efficient/schedule.length*100).toFixed(1)}%)`);
console.log(`   ⚠️  Inefficient (<3 students): ${inefficient} courses (${(inefficient/schedule.length*100).toFixed(1)}%)\n`);

// Analyze mixing
let mixedSkill=0;
let mixedGroup=0;
let mixedAdultChild=0;

schedule.forEach(course=>{
  const courseStudents = students.filter(s => course.students.includes(s._id));

  const hasAdults=courseStudents.some(s=>s.adult);
  const hasChildren=courseStudents.some(s=>!s.adult);
  const skills=[...new Set(courseStudents.filter(s=>s.adult).map(s=>s.skillLevel).filter(Boolean))];
  const groups=[...new Set(courseStudents.filter(s=>!s.adult).map(s=>s.trainigGroup).filter(Boolean))];

  if(hasAdults&&hasChildren) mixedAdultChild++;
  else if(skills.length>1) mixedSkill++;
  else if(groups.length>1) mixedGroup++;
});

const totalMixed=mixedSkill+mixedGroup+mixedAdultChild;
console.log('🔀 LEVEL MIXING ANALYSIS');
console.log(`   Total Mixed Courses: ${totalMixed}/${schedule.length} (${(totalMixed/schedule.length*100).toFixed(1)}%)`);
console.log(`   ├─ Adult/Child Mixed: ${mixedAdultChild}`);
console.log(`   ├─ Skill Level Mixed: ${mixedSkill}`);
console.log(`   └─ Training Group Mixed: ${mixedGroup}\n`);

// Efficiency score
const efficiencyScore=(
  (sizes[4]*100+sizes[3]*75+sizes[2]*50+sizes[1]*25)/schedule.length
).toFixed(1);

const mixingPenalty=totalMixed*5;
const overallScore=Math.max(0,parseFloat(efficiencyScore)-mixingPenalty).toFixed(1);

console.log('🎯 OVERALL QUALITY SCORES');
console.log(`   Course Capacity Score: ${efficiencyScore}/100`);
console.log(`   Level Mixing Penalty: -${mixingPenalty} points`);
console.log(`   ⭐ OVERALL SCORE: ${overallScore}/100\n`);

// Goal assessment
const goal1=sizes[4]>=15?'✅':'❌';
const goal2=(efficient/schedule.length)>=0.6?'✅':'❌';
const goal3=(totalMixed/schedule.length)<0.1?'✅':'❌';
const goal4=((students.length-studentsNotSet.length)/students.length)>=0.95?'✅':'❌';

console.log('🎯 GOAL ACHIEVEMENT');
console.log(`   ${goal1} 15+ full courses (4 students): ${sizes[4]}/15`);
console.log(`   ${goal2} 60%+ efficiency (3-4 students): ${(efficient/schedule.length*100).toFixed(1)}%/60%`);
console.log(`   ${goal3} <10% mixed levels: ${(totalMixed/schedule.length*100).toFixed(1)}%/10%`);
console.log(`   ${goal4} 95%+ students assigned: ${((students.length-studentsNotSet.length)/students.length*100).toFixed(1)}%/95%\n`);

console.log('════════════════════════════════════════════════\n');

mongoose.connection.close();
