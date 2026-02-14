/**
 * Fix oojo jojjo registration - create Student record
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

async function fixRegistration() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    const Student = mongoose.model('Student', new mongoose.Schema({}, { strict: false }));
    const SeasonalRegistration = mongoose.model('SeasonalRegistration', new mongoose.Schema({}, { strict: false }));
    const StudentPortalUser = mongoose.model('StudentPortalUser', new mongoose.Schema({}, { strict: false }));

    // Find the registration
    const registration = await SeasonalRegistration.findOne({
      firstName: 'oojo',
      status: 'processed'
    });

    if (!registration) {
      console.log('❌ Registration not found');
      await mongoose.disconnect();
      return;
    }

    console.log('\n📋 Found registration:', registration.firstName, registration.lastName);
    console.log('   Status:', registration.status);
    console.log('   StudentId:', registration.studentId || 'NONE');
    console.log('   FamilyMemberId:', registration.familyMemberId || 'NONE');

    // Get child's data from family member
    let firstName = registration.firstName;
    let lastName = registration.lastName;
    let birthDate = registration.birthdate;

    if (registration.familyMemberId) {
      const parentUser = await StudentPortalUser.findById(registration.studentPortalUserId);
      if (parentUser && parentUser.familyMembers) {
        const familyMember = parentUser.familyMembers.find(
          fm => fm._id.toString() === registration.familyMemberId.toString()
        );
        if (familyMember) {
          firstName = familyMember.firstName;
          lastName = familyMember.lastName;
          birthDate = familyMember.birthdate;
          console.log('   Using family member data:', firstName, lastName);
        }
      }
    }

    // Create Student record
    const studentData = {
      firstName,
      lastName,
      birthDate: new Date(birthDate).toISOString().split('T')[0],
      email: registration.email,
      phone: registration.phone || '',
      adress: registration.address || '',
      comment: registration.remarks || '',
      sex: '',
      member: registration.mitgliedsstatus === 'Mitglied',
      adult: registration.formType === 'adults',
      frequence: registration.trainingshäufigkeit === '2x pro Woche' ? '2' : '1',
      assignments: [],
      team: registration.teamParticipation || false,
      trainigGroup: registration.trainingsart || '',
      availableTimes: (registration.availableTimesKids || []).map(t => ({
        day: t.day,
        hour: t.hour,
        venue: t.venue || ''
      }))
    };

    console.log('\n🔧 Creating Student record...');
    const student = new Student(studentData);
    await student.save();

    console.log('✅ Student created:', student._id);

    // Link to registration
    registration.studentId = student._id;
    await registration.save();

    console.log('✅ Registration linked to student');

    // Link to family member if applicable
    if (registration.familyMemberId) {
      const parentUser = await StudentPortalUser.findById(registration.studentPortalUserId);
      if (parentUser) {
        const familyMember = parentUser.familyMembers.find(
          fm => fm._id.toString() === registration.familyMemberId.toString()
        );
        if (familyMember) {
          familyMember.studentId = student._id;
          await parentUser.save();
          console.log('✅ Family member linked to student');
        }
      }
    }

    await mongoose.disconnect();
    console.log('\n✅ Done! Student created and linked.');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixRegistration();
