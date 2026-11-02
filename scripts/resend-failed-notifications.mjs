import '../src/loadEnv.js';
import mongoose from 'mongoose';
import Student from '../src/models/Student.js';
import RegistrationPeriod from '../src/models/RegistrationPeriod.js';
import StudentPortalUser from '../src/models/StudentPortalUser.js';
import Coach from '../src/models/Coach.js';
import EmailLog from '../src/models/EmailLog.js';
import { createNotification } from '../src/utils/notificationHelpers.js';
import { sendScheduleNotificationEmail } from '../src/utils/emailService.js';
import { resolveVenueForAssignment } from '../src/utils/venueResolver.js';

const TARGET_STUDENT_IDS = [
  '6abbbd81799bf128fe09ccd4', // Katharina Seegel
  '6ac665c2a2738da10d0e7581', // Finn Gruber
  '6ac68134a2738da10d0e7d45', // Ella Gruber
  '6acce240a2738da10d0f853f'  // Karl Schmiedt
];

const DAY_ORDER = { Montag: 1, Dienstag: 2, Mittwoch: 3, Donnerstag: 4, Freitag: 5, Samstag: 6, Sonntag: 7 };

function buildAssignmentList(assignments) {
  const sorted = [...assignments].sort((a, b) => {
    const dayDiff = (DAY_ORDER[a.day] || 99) - (DAY_ORDER[b.day] || 99);
    if (dayDiff !== 0) return dayDiff;
    return (Number(a.hour) || 0) - (Number(b.hour) || 0);
  });
  return sorted.map(a => {
    const h = Math.floor(Number(a.hour) || 0);
    const m = (Number(a.hour) || 0) % 1 !== 0 ? '30' : '00';
    const venueStr = a.venue ? ` (${a.venue})` : '';
    return `${a.day} ${String(h).padStart(2, '0')}:${m} Uhr${venueStr}`;
  }).join(', ');
}

async function findPortalUserForStudent(studentId, student = null) {
  const s = student || await Student.findById(studentId);
  if (s?.studentPortalUserId) {
    const user = await StudentPortalUser.findById(s.studentPortalUserId);
    if (user) return user;
  }
  const direct = await StudentPortalUser.findOne({ studentId });
  if (direct) return direct;
  const family = await StudentPortalUser.findOne({ 'familyMembers.studentId': studentId });
  if (family) return family;
  if (s?.email) {
    const byEmail = await StudentPortalUser.findOne({ email: s.email.toLowerCase().trim() });
    if (byEmail) return byEmail;
  }
  return null;
}

async function run() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI or MONGODB_URI environment variable is required');
  }
  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);

  const coaches = await Coach.find({}).lean();
  const coachMap = new Map(coaches.map(c => [String(c._id), c]));

  console.log(`Found ${coaches.length} coaches. Processing ${TARGET_STUDENT_IDS.length} students...`);

  for (const studentId of TARGET_STUDENT_IDS) {
    const student = await Student.findById(studentId);
    if (!student) {
      console.warn(`[WARN] Student ${studentId} not found in DB`);
      continue;
    }

    const portalUser = await findPortalUserForStudent(student._id, student);
    const recipientEmail = portalUser?.email || student.email;
    const period = student.periodId ? await RegistrationPeriod.findById(student.periodId).lean() : null;
    const periodName = period?.name || 'Wintertraining 2026/2027';

    console.log(`\n--- Sending notification for: ${student.firstName} ${student.lastName} (${recipientEmail}) ---`);

    // Enrich assignments
    const enrichedAssignments = (student.assignments || []).map(a => {
      const coachIdStr = String(a.coach?._id || a.coach || '');
      const coachObj = coachMap.get(coachIdStr);
      const coachName = coachObj ? `${coachObj.firstName} ${coachObj.lastName}`.trim() : (a.coachName || 'Trainerteam');
      const venue = resolveVenueForAssignment(student, a, period);
      return {
        ...(typeof a.toObject === 'function' ? a.toObject() : a),
        coach: coachObj || a.coach,
        coachName,
        venue
      };
    });

    const assignmentList = buildAssignmentList(enrichedAssignments);

    // In-App Notification
    if (portalUser) {
      try {
        await createNotification(
          portalUser._id,
          'schedule_change',
          `Trainingsplan: ${student.firstName} ${student.lastName}`,
          `Trainingszeiten für ${student.firstName}: ${assignmentList}`,
          { priority: 'high', actionUrl: '/dashboard/schedule' }
        );
        console.log(`  ✓ Portal notification created for portal user ${portalUser._id}`);
      } catch (e) {
        console.error(`  ✗ Error creating portal notification:`, e.message);
      }
    }

    // Ensure scheduleVisible is true
    await Student.findByIdAndUpdate(student._id, { scheduleVisible: true });

    // Send Email
    let emailResult = null;
    let emailError = null;
    try {
      emailResult = await sendScheduleNotificationEmail({
        student,
        portalUser,
        assignments: enrichedAssignments,
        periodName
      });
      console.log(`  ✓ Email sent successfully to ${recipientEmail} (messageId: ${emailResult.messageId})`);
    } catch (err) {
      emailError = err.message;
      console.error(`  ✗ Failed to send email to ${recipientEmail}:`, err.message);
    }

    // Write audit log
    try {
      await EmailLog.create({
        recipientEmail: recipientEmail.toLowerCase().trim(),
        studentId: student._id,
        studentName: `${student.firstName} ${student.lastName}`,
        portalUserId: portalUser?._id || null,
        periodId: period?._id || student.periodId || null,
        periodName,
        subject: `Trainingsplan ${periodName}: Trainingszeiten für ${student.firstName} ${student.lastName} 🎾`,
        templateType: 'schedule_notification',
        category: 'notification',
        status: emailError ? 'failed' : (emailResult?.simulated ? 'simulated' : 'sent'),
        messageId: emailResult?.messageId || null,
        errorMessage: emailError,
        sentAt: new Date(),
        sentBy: 'admin',
        triggerType: 'single',
        assignmentsSummary: assignmentList
      });
      console.log(`  ✓ EmailLog record saved with status: ${emailError ? 'failed' : 'sent'}`);
    } catch (logErr) {
      console.error(`  ✗ Error saving EmailLog:`, logErr.message);
    }

    // Pacing between emails
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\nAll 4 students processed successfully.');
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Fatal error running script:', err);
  process.exit(1);
});
