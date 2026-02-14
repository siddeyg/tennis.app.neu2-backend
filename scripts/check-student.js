/**
 * Check if student exists
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment
dotenv.config({ path: path.join(__dirname, '../.env.development') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/tennis-coach';

async function checkStudent() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    const Student = mongoose.model('Student', new mongoose.Schema({}, { strict: false }));
    const SeasonalRegistration = mongoose.model('SeasonalRegistration', new mongoose.Schema({}, { strict: false }));

    // Find student
    const students = await Student.find({ firstName: 'oojo' }).lean();
    console.log('\n📋 Students found:', students.length);
    students.forEach(s => {
      console.log(`  - ${s.firstName} ${s.lastName} (ID: ${s._id})`);
      console.log(`    Adult: ${s.adult}, Assignments: ${s.assignments?.length || 0}`);
    });

    // Find registration
    const registrations = await SeasonalRegistration.find({
      firstName: 'oojo'
    }).lean();

    console.log('\n📋 Registrations found:', registrations.length);
    registrations.forEach(r => {
      console.log(`  - ${r.firstName} ${r.lastName}`);
      console.log(`    Status: ${r.status}`);
      console.log(`    StudentId: ${r.studentId || 'NONE'}`);
      console.log(`    FormType: ${r.formType}`);
      console.log(`    Available Times: ${r.availableTimesKids?.length || r.availableTimesAdults?.length || 0}`);
    });

    await mongoose.disconnect();
    console.log('\nDone!');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkStudent();
