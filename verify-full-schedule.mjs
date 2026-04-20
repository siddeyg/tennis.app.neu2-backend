import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const MONGO_URI = "mongodb://admin:password123@localhost:27017/tennis-coach?authSource=admin";

async function verifyAll() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    const User = mongoose.model('User', new mongoose.Schema({ firstName: String, lastName: String }));
    const Student = mongoose.model('Student', new mongoose.Schema({
      firstName: String,
      lastName: String,
      assignments: [{
        day: String,
        hour: Number,
        duration: Number,
        coach: mongoose.Schema.Types.Mixed // Can be ObjectId or String
      }]
    }));

    // Fetch both User and Coach collections for mapping
    const allUsers = await User.find({});
    const db = mongoose.connection.db;
    const allCoaches = await db.collection('coaches').find({}).toArray();
    
    const coachMap = {};
    // Use User collection for standard mappings
    allUsers.forEach(u => {
      coachMap[String(u._id)] = `${u.firstName} ${u.lastName}`;
    });
    // Use Coaches collection for the 69e6... IDs used in assignments
    allCoaches.forEach(c => {
      coachMap[String(c._id)] = `${c.firstName} ${c.lastName}`;
    });

    const students = await Student.find({});
    const days = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
    
    // Group by Coach Name (Normalized)
    const coachSchedules = {};

    students.forEach(s => {
      const studentName = `${s.firstName} ${s.lastName}`;
      s.assignments.forEach(a => {
        let coachName = "Unassigned";
        if (a.coach) {
          if (mongoose.Types.ObjectId.isValid(a.coach)) {
            coachName = coachMap[String(a.coach)] || `Unknown ID (${a.coach})`;
          } else {
            coachName = String(a.coach);
          }
        }

        if (!coachSchedules[coachName]) coachSchedules[coachName] = {};
        if (!coachSchedules[coachName][a.day]) coachSchedules[coachName][a.day] = {};
        if (!coachSchedules[coachName][a.day][a.hour]) coachSchedules[coachName][a.day][a.hour] = [];
        
        coachSchedules[coachName][a.day][a.hour].push(`${studentName} (${a.duration}m)`);
      });
    });

    const sortedCoaches = Object.keys(coachSchedules).sort();
    
    sortedCoaches.forEach(coach => {
      console.log(`\n==================================================`);
      console.log(`COACH: ${coach}`);
      console.log(`==================================================`);
      
      days.forEach(day => {
        if (coachSchedules[coach][day]) {
          console.log(`\n  [${day}]`);
          const hours = Object.keys(coachSchedules[coach][day]).map(Number).sort((a, b) => a - b);
          hours.forEach(h => {
            console.log(`    ${h}:00 -> ${coachSchedules[coach][day][h].join(', ')}`);
          });
        }
      });
    });

    await mongoose.disconnect();
  } catch (err) {
    console.error(err);
  }
}

verifyAll();
