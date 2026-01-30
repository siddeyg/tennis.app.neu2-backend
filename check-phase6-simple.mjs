import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config({ path: './.env.development' });
await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/tennis-coach');

const Student = mongoose.model('Student', new mongoose.Schema({}, { strict: false }), 'students');

console.log('\n=== PHASE 6 EFFECTIVENESS CHECK ===\n');

const nicK = await Student.findOne({ firstName: 'Nic', lastName: 'K' });
const marlene = await Student.findOne({ firstName: 'Marlene', lastName: 'Zock' });

console.log('Expected Consolidation #1: Nic K + Marlene Zock (Kinderland)');
console.log('Nic K:', nicK.day, nicK.hour);
console.log('Marlene Zock:', marlene.day, marlene.hour);

if (nicK.day === marlene.day && nicK.hour === marlene.hour) {
  console.log('✅ SUCCESS: They are in the same course!\n');
} else {
  console.log('❌ FAILED: They are in DIFFERENT courses\n');
}

const nadim = await Student.findOne({ firstName: 'Nadim', lastName: 'El Gharabawy' });
const nadia = await Student.findOne({ firstName: 'Nadia', lastName: 'El Gharabawy' });

console.log('Expected Consolidation #2: Nadim + Nadia El Gharabawy (Gelb Team)');
console.log('Nadim:', nadim.day, nadim.hour);
console.log('Nadia:', nadia.day, nadia.hour);

if (nadim.day === nadia.day && nadim.hour === nadia.hour) {
  console.log('✅ SUCCESS: They are in the same course!\n');
} else {
  console.log('❌ FAILED: They are in DIFFERENT courses\n');
}

console.log('💡 If these failed, Phase 6 either did not run or could not find compatible target courses.');
console.log('Check the browser console for Phase 6 output to see what actually happened.\n');

await mongoose.connection.close();
