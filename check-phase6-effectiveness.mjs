import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config({ path: './.env.development' });
await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/tennis-coach');

const Student = mongoose.model('Student', new mongoose.Schema({}, { strict: false }), 'students');

console.log('\n=== PHASE 6 EFFECTIVENESS CHECK ===\n');

// The problem: Phase 6 should have consolidated Nic K + Marlene Zock and Nadim + Nadia
// Let's check if this happened

const nicK = await Student.findOne({ firstName: 'Nic', lastName: 'K' });
const marlene = await Student.findOne({ firstName: 'Marlene', lastName: 'Zock' });

console.log('Expected Consolidation #1: Nic K + Marlene Zock (Kinderland)\n');
console.log(`Nic K: ${nicK.day} ${nicK.hour}`);
console.log(`Marlene Zock: ${marlene.day} ${marlene.hour}`);

if (nicK.day === marlene.day && nicK.hour === marlene.hour) {
  console.log('✅ SUCCESS: They are in the same course!\n');
} else {
  console.log('❌ FAILED: They are in DIFFERENT courses\n');
}

const nadim = await Student.findOne({ firstName: 'Nadim', lastName: 'El Gharabawy' });
const nadia = await Student.findOne({ firstName: 'Nadia', lastName: 'El Gharabawy' });

console.log('Expected Consolidation #2: Nadim + Nadia El Gharabawy (Gelb Team)\n');
console.log(`Nadim: ${nadim.day} ${nadim.hour}`);
console.log(`Nadia: ${nadia.day} ${nadia.hour}`);

if (nadim.day === nadia.day && nadim.hour === nadia.hour) {
  console.log('✅ SUCCESS: They are in the same course!\n');
} else {
  console.log('❌ FAILED: They are in DIFFERENT courses\n');
}

// Check their available times
console.log('=== AVAILABLE TIMES ===\n');
console.log(`Nic K: ${nicK.availableTimes?.join(', ')}`);
console.log(`Marlene Zock: ${marlene.availableTimes?.join(', ')}\n');
console.log(`Nadim: ${nadim.availableTimes?.join(', ')}`);
console.log(`Nadia: ${nadia.availableTimes?.join(', ')}\n`);

// Find overlaps
const nicTimes = new Set(nicK.availableTimes || []);
const marleneTimes = new Set(marlene.availableTimes || []);
const overlap1 = [...nicTimes].filter(t => marleneTimes.has(t));

console.log(`Nic + Marlene overlap: ${overlap1.join(', ')}`);

const nadimTimes = new Set(nadim.availableTimes || []);
const nadiaTimes = new Set(nadia.availableTimes || []);
const overlap2 = [...nadimTimes].filter(t => nadiaTimes.has(t));

console.log(`Nadim + Nadia overlap: ${overlap2.join(', ')}\n`);

// WHY didn't Phase 6 work?
console.log('=== ANALYSIS ===\n');

if (overlap1.length > 0) {
  console.log(`✅ Nic + Marlene have ${overlap1.length} overlapping time(s)`);
  console.log(`   BUT they are at: Nic @ ${nicK.day} ${nicK.hour}, Marlene @ ${marlene.day} ${marlene.hour}`);
  console.log(`   Phase 6 should have moved one of them to a shared time slot`);
} else {
  console.log(`❌ Nic + Marlene have NO overlapping times - cannot consolidate`);
}

if (overlap2.length > 0) {
  console.log(`✅ Nadim + Nadia have ${overlap2.length} overlapping time(s)`);
  console.log(`   BUT they are at: Nadim @ ${nadim.day} ${nadim.hour}, Nadia @ ${nadia.day} ${nadia.hour}`);
  console.log(`   Phase 6 should have moved one of them to a shared time slot`);
} else {
  console.log(`❌ Nadim + Nadia have NO overlapping times - cannot consolidate`);
}

console.log('\n💡 RECOMMENDATION:\n');
console.log('If Phase 6 did not consolidate these students, it means:');
console.log('1. Phase 6 did not run (check browser console for Phase 6 output)');
console.log('2. Phase 6 ran but found no compatible target courses (courses at overlap times were full or wrong level)');
console.log('3. Phase 6 logic needs adjustment to create NEW courses at overlap times, not just join existing ones');

await mongoose.connection.close();
