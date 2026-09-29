/**
 * Security Hardening Integration Tests
 *
 * Verifies fixes for SEC-01 through SEC-04:
 * - SEC-01: Name-based student matching in portal seasonal registration prevents account takeover/hijacking
 * - SEC-02: DELETE /api/students/all enforces mandatory and valid periodId (no global wipeout)
 * - SEC-03: POST /api/saved-schedules/:id/load blocks plans without periodId (no global deleteMany fallback)
 * - SEC-04: Input validation of periodId prevents CastErrors (400 instead of 500)
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
import StudentPortalUser from '../../models/StudentPortalUser.js';
import RegistrationPeriod from '../../models/RegistrationPeriod.js';
import SavedSchedule from '../../models/SavedSchedule.js';

import studentsRoutes from '../students.js';
import savedSchedulesRoutes from '../savedSchedules.js';
import portalScheduleRoutes from '../portalSchedule.js';
import portalSeasonalRegistrationsRoutes from '../portalSeasonalRegistrations.js';

// Setup Express app
const app = express();
app.use(express.json());

// Mock portal user middleware for portal routes
let currentPortalUser = null;
const mockPortalAuth = (req, res, next) => {
  if (currentPortalUser) {
    req.portalUser = currentPortalUser;
    req.user = currentPortalUser;
    return next();
  }
  return res.status(401).json({ error: 'Nicht autorisiert' });
};

// Mount admin routes
app.use('/api/students', mockAuth(), studentsRoutes);
app.use('/api/saved-schedules', mockAuth(), savedSchedulesRoutes);

// Mount portal routes
app.use('/api/portal', mockPortalAuth, portalScheduleRoutes);
app.use('/api/portal/seasonal-registrations', mockPortalAuth, portalSeasonalRegistrationsRoutes);

describe('Security Hardening Audit Tests (SEC-01 to SEC-04)', () => {
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

  // -------------------------------------------------------------------------
  // SEC-01: Student Hijacking / Account Takeover Prevention
  // -------------------------------------------------------------------------
  describe('SEC-01: Student Matching Isolation across Portal Users', () => {
    it('should NOT overwrite or reassign existing student if student belongs to another portal user', async () => {
      // 1. Create a registration period
      const period = await RegistrationPeriod.create({
        name: 'Winter 2026/2027',
        season: 'winter',
        year: 2026,
        status: 'open',
        isActive: true,
        startDate: new Date('2026-10-01'),
        endDate: new Date('2027-04-01'),
        trainingStartDate: new Date('2026-10-15'),
        trainingEndDate: new Date('2027-03-31'),
        registrationDeadline: new Date('2026-10-10'),
        currentPlanId: new mongoose.Types.ObjectId(),
        createdBy: new mongoose.Types.ObjectId(),
        allowPublicRegistration: true
      });

      // 2. Create User A and an existing student for User A with name "Max Mustermann"
      const userA = await StudentPortalUser.create({
        email: 'userA@example.com',
        password: 'hashedpassword123',
        firstName: 'Anna',
        lastName: 'Mustermann',
        birthdate: new Date('1980-01-01'),
        emailVerified: true,
        profileCompleted: true
      });

      const studentA = await Student.create({
        periodId: period._id,
        studentPortalUserId: userA._id,
        firstName: 'Max',
        lastName: 'Mustermann',
        birthDate: '2015-05-01',
        email: 'userA@example.com',
        adult: false,
        member: true,
        availableTimes: [{ day: 'Montag', hour: 15, venue: '' }]
      });

      // 3. User B (different family) registers a child also named "Max Mustermann"
      const userB = await StudentPortalUser.create({
        email: 'userB@example.com',
        password: 'hashedpassword123',
        firstName: 'Bernd',
        lastName: 'Mustermann',
        birthdate: new Date('1982-02-02'),
        emailVerified: true,
        profileCompleted: true
      });

      currentPortalUser = userB;

      const regPayload = {
        periodId: period._id.toString(),
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Mustermann',
        birthdate: '2016-06-06',
        email: 'userB@example.com',
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'ROT (ca. 6–8 Jahre)',
        trainingshäufigkeit: '1x pro Woche',
        availableTimesKids: [
          { day: 'Dienstag', hour: 16, venue: '' },
          { day: 'Mittwoch', hour: 16, venue: '' }
        ],
        sepaMandate: true,
        accountHolder: 'Bernd Mustermann',
        iban: 'DE89370400440532013000',
        privacyConsent: true,
        paymentConsent: true
      };

      const res = await request(app)
        .post('/api/portal/seasonal-registrations')
        .send(regPayload);

      expect(res.status).toBe(201);

      // 4. Verify User A's student was NOT hijacked or modified
      const originalStudentA = await Student.findById(studentA._id);
      expect(originalStudentA.studentPortalUserId.toString()).toBe(userA._id.toString());
      expect(originalStudentA.birthDate).toBe('2015-05-01');
      expect(originalStudentA.email.toLowerCase()).toBe('usera@example.com');

      // 5. Verify a new separate student was created for User B
      const studentsForPeriod = await Student.find({ periodId: period._id, firstName: 'Max', lastName: 'Mustermann' });
      expect(studentsForPeriod.length).toBe(2);

      const studentB = studentsForPeriod.find(s => s._id.toString() !== studentA._id.toString());
      expect(studentB).toBeDefined();
      expect(studentB.studentPortalUserId.toString()).toBe(userB._id.toString());
      expect(studentB.email.toLowerCase()).toBe('userb@example.com');
    });
  });

  // -------------------------------------------------------------------------
  // SEC-02: Total-Wipeout Prevention on DELETE /api/students/all
  // -------------------------------------------------------------------------
  describe('SEC-02: DELETE /api/students/all periodId constraint', () => {
    it('should reject DELETE /all without periodId with HTTP 400', async () => {
      const res = await request(app).delete('/api/students/all');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('periodId ist zwingend erforderlich');
    });

    it('should reject DELETE /all with invalid periodId format with HTTP 400', async () => {
      const res = await request(app).delete('/api/students/all?periodId=not-a-valid-hex');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('periodId ist zwingend erforderlich');
    });

    it('should delete ONLY students of target period and preserve other periods', async () => {
      const period1Id = new mongoose.Types.ObjectId();
      const period2Id = new mongoose.Types.ObjectId();

      await Student.create([
        { periodId: period1Id, firstName: 'Student1', lastName: 'P1', birthDate: '2010-01-01', email: 's1@test.de' },
        { periodId: period1Id, firstName: 'Student2', lastName: 'P1', birthDate: '2010-01-01', email: 's2@test.de' },
        { periodId: period2Id, firstName: 'Student3', lastName: 'P2', birthDate: '2010-01-01', email: 's3@test.de' }
      ]);

      const res = await request(app).delete(`/api/students/all?periodId=${period1Id.toString()}`);
      expect(res.status).toBe(200);
      expect(res.body.deletedCount).toBe(2);

      const remainingStudents = await Student.find({});
      expect(remainingStudents.length).toBe(1);
      expect(remainingStudents[0].periodId.toString()).toBe(period2Id.toString());
    });
  });

  // -------------------------------------------------------------------------
  // SEC-03: Safe Plan Restore without periodId
  // -------------------------------------------------------------------------
  describe('SEC-03: POST /api/saved-schedules/:id/load safety', () => {
    it('should reject loading a saved schedule without periodId with HTTP 400', async () => {
      // Create a saved schedule without periodId
      const legacySchedule = await SavedSchedule.create({
        name: 'Legacy Plan without Period',
        createdBy: 'test-admin-id',
        createdByEmail: 'admin@example.com',
        schedule: [],
        students: [],
        coaches: [],
        studentsNotSet: [],
        metadata: {
          studentCount: 0,
          coachCount: 0,
          courseCount: 0,
          possibleCourseCount: 0,
          unassignedCount: 0
        }
      });

      const res = await request(app).post(`/api/saved-schedules/${legacySchedule._id}/load`);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('periodId fehlt');
    });
  });

  // -------------------------------------------------------------------------
  // SEC-04: Input Validation against CastErrors
  // -------------------------------------------------------------------------
  describe('SEC-04: Input validation for periodId queries', () => {
    it('GET /api/students should return 400 on invalid periodId format', async () => {
      const res = await request(app).get('/api/students?periodId=malformed-id');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Ungültiges periodId-Format');
    });

    it('GET /api/portal/schedule should return 400 on invalid periodId format', async () => {
      const user = await StudentPortalUser.create({
        email: 'user@test.de',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        birthdate: new Date('1990-01-01'),
        emailVerified: true
      });
      currentPortalUser = user;

      const res = await request(app).get('/api/portal/schedule?periodId=malformed-id');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Ungültiges periodId-Format');
    });
  });
});
