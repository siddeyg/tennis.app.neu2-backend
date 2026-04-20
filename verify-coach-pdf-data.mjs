import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

async function verify() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/tennis-coach');
    console.log('Connected to MongoDB');

    const User = mongoose.model('User', new mongoose.Schema({ firstName: String, lastName: String }));
    const Student = mongoose.model('Student', new mongoose.Schema({
      firstName: String,
      lastName: String,
      assignments: [{
        day: String,
        hour: Number,
        duration: Number,
        coach: mongoose.Schema.Types.ObjectId
      }]
    }));

    // Nicole as admin has a specific coachId reference or is the target
    const coachId = "68eba899b18bd6e9d75da5f0";
    console.log(`Verifying assignments for coach ID: ${coachId} (Nicole)`);

    // Search for both ObjectId and String forms
    const students = await Student.find({
      'assignments.coach': { $in: [new mongoose.Types.ObjectId(coachId), coachId] }
    });
    console.log(`Found ${students.length} students assigned to this coach.`);

    const days = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
    const schedule = {};
    days.forEach(d => schedule[d] = {});

    students.forEach(s => {
      s.assignments.forEach(a => {
        if (String(a.coach) === String(coachId)) {
          if (!schedule[a.day][a.hour]) schedule[a.day][a.hour] = [];
          schedule[a.day][a.hour].push(`${s.firstName} ${s.lastName} (${a.duration}m)`);
        }
      });
    });


    days.forEach(day => {
      const hours = Object.keys(schedule[day]).map(Number).sort((a, b) => a - b);
      if (hours.length > 0) {
        console.log(`\n--- ${day} ---`);
        hours.forEach(h => {
          console.log(`${h}:00: ${schedule[day][h].join(', ')}`);
        });
      }
    });

    await mongoose.disconnect();
  } catch (err) {
    console.error(err);
  }
}

verify();
