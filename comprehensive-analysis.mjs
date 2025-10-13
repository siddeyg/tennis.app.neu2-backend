import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({path:'./.env.development'});

await mongoose.connect(process.env.MONGO_URI||'mongodb://localhost:27017/tennis-coach');
const S=mongoose.model('S',new mongoose.Schema({},{strict:false}),'students');
const ss=await S.find({});

console.log('\n════════════════════════════════════════════════');
console.log('   COMPREHENSIVE SCHEDULE ANALYSIS');
console.log('════════════════════════════════════════════════\n');

// Basic stats
const adults=ss.filter(s=>s.adult);
const children=ss.filter(s=>!s.adult);
const assigned=ss.filter(s=>s.day&&s.hour);

console.log('📊 BASIC STATISTICS');
console.log(`   Total Students: ${ss.length}`);
console.log(`   Adults: ${adults.length} (${(adults.length/ss.length*100).toFixed(1)}%)`);
console.log(`   Children: ${children.length} (${(children.length/ss.length*100).toFixed(1)}%)`);
console.log(`   Assigned: ${assigned.length}/${ss.length} (${(assigned.length/ss.length*100).toFixed(1)}%)`);
console.log(`   Unassigned: ${ss.length-assigned.length}\n`);

// Group by course
const courses={};
assigned.forEach(s=>{
  const k=`${s.day} ${s.hour}`;
  if(!courses[k]) courses[k]=[];
  courses[k].push(s);
});

console.log('📈 COURSE CAPACITY ANALYSIS');
const sizes={1:0,2:0,3:0,4:0};
Object.values(courses).forEach(c=>{
  const sz=Math.min(c.length,4);
  sizes[sz]++;
});

console.log(`   Total Courses: ${Object.keys(courses).length}`);
console.log(`   ┌─────────────────────────────────────┐`);
console.log(`   │  1 student:  ${sizes[1].toString().padStart(2)} courses (${((sizes[1]/Object.keys(courses).length)*100).toFixed(1).padStart(4)}%)  │`);
console.log(`   │  2 students: ${sizes[2].toString().padStart(2)} courses (${((sizes[2]/Object.keys(courses).length)*100).toFixed(1).padStart(4)}%)  │`);
console.log(`   │  3 students: ${sizes[3].toString().padStart(2)} courses (${((sizes[3]/Object.keys(courses).length)*100).toFixed(1).padStart(4)}%)  │`);
console.log(`   │  4+ students: ${sizes[4].toString().padStart(2)} courses (${((sizes[4]/Object.keys(courses).length)*100).toFixed(1).padStart(4)}%)  │`);
console.log(`   └─────────────────────────────────────┘`);

const efficient=sizes[3]+sizes[4];
const inefficient=sizes[1]+sizes[2];
console.log(`\n   ✅ Efficient (3-4 students): ${efficient} courses (${(efficient/Object.keys(courses).length*100).toFixed(1)}%)`);
console.log(`   ⚠️  Inefficient (<3 students): ${inefficient} courses (${(inefficient/Object.keys(courses).length*100).toFixed(1)}%)\n`);

// Mixed level analysis
console.log('🔀 LEVEL MIXING ANALYSIS');
let mixedSkill=0;
let mixedGroup=0;
let mixedAdultChild=0;
const mixedDetails=[];

Object.entries(courses).forEach(([time,list])=>{
  const hasAdults=list.some(s=>s.adult);
  const hasChildren=list.some(s=>!s.adult);
  const skills=[...new Set(list.filter(s=>s.adult).map(s=>s.skillLevel).filter(Boolean))];
  const groups=[...new Set(list.filter(s=>!s.adult).map(s=>s.trainigGroup).filter(Boolean))];

  if(hasAdults&&hasChildren){
    mixedAdultChild++;
    mixedDetails.push({time,issue:'ADULT/CHILD MIX',size:list.length});
  }
  else if(skills.length>1){
    mixedSkill++;
    mixedDetails.push({time,issue:`Skills: ${skills.join(', ')}`,size:list.length});
  }
  else if(groups.length>1){
    mixedGroup++;
    mixedDetails.push({time,issue:`Groups: ${groups.join(', ')}`,size:list.length});
  }
});

const totalMixed=mixedSkill+mixedGroup+mixedAdultChild;
console.log(`   Total Mixed Courses: ${totalMixed}/${Object.keys(courses).length} (${(totalMixed/Object.keys(courses).length*100).toFixed(1)}%)`);
console.log(`   ├─ Adult/Child Mixed: ${mixedAdultChild}`);
console.log(`   ├─ Skill Level Mixed: ${mixedSkill}`);
console.log(`   └─ Training Group Mixed: ${mixedGroup}\n`);

if(mixedDetails.length>0&&mixedDetails.length<=10){
  console.log('   Mixed Course Details:');
  mixedDetails.forEach(d=>{
    console.log(`   • ${d.time} (${d.size} students): ${d.issue}`);
  });
  console.log('');
}

// Efficiency score
const efficiencyScore=(
  (sizes[4]*100+sizes[3]*75+sizes[2]*50+sizes[1]*25)/Object.keys(courses).length
).toFixed(1);

const mixingPenalty=totalMixed*5;
const overallScore=Math.max(0,parseFloat(efficiencyScore)-mixingPenalty).toFixed(1);

console.log('🎯 OVERALL QUALITY SCORES');
console.log(`   Course Capacity Score: ${efficiencyScore}/100`);
console.log(`   (4 students=100pts, 3=75pts, 2=50pts, 1=25pts)`);
console.log(`\n   Level Mixing Penalty: -${mixingPenalty} points`);
console.log(`   (5 points per mixed course)`);
console.log(`\n   ⭐ OVERALL SCORE: ${overallScore}/100\n`);

// Goal assessment
console.log('🎯 GOAL ACHIEVEMENT');
const goal1=sizes[4]>=15?'✅':'❌';
const goal2=(efficient/Object.keys(courses).length)>=0.6?'✅':'❌';
const goal3=(totalMixed/Object.keys(courses).length)<0.1?'✅':'❌';
const goal4=(assigned.length/ss.length)>=0.95?'✅':'❌';

console.log(`   ${goal1} 15+ full courses (4 students): ${sizes[4]}/15`);
console.log(`   ${goal2} 60%+ efficiency (3-4 students): ${(efficient/Object.keys(courses).length*100).toFixed(1)}%/60%`);
console.log(`   ${goal3} <10% mixed levels: ${(totalMixed/Object.keys(courses).length*100).toFixed(1)}%/10%`);
console.log(`   ${goal4} 95%+ students assigned: ${(assigned.length/ss.length*100).toFixed(1)}%/95%\n`);

console.log('════════════════════════════════════════════════\n');

mongoose.connection.close();
