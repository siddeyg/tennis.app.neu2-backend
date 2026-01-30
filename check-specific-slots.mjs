import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config({ path: './.env.development' });
await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/tennis-coach');

const Student = mongoose.model('Student', new mongoose.Schema({}, { strict: false }), 'students');

console.log('\n=== CHECKING SPECIFIC PROBLEM SLOTS ===\n');

// Check who is assigned to Samstag 12 (Josef Wong and Joris Muck want this)
console.log('--- SAMSTAG 12 ---');
const samstag12 = await Student.find({ day: 'Samstag', hour: 12 });
console.log(`Total students assigned: ${samstag12.length}\n`);

samstag12.forEach(s => {
  const flex = s.availableTimes?.length || 0;
  const level = s.adult ? s.skillLevel : s.trainigGroup;
  console.log(`  ${s.firstName} ${s.lastName} (${level})`);
  console.log(`    Flexibility: ${flex} slots`);
  console.log(`    Available times: ${s.availableTimes?.join(', ')}`);
  console.log();
});

// Check Mittwoch 16 (Maja Dietzler wants this)
console.log('--- MITTWOCH 16 ---');
const mittwoch16 = await Student.find({ day: 'Mittwoch', hour: 16 });
console.log(`Total students assigned: ${mittwoch16.length}\n`);

mittwoch16.forEach(s => {
  const flex = s.availableTimes?.length || 0;
  const level = s.adult ? s.skillLevel : s.trainigGroup;
  console.log(`  ${s.firstName} ${s.lastName} (${level})`);
  console.log(`    Flexibility: ${flex} slots`);
  console.log(`    Available times: ${s.availableTimes?.join(', ')}`);
  console.log();
});

// Check Mittwoch 17 (Maja's other option)
console.log('--- MITTWOCH 17 ---');
const mittwoch17 = await Student.find({ day: 'Mittwoch', hour: 17 });
console.log(`Total students assigned: ${mittwoch17.length}\n`);

mittwoch17.forEach(s => {
  const flex = s.availableTimes?.length || 0;
  const level = s.adult ? s.skillLevel : s.trainigGroup;
  console.log(`  ${s.firstName} ${s.lastName} (${level})`);
  console.log(`    Flexibility: ${flex} slots`);
  console.log(`    Available times: ${s.availableTimes?.join(', ')}`);
  console.log();
});

// Check if Josef, Maja, Joris are ANYWHERE
console.log('--- CHECKING IF BLOCKED STUDENTS ARE ASSIGNED ANYWHERE ---\n');

const josef = await Student.findOne({ firstName: 'Josef', lastName: 'Wong' });
console.log(`Josef Wong: ${josef.day ? `${josef.day} ${josef.hour}` : 'UNASSIGNED'}`);

const maja = await Student.findOne({ firstName: 'Maja', lastName: 'Dietzler' });
console.log(`Maja Dietzler: ${maja.day ? `${maja.day} ${maja.hour}` : 'UNASSIGNED'}`);

const joris = await Student.findOne({ firstName: 'Joris', lastName: 'Muck' });
console.log(`Joris Muck: ${joris.day ? `${joris.day} ${joris.hour}` : 'UNASSIGNED'}\n`);

await mongoose.connection.close();
