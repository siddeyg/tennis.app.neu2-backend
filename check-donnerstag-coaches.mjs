import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config({path:'./.env.development'});
await mongoose.connect(process.env.MONGO_URI||'mongodb://localhost:27017/tennis-coach');

const Coach = mongoose.model('Coach', new mongoose.Schema({}, {strict: false}), 'coaches');
const coaches = await Coach.find({}).lean();

console.log('\n🔍 Coach availability on Donnerstag 18:');
coaches.forEach(c => {
  const has18 = (c.availableTimes || []).includes('Donnerstag 18');
  if (has18) {
    console.log(`✅ ${c.firstName} ${c.lastName}`);
    console.log(`   Adults: ${c.isCoachingAdult}, Children: ${c.isCoachingChildren}`);
  }
});

console.log('\n🔍 All coaches on Donnerstag:');
coaches.forEach(c => {
  const donnerstagTimes = (c.availableTimes || []).filter(t => t.startsWith('Donnerstag'));
  if (donnerstagTimes.length > 0) {
    console.log(`${c.firstName} ${c.lastName}: ${donnerstagTimes.join(', ')}`);
    console.log(`  Adults: ${c.isCoachingAdult}, Children: ${c.isCoachingChildren}`);
  }
});

mongoose.connection.close();
