import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({path:'./.env.development'});
await mongoose.connect(process.env.MONGO_URI||'mongodb://localhost:27017/tennis-coach');
const S=mongoose.model('S',new mongoose.Schema({},{strict:false}),'students');
const C=mongoose.model('C',new mongoose.Schema({},{strict:false}),'coaches');
const ss=await S.find({});
const cc=await C.find({});

console.log('=== DEEP ANALYSIS FOR OPTIMIZATION ===\n');

// Group students by level/group
const adults=ss.filter(s=>s.adult);
const children=ss.filter(s=>!s.adult);

const adultsByLevel={};
adults.forEach(s=>{const l=s.skillLevel||'unknown';adultsByLevel[l]=(adultsByLevel[l]||[]);adultsByLevel[l].push(s);});

const childrenByGroup={};
children.forEach(s=>{const g=s.trainigGroup||'unknown';childrenByGroup[g]=(childrenByGroup[g]||[]);childrenByGroup[g].push(s);});

console.log('Adults by skill level:');
Object.entries(adultsByLevel).forEach(([l,arr])=>{
  const assigned=arr.filter(s=>s.day).length;
  const avgSlots=arr.reduce((sum,s)=>(s.availableTimes||[]).length+sum,0)/arr.length;
  console.log(`  ${l}: ${arr.length} (${assigned} assigned, avg ${avgSlots.toFixed(1)} slots/student)`);
});

console.log('\nChildren by training group:');
Object.entries(childrenByGroup).forEach(([g,arr])=>{
  const assigned=arr.filter(s=>s.day).length;
  const avgSlots=arr.reduce((sum,s)=>(s.availableTimes||[]).length+sum,0)/arr.length;
  console.log(`  ${g}: ${arr.length} (${assigned} assigned, avg ${avgSlots.toFixed(1)} slots/student)`);
});

// Find time slots with overlapping availability per group
console.log('\n=== OVERLAP ANALYSIS (spots where 4+ students available) ===\n');

console.log('Adults:');
Object.entries(adultsByLevel).forEach(([l,arr])=>{
  const times={};
  arr.forEach(s=>(s.availableTimes||[]).forEach(t=>times[t]=(times[t]||0)+1));
  const good=Object.entries(times).filter(([t,c])=>c>=4).sort((a,b)=>b[1]-a[1]);
  if(good.length>0){
    console.log(`  ${l}: ${good.slice(0,3).map(([t,c])=>`${t}(${c})`).join(', ')}`);
  }else{
    console.log(`  ${l}: NO SLOTS WITH 4+ STUDENTS`);
  }
});

console.log('\nChildren:');
Object.entries(childrenByGroup).forEach(([g,arr])=>{
  const times={};
  arr.forEach(s=>(s.availableTimes||[]).forEach(t=>times[t]=(times[t]||0)+1));
  const good=Object.entries(times).filter(([t,c])=>c>=4).sort((a,b)=>b[1]-a[1]);
  if(good.length>0){
    console.log(`  ${g}: ${good.slice(0,3).map(([t,c])=>`${t}(${c})`).join(', ')}`);
  }else{
    console.log(`  ${g}: NO SLOTS WITH 4+ STUDENTS`);
  }
});

mongoose.connection.close();
