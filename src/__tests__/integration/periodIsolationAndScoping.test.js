/**
 * Multi-Season Period Isolation & Student Scoping Integration Tests
 *
 * Verifies:
 * 1. GET /api/students?periodId=... strictly scopes returned students to target period
 * 2. DELETE /api/students/all rejects un-scoped requests (missing/invalid periodId) with 400
 * 3. DELETE /api/students/all?periodId=... deletes only students of target period, leaving other periods untouched
 * 4. POST /api/registration-periods/:id/process-all guarantees cross-period isolation
 *    (existing student in Period A is NOT modified when processing a registration for same name in Period B)
 * 5. POST /api/registration-periods/:id/process-all guarantees sibling protection
 *    (siblings sharing identical parent email are created as separate students, not merged)
 */

import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Student from '../../models/Student.js';
import RegistrationPeriod from '../../models/RegistrationPeriod.js';
import SeasonalRegistration from '../../models/SeasonalRegistration.js';
import StudentPortalUser from '../../models/StudentPortalUser.js';
import User from '../../models/User.js';
import studentRoutes from '../../routes/students.js';
import registrationPeriodsRoutes from '../../routes/registrationPeriods.js';
import {
  connectTestDB,
  disconnectTestDB,
  clearTestDB,
  mockAuth
} from '../../testHelpers.js';

const app = express();
app.use(express.json());

const adminId = new mongoose.Types.ObjectId();
app.use((req, res, next) => {
  req.user = {
    _id: adminId,
    id: adminId,
    role: 'admin',
    firstName: 'Admin',
    lastName: 'User',
    email: 'admin@test.com'
  };
  next();
});

app.use('/api/students', studentRoutes);
app.use('/api/registration-periods', registrationPeriodsRoutes);

describe('Multi-Season Period Isolation & Student Scoping Tests', () => {
  let periodSummer;
  let periodWinter;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterEach(async () => {
    await clearTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  const setupPeriods = async () => {
    periodSummer = await RegistrationPeriod.create({
      name: 'Sommertraining 2026',
      season: 'summer',
      trainingStartDate: new Date('2026-04-15'),
      trainingEndDate: new Date('2026-09-30'),
      registrationDeadline: new Date('2026-04-01'),
      status: 'open',
      isActive: false,
      currentPlanId: new mongoose.Types.ObjectId(),
      createdBy: adminId
    });

    periodWinter = await RegistrationPeriod.create({
      name: 'Wintertraining 2026/27',
      season: 'winter',
      trainingStartDate: new Date('2026-10-01'),
      trainingEndDate: new Date('2027-04-15'),
      registrationDeadline: new Date('2026-09-15'),
      status: 'open',
      isActive: true,
      currentPlanId: new mongoose.Types.ObjectId(),
      createdBy: adminId
    });

    return { periodSummer, periodWinter };
  };

  describe('1. GET /api/students - Period Scoping', () => {
    it('should return ONLY students belonging to the requested periodId', async () => {
      const { periodSummer, periodWinter } = await setupPeriods();

      // Create students in Summer
      await Student.create([
        { firstName: 'Lukas', lastName: 'Sommer', email: 'lukas@test.com', periodId: periodSummer._id },
        { firstName: 'Mia', lastName: 'Sommer', email: 'mia@test.com', periodId: periodSummer._id }
      ]);

      // Create student in Winter
      await Student.create([
        { firstName: 'Jonas', lastName: 'Winter', email: 'jonas@test.com', periodId: periodWinter._id }
      ]);

      // Request Summer students
      const resSummer = await request(app)
        .get('/api/students')
        .query({ periodId: periodSummer._id.toString() })
        .expect(200);

      expect(resSummer.body).toHaveLength(2);
      expect(resSummer.body.map(s => s.firstName).sort()).toEqual(['Lukas', 'Mia']);

      // Request Winter students
      const resWinter = await request(app)
        .get('/api/students')
        .query({ periodId: periodWinter._id.toString() })
        .expect(200);

      expect(resWinter.body).toHaveLength(1);
      expect(resWinter.body[0].firstName).toBe('Jonas');
    });

    it('should return 400 when periodId is invalid format', async () => {
      const res = await request(app)
        .get('/api/students')
        .query({ periodId: 'invalid-mongo-id' })
        .expect(400);

      expect(res.body.error).toMatch(/periodId/i);
    });
  });

  describe('2. DELETE /api/students/all - Scoped Deletion & Data Loss Prevention', () => {
    it('should REJECT deletion without periodId with 400 (catastrophic wipe prevention)', async () => {
      const res = await request(app)
        .delete('/api/students/all')
        .expect(400);

      expect(res.body.error).toMatch(/periodId ist zwingend erforderlich/i);
    });

    it('should REJECT deletion with invalid periodId format with 400', async () => {
      const res = await request(app)
        .delete('/api/students/all')
        .query({ periodId: 'not-an-id' })
        .expect(400);

      expect(res.body.error).toMatch(/periodId/i);
    });

    it('should delete ONLY students in target period and leave other periods untouched', async () => {
      const { periodSummer, periodWinter } = await setupPeriods();

      // Summer students
      await Student.create([
        { firstName: 'S1', lastName: 'Sommer', email: 's1@test.com', periodId: periodSummer._id },
        { firstName: 'S2', lastName: 'Sommer', email: 's2@test.com', periodId: periodSummer._id }
      ]);

      // Winter students
      await Student.create([
        { firstName: 'W1', lastName: 'Winter', email: 'w1@test.com', periodId: periodWinter._id },
        { firstName: 'W2', lastName: 'Winter', email: 'w2@test.com', periodId: periodWinter._id }
      ]);

      // Delete Summer students only
      const res = await request(app)
        .delete('/api/students/all')
        .query({ periodId: periodSummer._id.toString() })
        .expect(200);

      expect(res.body.deletedCount).toBe(2);

      // Verify Summer students are gone
      const remainingSummer = await Student.find({ periodId: periodSummer._id });
      expect(remainingSummer).toHaveLength(0);

      // Verify Winter students are completely preserved!
      const remainingWinter = await Student.find({ periodId: periodWinter._id });
      expect(remainingWinter).toHaveLength(2);
      expect(remainingWinter.map(s => s.firstName).sort()).toEqual(['W1', 'W2']);
    });
  });

  describe('3. Cross-Period Isolation during Bulk Processing (process-all)', () => {
    it('should NOT overwrite existing student from Period A when processing registration in Period B', async () => {
      const { periodSummer, periodWinter } = await setupPeriods();

      // Lukas is an active player in Summer 2026 with 60min, team=true, specific slots
      const summerStudent = await Student.create({
        periodId: periodSummer._id,
        firstName: 'Lukas',
        lastName: 'Becker',
        email: 'lukas.becker@test.com',
        birthDate: '2012-05-10',
        adult: false,
        member: true,
        team: true,
        trainigGroup: 'Rot',
        frequence: '1',
        sessionDuration: 60,
        availableTimes: [{ day: 'Montag', hour: 15, venue: 'Freiplatz' }]
      });

      // Lukas now registers for Winter 2026/27 with new preferences (Gelb, 90min, 2x/week)
      const winterRegistration = await SeasonalRegistration.create({
        periodId: periodWinter._id,
        studentPortalUserId: new mongoose.Types.ObjectId(),
        formType: 'kids',
        firstName: 'Lukas',
        lastName: 'Becker',
        birthdate: new Date('2012-05-10'),
        email: 'lukas.becker@test.com',
        phone: '0171 1234567',
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'Jugend TEAM (Gelb)',
        trainingshäufigkeit: '2x pro Woche',
        sessionDuration: 90,
        teamParticipation: true,
        availableTimesKids: [
          { day: 'Dienstag', hour: 16, venue: 'BTHV' },
          { day: 'Donnerstag', hour: 17, venue: 'BTHV' }
        ],
        privacyConsent: true,
        status: 'pending'
      });

      // Execute bulk processing for WINTER
      const res = await request(app)
        .post(`/api/registration-periods/${periodWinter._id}/process-all`)
        .expect(200);

      expect(res.body.processed).toBe(1);

      // Summer student must be UNTOUCHED
      const summerStudentReloaded = await Student.findById(summerStudent._id);
      expect(summerStudentReloaded.periodId.toString()).toBe(periodSummer._id.toString());
      expect(summerStudentReloaded.trainigGroup).toBe('Rot');
      expect(summerStudentReloaded.sessionDuration).toBe(60);
      expect(summerStudentReloaded.availableTimes[0].venue).toBe('Freiplatz');

      // A completely NEW Student record must exist for Winter
      const winterStudents = await Student.find({ periodId: periodWinter._id });
      expect(winterStudents).toHaveLength(1);
      const winterStudent = winterStudents[0];
      expect(winterStudent._id.toString()).not.toBe(summerStudent._id.toString());
      expect(winterStudent.firstName).toBe('Lukas');
      expect(winterStudent.lastName).toBe('Becker');
      expect(winterStudent.trainigGroup).toBe('Gelb Team');
      expect(winterStudent.sessionDuration).toBe(90);
      expect(winterStudent.frequence).toBe('2');

      // Total students in DB across all periods = 2 (1 Summer + 1 Winter)
      const totalStudents = await Student.find({});
      expect(totalStudents).toHaveLength(2);
    });
  });

  describe('4. Sibling Protection during Bulk Processing (process-all)', () => {
    it('should create separate Student records for siblings sharing the identical parent email', async () => {
      const { periodWinter } = await setupPeriods();

      const parentPortalUser = await StudentPortalUser.create({
        firstName: 'Klaus',
        lastName: 'Müller',
        email: 'familie.mueller@test.com',
        password: 'hashedpassword',
        birthdate: new Date('1980-01-01'),
        emailVerified: true,
        profileCompleted: true,
        familyMembers: [
          { firstName: 'Finn', lastName: 'Müller', birthdate: new Date('2014-03-10'), relationship: 'child' },
          { firstName: 'Lina', lastName: 'Müller', birthdate: new Date('2016-07-22'), relationship: 'child' }
        ]
      });

      const finnMemberId = parentPortalUser.familyMembers[0]._id;
      const linaMemberId = parentPortalUser.familyMembers[1]._id;

      // Registration 1: Finn Müller (shares parent email)
      await SeasonalRegistration.create({
        periodId: periodWinter._id,
        studentPortalUserId: parentPortalUser._id,
        familyMemberId: finnMemberId,
        formType: 'kids',
        firstName: 'Finn',
        lastName: 'Müller',
        birthdate: new Date('2014-03-10'),
        email: 'familie.mueller@test.com', // Shared parent email
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'KIDS-ORANGE (ca. 8-10 Jahre)',
        trainingshäufigkeit: '1x pro Woche',
        availableTimesKids: [
          { day: 'Montag', hour: 15, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 15, venue: 'BTHV' }
        ],
        privacyConsent: true,
        status: 'pending'
      });

      // Registration 2: Lina Müller (shares parent email)
      await SeasonalRegistration.create({
        periodId: periodWinter._id,
        studentPortalUserId: parentPortalUser._id,
        familyMemberId: linaMemberId,
        formType: 'kids',
        firstName: 'Lina',
        lastName: 'Müller',
        birthdate: new Date('2016-07-22'),
        email: 'familie.mueller@test.com', // Shared parent email
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'KIDS-ROT (ca. 6-8 Jahre)',
        trainingshäufigkeit: '1x pro Woche',
        availableTimesKids: [
          { day: 'Dienstag', hour: 14, venue: 'BTHV' },
          { day: 'Donnerstag', hour: 14, venue: 'BTHV' }
        ],
        privacyConsent: true,
        status: 'pending'
      });

      // Execute bulk processing
      const res = await request(app)
        .post(`/api/registration-periods/${periodWinter._id}/process-all`)
        .expect(200);

      expect(res.body.processed).toBe(2);

      // Verify that TWO distinct Student records exist in the period
      const winterStudents = await Student.find({ periodId: periodWinter._id });
      expect(winterStudents).toHaveLength(2);

      const finnStudent = winterStudents.find(s => s.firstName === 'Finn');
      const linaStudent = winterStudents.find(s => s.firstName === 'Lina');

      expect(finnStudent).toBeDefined();
      expect(linaStudent).toBeDefined();
      expect(finnStudent._id.toString()).not.toBe(linaStudent._id.toString());

      // Check correct mapping per child
      expect(finnStudent.trainigGroup).toBe('Orange');
      expect(finnStudent.familyMemberId.toString()).toBe(finnMemberId.toString());
      expect(finnStudent.email).toBe('familie.mueller@test.com');

      expect(linaStudent.trainigGroup).toBe('Rot');
      expect(linaStudent.familyMemberId.toString()).toBe(linaMemberId.toString());
      expect(linaStudent.email).toBe('familie.mueller@test.com');

      // Both registrations are linked to their respective studentId
      const finnReg = await SeasonalRegistration.findOne({ familyMemberId: finnMemberId });
      const linaReg = await SeasonalRegistration.findOne({ familyMemberId: linaMemberId });

      expect(finnReg.status).toBe('processed');
      expect(finnReg.studentId.toString()).toBe(finnStudent._id.toString());

      expect(linaReg.status).toBe('processed');
      expect(linaReg.studentId.toString()).toBe(linaStudent._id.toString());
    });
  });
});
