/**
 * Integration Tests: Schedule Publishing, Notifications & Portal Gates (Phase 3)
 *
 * Tests:
 * 1. PATCH /api/registration-periods/:id/publish-schedule
 *    - Toggles schedulePublished true/false
 *    - Validates inputs and handles not found
 * 2. POST /api/schedule-notifications/notify-all
 *    - Filters only assigned students (assignments.0: { $exists: true })
 *    - Strictly excludes unassigned / waitlist students
 *    - Resolves linked portal user and creates Notification documents
 *    - Sets Student.scheduleVisible: true
 *    - Enforces alreadySentToday guard unless force: true
 * 3. GET /api/portal/schedule
 *    - Blocks schedule (returns schedulePublished: false, schedule: []) when unpublished
 *    - Allows full schedule when schedulePublished: true
 *    - Bypasses gate when student.scheduleVisible: true even if globally unpublished
 */

import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import {
  connectTestDB,
  disconnectTestDB,
  clearTestDB,
  mockAuth
} from '../../testHelpers.js';

import Student from '../../models/Student.js';
import RegistrationPeriod from '../../models/RegistrationPeriod.js';
import StudentPortalUser from '../../models/StudentPortalUser.js';
import Notification from '../../models/Notification.js';
import EmailLog from '../../models/EmailLog.js';

import registrationPeriodsRoutes from '../registrationPeriods.js';
import scheduleNotificationsRoutes from '../scheduleNotifications.js';
import portalScheduleRoutes from '../portalSchedule.js';

// Setup test express application
const app = express();
app.use(express.json());

const adminUserId = new mongoose.Types.ObjectId();

// Routes with mocked auth:
// Admin endpoints with admin user having a valid ObjectId for audit log middleware
app.use(
  '/api/registration-periods',
  mockAuth({ _id: adminUserId, id: adminUserId.toString(), username: 'admin', role: 'admin' }),
  registrationPeriodsRoutes
);
app.use(
  '/api/schedule-notifications',
  mockAuth({ _id: adminUserId, id: adminUserId.toString(), username: 'admin', role: 'admin' }),
  scheduleNotificationsRoutes
);

// Portal endpoint dynamically takes the current student portal user
let currentPortalUser = null;
app.use('/api/portal', (req, res, next) => {
  if (currentPortalUser) {
    req.user = currentPortalUser;
    req.isAuthenticated = () => true;
  }
  next();
}, portalScheduleRoutes);

// Helper for valid StudentPortalUser
const createTestPortalUser = async (overrides = {}) => {
  return await StudentPortalUser.create({
    email: 'user@example.com',
    password: 'SecurePassword123!',
    firstName: 'Test',
    lastName: 'User',
    birthdate: new Date('1990-01-01'),
    ...overrides
  });
};
const createTestPeriod = async (overrides = {}) => {
  return await RegistrationPeriod.create({
    name: 'Winter 2026/2027',
    season: 'winter',
    year: 2026,
    status: 'open',
    currentPlanId: new mongoose.Types.ObjectId(),
    startDate: new Date('2026-09-01'),
    endDate: new Date('2027-04-30'),
    trainingStartDate: new Date('2026-10-01'),
    trainingEndDate: new Date('2027-04-30'),
    registrationDeadline: new Date('2026-09-25'),
    createdBy: adminUserId,
    schedulePublished: false,
    ...overrides
  });
};

describe('Schedule Publishing, Notifications & Portal Gates (Phase 3)', () => {
  beforeAll(async () => {
    await connectTestDB();
  }, 30000);

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    currentPortalUser = null;
  });

  describe('1. Global Publish Toggle: PATCH /api/registration-periods/:id/publish-schedule', () => {
    it('should successfully toggle schedulePublished to true and false', async () => {
      const period = await createTestPeriod({ schedulePublished: false });

      // Toggle ON
      const resOn = await request(app)
        .patch(`/api/registration-periods/${period._id}/publish-schedule`)
        .send({ published: true });

      expect(resOn.status).toBe(200);
      expect(resOn.body.schedulePublished).toBe(true);

      const periodInDb1 = await RegistrationPeriod.findById(period._id);
      expect(periodInDb1.schedulePublished).toBe(true);

      // Toggle OFF
      const resOff = await request(app)
        .patch(`/api/registration-periods/${period._id}/publish-schedule`)
        .send({ published: false });

      expect(resOff.status).toBe(200);
      expect(resOff.body.schedulePublished).toBe(false);

      const periodInDb2 = await RegistrationPeriod.findById(period._id);
      expect(periodInDb2.schedulePublished).toBe(false);
    });

    it('should return 404 for non-existent period', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .patch(`/api/registration-periods/${fakeId}/publish-schedule`)
        .send({ published: true });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/nicht gefunden/i);
    });
  });

  describe('2. In-App Notifications & scheduleVisible: POST /api/schedule-notifications/notify-all', () => {
    it('should notify only assigned students and exclude waitlist/unassigned students', async () => {
      const period = await createTestPeriod({ schedulePublished: false });

      // Portal User
      const portalUser = await createTestPortalUser({
        email: 'parent@example.com',
        firstName: 'Parent',
        lastName: 'Tester',
        birthdate: new Date('1985-05-15')
      });

      // Student 1: Assigned (has 1 assignment)
      const assignedStudent = await Student.create({
        firstName: 'Assigned',
        lastName: 'Student',
        email: 'parent@example.com',
        periodId: period._id,
        studentPortalUserId: portalUser._id,
        scheduleVisible: false,
        assignments: [
          {
            day: 'Montag',
            hour: 15,
            venue: 'Brüser Berg',
            coach: new mongoose.Types.ObjectId(),
            group: 'Rot 1'
          }
        ]
      });

      // Student 2: Waitlist (no assignments)
      const waitlistStudent = await Student.create({
        firstName: 'Waitlist',
        lastName: 'Student',
        email: 'parent@example.com',
        periodId: period._id,
        studentPortalUserId: portalUser._id,
        scheduleVisible: false,
        assignments: []
      });

      // Trigger notify-all
      const res = await request(app)
        .post('/api/schedule-notifications/notify-all')
        .send({ periodId: period._id.toString() });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.sentCount).toBe(1);

      // Verify DB flags
      const updatedAssigned = await Student.findById(assignedStudent._id);
      expect(updatedAssigned.scheduleVisible).toBe(true);

      const updatedWaitlist = await Student.findById(waitlistStudent._id);
      expect(updatedWaitlist.scheduleVisible).toBe(false); // Waitlist was untouched!

      // Verify in-app Notification was created
      const notifications = await Notification.find({ userId: portalUser._id });
      expect(notifications.length).toBe(1);
      expect(notifications[0].title).toBe('Trainingsplan: Assigned Student');
      expect(notifications[0].actionUrl).toBe('/dashboard/schedule');
      expect(notifications[0].message).toContain('Montag');

      // Verify alreadySentToday guard prevents double sending on same day
      const resDuplicate = await request(app)
        .post('/api/schedule-notifications/notify-all')
        .send({ periodId: period._id.toString() });

      expect(resDuplicate.status).toBe(200);
      expect(resDuplicate.body.warned).toBe(true);
      expect(resDuplicate.body.alreadySentToday).toBe(true);
      expect(resDuplicate.body.sentCount).toBe(0);

      // Verify force=true bypasses alreadySentToday guard
      const resForced = await request(app)
        .post('/api/schedule-notifications/notify-all')
        .send({ periodId: period._id.toString(), force: true });

      expect(resForced.status).toBe(200);
      expect(resForced.body.success).toBe(true);
      expect(resForced.body.sentCount).toBe(1);
    });

    it('should notify a single student linked via studentPortalUserId (notify-student)', async () => {
      const period = await createTestPeriod({ schedulePublished: false });

      const portalUser = await createTestPortalUser({
        email: 'maike@example.com',
        firstName: 'Maike',
        lastName: 'Just',
        birthdate: new Date('1972-09-23')
      });

      // Student linked via studentPortalUserId (Multi-Season Inversion of Control)
      const student = await Student.create({
        firstName: 'Maike',
        lastName: 'Just',
        email: 'just@gmx.net',
        periodId: period._id,
        studentPortalUserId: portalUser._id,
        scheduleVisible: false,
        assignments: [
          {
            day: 'Samstag',
            hour: 10,
            venue: 'BonnerTHV – Traglufthalle',
            coach: new mongoose.Types.ObjectId(),
            group: 'Erwachsene 4er'
          }
        ]
      });

      const res = await request(app)
        .post(`/api/schedule-notifications/notify-student/${student._id}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.sent).toBe(true);
      expect(res.body.studentName).toBe('Maike Just');

      // Verify scheduleVisible is set to true
      const updatedStudent = await Student.findById(student._id);
      expect(updatedStudent.scheduleVisible).toBe(true);

      // Verify notification in DB
      const notifications = await Notification.find({ userId: portalUser._id });
      expect(notifications.length).toBe(1);
      expect(notifications[0].title).toBe('Trainingsplan: Maike Just');
      expect(notifications[0].message).toContain('Samstag');
    });

    it('should return 400 when student has no portal account', async () => {
      const period = await createTestPeriod({ schedulePublished: false });

      const studentWithoutPortal = await Student.create({
        firstName: 'No',
        lastName: 'Portal',
        email: 'noportal@example.com',
        periodId: period._id,
        assignments: [
          {
            day: 'Montag',
            hour: 14,
            venue: 'Brüser Berg',
            coach: new mongoose.Types.ObjectId(),
            group: 'Rot 1'
          }
        ]
      });

      const res = await request(app)
        .post(`/api/schedule-notifications/notify-student/${studentWithoutPortal._id}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Schüler hat kein Portal-Konto');
    });

    it('should notify all students in a specific slot (notify-slot) and write EmailLogs', async () => {
      const period = await createTestPeriod({ schedulePublished: false });
      const coachId = new mongoose.Types.ObjectId();

      // Portal User 1 & Student 1
      const portalUser1 = await createTestPortalUser({
        email: 'student1@example.com',
        firstName: 'Student',
        lastName: 'Eins'
      });
      const student1 = await Student.create({
        firstName: 'Student',
        lastName: 'Eins',
        email: 'student1@example.com',
        periodId: period._id,
        studentPortalUserId: portalUser1._id,
        scheduleVisible: false,
        assignments: [
          {
            day: 'Donnerstag',
            hour: 16,
            venue: 'BTHV Traglufthalle',
            coach: coachId,
            group: 'KIDS-GRÜN'
          }
        ]
      });

      // Portal User 2 & Student 2
      const portalUser2 = await createTestPortalUser({
        email: 'student2@example.com',
        firstName: 'Student',
        lastName: 'Zwei'
      });
      const student2 = await Student.create({
        firstName: 'Student',
        lastName: 'Zwei',
        email: 'student2@example.com',
        periodId: period._id,
        studentPortalUserId: portalUser2._id,
        scheduleVisible: false,
        assignments: [
          {
            day: 'Donnerstag',
            hour: 16,
            venue: 'BTHV Traglufthalle',
            coach: coachId,
            group: 'KIDS-GRÜN'
          }
        ]
      });

      // Post notify-slot
      const res = await request(app)
        .post('/api/schedule-notifications/notify-slot')
        .send({
          periodId: period._id.toString(),
          day: 'Donnerstag',
          hour: 16,
          coachId: coachId.toString()
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.sentCount).toBe(2);
      expect(res.body.totalCount).toBe(2);

      // Verify both students have scheduleVisible = true
      const updated1 = await Student.findById(student1._id);
      const updated2 = await Student.findById(student2._id);
      expect(updated1.scheduleVisible).toBe(true);
      expect(updated2.scheduleVisible).toBe(true);

      // Verify EmailLog audit trail was created for both students
      const emailLogs = await EmailLog.find({ periodId: period._id, triggerType: 'slot' });
      expect(emailLogs.length).toBe(2);
      expect(emailLogs.map(l => l.studentName)).toContain('Student Eins');
      expect(emailLogs.map(l => l.studentName)).toContain('Student Zwei');
      expect(emailLogs[0].status).toBe('simulated');
      expect(emailLogs[0].templateType).toBe('schedule_notification');

      // Test GET /email-logs audit endpoint
      const resLogs = await request(app)
        .get('/api/schedule-notifications/email-logs')
        .query({ periodId: period._id.toString() });

      expect(resLogs.status).toBe(200);
      expect(resLogs.body.success).toBe(true);
      expect(resLogs.body.logs.length).toBe(2);
      expect(resLogs.body.total).toBe(2);
    });
  });

  describe('3. Student Portal Access Gate: GET /api/portal/schedule', () => {
    it('should gate access based on schedulePublished and scheduleVisible', async () => {
      const period = await createTestPeriod({ schedulePublished: false });

      const portalUser = await createTestPortalUser({
        email: 'max@example.com',
        firstName: 'Max',
        lastName: 'Mustermann',
        birthdate: new Date('1990-01-01')
      });

      const student = await Student.create({
        firstName: 'Max',
        lastName: 'Mustermann',
        email: 'max@example.com',
        periodId: period._id,
        studentPortalUserId: portalUser._id,
        scheduleVisible: false,
        assignments: [
          {
            day: 'Dienstag',
            hour: 16,
            venue: 'Brüser Berg',
            coach: new mongoose.Types.ObjectId(),
            group: 'KIDS-GRÜN'
          }
        ]
      });

      currentPortalUser = portalUser;

      // Case A: Unpublished & scheduleVisible=false
      // Portal should return 200 OK with empty schedule and schedulePublished: false
      const resBlocked = await request(app)
        .get('/api/portal/schedule')
        .query({ periodId: period._id.toString() });

      expect(resBlocked.status).toBe(200);
      expect(resBlocked.body.schedulePublished).toBe(false);
      expect(resBlocked.body.schedule).toEqual([]);

      // Case B: Per-Student Bypass (schedulePublished: false, but student.scheduleVisible: true)
      await Student.findByIdAndUpdate(student._id, { scheduleVisible: true });

      const resBypass = await request(app)
        .get('/api/portal/schedule')
        .query({ periodId: period._id.toString() });

      expect(resBypass.status).toBe(200);
      expect(resBypass.body.schedule.length).toBeGreaterThan(0);
      expect(resBypass.body.schedule[0].day).toBe('Dienstag');
      expect(resBypass.body.schedule[0].hour).toBe(16);

      // Case C: Globally Published (schedulePublished: true)
      await Student.findByIdAndUpdate(student._id, { scheduleVisible: false });
      await RegistrationPeriod.findByIdAndUpdate(period._id, { schedulePublished: true });

      const resPublished = await request(app)
        .get('/api/portal/schedule')
        .query({ periodId: period._id.toString() });

      expect(resPublished.status).toBe(200);
      expect(resPublished.body.schedulePublished).toBe(true);
      expect(resPublished.body.schedule.length).toBeGreaterThan(0);
      expect(resPublished.body.schedule[0].day).toBe('Dienstag');
    });
  });
});
