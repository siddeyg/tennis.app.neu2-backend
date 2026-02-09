import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment
dotenv.config({ path: path.join(__dirname, '../.env.development') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/tennis-coach';

const campSchema = new mongoose.Schema({
  title: String,
  startDate: Date,
  endDate: Date,
  schedule: [{
    day: String,
    startTime: String,
    endTime: String,
    venue: String
  }]
}, { collection: 'camps' });

const Camp = mongoose.model('Camp', campSchema);

async function queryCamps() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    const camps = await Camp.find({
      startDate: { $gte: new Date('2026-04-01'), $lte: new Date('2026-04-30') }
    }).select('title startDate endDate schedule');

    console.log('\n=== Camps in April 2026 ===\n');

    camps.forEach(camp => {
      console.log(`Title: ${camp.title}`);
      console.log(`Date Range: ${camp.startDate.toISOString().split('T')[0]} to ${camp.endDate.toISOString().split('T')[0]}`);
      console.log(`Schedule entries: ${camp.schedule.length}`);
      console.log('Schedule days:');
      camp.schedule.forEach((session, idx) => {
        console.log(`  ${idx + 1}. ${session.day} ${session.startTime}-${session.endTime} (${session.venue || 'no venue'})`);
      });

      // Count unique days
      const uniqueDays = new Set(camp.schedule.map(s => s.day));
      console.log(`Unique training days: ${uniqueDays.size}`);
      console.log('---\n');
    });

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

queryCamps();
