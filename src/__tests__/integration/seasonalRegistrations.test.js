import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import RegistrationPeriod from '../../models/RegistrationPeriod.js';
import SeasonalRegistration from '../../models/SeasonalRegistration.js';
import Student from '../../models/Student.js';
import StudentPortalUser from '../../models/StudentPortalUser.js';
import seasonalRegistrationsRoutes from '../../routes/seasonalRegistrations.js';
import { encryptIBAN } from '../../utils/encryption.js';
import {
  connectTestDB,
  disconnectTestDB,
  clearTestDB,
  mockAuth,
} from '../../testHelpers.js';

// Create Express app for testing
const app = express();
app.use(express.json());
app.use(cookieParser());

// Shared mock admin ObjectId (used for req.user and RegistrationPeriod.createdBy)
const mockAdminId = new mongoose.Types.ObjectId();

// Use mock admin authentication (mockAuth returns a middleware)
app.use(mockAuth(mockAdminId));
app.use('/api/seasonal-registrations', seasonalRegistrationsRoutes);

describe('Seasonal Registrations Admin API Integration Tests', () => {
  let testPeriod;
  let testPortalUser;
  // adminUser is a plain object with _id so it can be used in RegistrationPeriod.createdBy
  const adminUser = { _id: mockAdminId, id: mockAdminId, role: 'admin' };

  beforeAll(async () => {
    await connectTestDB();
  });

  afterEach(async () => {
    await clearTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  // Helper to create test data
  const createTestData = async () => {
    testPeriod = await RegistrationPeriod.create({
      name: 'Wintertraining 2025/26',
      season: 'winter',
      trainingStartDate: new Date('2025-09-01'),
      trainingEndDate: new Date('2026-06-30'),
      registrationDeadline: new Date('2025-08-15'),
      status: 'open',
      currentPlanId: new mongoose.Types.ObjectId(),
      isActive: true,
      createdBy: adminUser._id,
    });

    testPortalUser = await StudentPortalUser.create({
      email: 'parent@test.com',
      password: 'testpassword123',
      firstName: 'Parent',
      lastName: 'Test',
      birthdate: new Date('1985-01-01'),
      emailVerified: true,
    });

    return { testPeriod, testPortalUser };
  };

  describe('GET / - List all submissions', () => {
    beforeEach(async () => {
      await createTestData();

      // Create 3 submissions with different statuses
      // Use distinct familyMemberId to avoid unique partial index conflict on {studentPortalUserId, periodId, familyMemberId}
      const [fam1, fam2, fam3] = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
      await SeasonalRegistration.create([
        {
          periodId: testPeriod._id,
          studentPortalUserId: testPortalUser._id,
          familyMemberId: fam1,
          formType: 'kids',
          firstName: 'Max',
          lastName: 'Test',
          birthdate: new Date('2010-05-15'),
          email: 'max@test.com',
          availableTimesKids: [
            { day: 'Montag', hour: 14, venue: 'BTHV' },
            { day: 'Montag', hour: 15, venue: 'BTHV' },
            { day: 'Mittwoch', hour: 16, venue: 'Brüser Berg' },
            { day: 'Donnerstag', hour: 17, venue: 'Röttgen' },
            { day: 'Freitag', hour: 15, venue: 'BTHV' },
          ],
          mitgliedsstatus: 'Mitglied',
          trainingsart: 'Jugend TEAM (Gelb)',
          privacyConsent: true,
          status: 'pending',
        },
        {
          periodId: testPeriod._id,
          studentPortalUserId: testPortalUser._id,
          familyMemberId: fam2,
          formType: 'adults',
          firstName: 'Sandra',
          lastName: 'Test',
          birthdate: new Date('1980-03-20'),
          email: 'sandra@test.com',
          availableTimesAdults: [
            { day: 'Montag', hour: '18:00', venue: 'BTHV' },
            { day: 'Dienstag', hour: '19:00', venue: 'BTHV' },
            { day: 'Mittwoch', hour: '18:00', venue: 'Brüser Berg' },
            { day: 'Donnerstag', hour: '19:00', venue: 'Röttgen' },
            { day: 'Freitag', hour: '18:00', venue: 'BTHV' },
          ],
          spielstärke: 'Fortgeschrittene',
          privacyConsent: true,
          status: 'processed',
        },
        {
          periodId: testPeriod._id,
          studentPortalUserId: testPortalUser._id,
          familyMemberId: fam3,
          formType: 'kids',
          firstName: 'Anna',
          lastName: 'Test',
          birthdate: new Date('2012-03-20'),
          email: 'anna@test.com',
          availableTimesKids: [
            { day: 'Montag', hour: 14, venue: 'BTHV' },
            { day: 'Montag', hour: 15, venue: 'BTHV' },
            { day: 'Mittwoch', hour: 16, venue: 'Brüser Berg' },
            { day: 'Donnerstag', hour: 17, venue: 'Röttgen' },
            { day: 'Freitag', hour: 15, venue: 'BTHV' },
          ],
          mitgliedsstatus: 'Mitglied',
          trainingsart: 'KIDS-ROT (ca. 6-8 Jahre)',
          privacyConsent: true,
          status: 'rejected',
          rejectionReason: 'Test rejection',
        },
      ]);
    });

    it('should list all submissions', async () => {
      const response = await request(app)
        .get('/api/seasonal-registrations')
        .expect(200);

      expect(response.body.registrations).toHaveLength(3);
    });

    it('should filter submissions by status', async () => {
      const response = await request(app)
        .get('/api/seasonal-registrations?status=pending')
        .expect(200);

      expect(response.body.registrations).toHaveLength(1);
      expect(response.body.registrations[0].status).toBe('pending');
    });

    it('should filter submissions by form type', async () => {
      const response = await request(app)
        .get('/api/seasonal-registrations?formType=adults')
        .expect(200);

      expect(response.body.registrations).toHaveLength(1);
      expect(response.body.registrations[0].formType).toBe('adults');
    });

    it('should filter submissions by period ID', async () => {
      // Create another period with different submission
      const anotherPeriod = await RegistrationPeriod.create({
        name: 'Sommertraining 2025',
        season: 'summer',
        trainingStartDate: new Date('2025-07-01'),
        trainingEndDate: new Date('2025-08-31'),
        registrationDeadline: new Date('2025-06-15'),
        status: 'draft',
        createdBy: adminUser._id,
      });

      await SeasonalRegistration.create({
        periodId: anotherPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'kids',
        firstName: 'Different',
        lastName: 'Period',
        birthdate: new Date('2010-05-15'),
        email: 'different@test.com',
        availableTimesKids: [
          { day: 'Montag', hour: 14, venue: 'BTHV' },
          { day: 'Montag', hour: 15, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 16, venue: 'Brüser Berg' },
          { day: 'Donnerstag', hour: 17, venue: 'Röttgen' },
          { day: 'Freitag', hour: 15, venue: 'BTHV' },
        ],
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'Jugend TEAM (Gelb)',
        privacyConsent: true,
        status: 'pending',
      });

      const response = await request(app)
        .get(`/api/seasonal-registrations?periodId=${testPeriod._id}`)
        .expect(200);

      expect(response.body.registrations).toHaveLength(3); // Only from testPeriod
    });

    it('should mask IBAN in list view', async () => {
      // Create submission with SEPA/IBAN
      await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'adults',
        firstName: 'With IBAN',
        lastName: 'Test',
        birthdate: new Date('1980-03-20'),
        email: 'iban@test.com',
        availableTimesAdults: [
          { day: 'Montag', hour: '18:00', venue: 'BTHV' },
          { day: 'Dienstag', hour: '19:00', venue: 'BTHV' },
          { day: 'Mittwoch', hour: '18:00', venue: 'Brüser Berg' },
          { day: 'Donnerstag', hour: '19:00', venue: 'Röttgen' },
          { day: 'Freitag', hour: '18:00', venue: 'BTHV' },
        ],
        spielstärke: 'Fortgeschrittene',
        sepaMandate: true,
        accountHolder: 'Test User',
        iban: encryptIBAN('DE89370400440532013000'),
        privacyConsent: true,
        status: 'pending',
      });

      const response = await request(app)
        .get('/api/seasonal-registrations')
        .expect(200);

      const ibanSubmission = response.body.registrations.find((s) => s.firstName === 'With IBAN');
      expect(ibanSubmission.ibanMasked).toMatch(/^DE\*\*\*\*\d{4}$/); // DE****3000 format
    });
  });

  describe('GET /:id - Get specific submission', () => {
    it('should return full submission details with decrypted IBAN', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const encryptedIBAN = encryptIBAN('DE89370400440532013000');

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'adults',
        firstName: 'Sandra',
        lastName: 'Test',
        birthdate: new Date('1980-03-20'),
        email: 'sandra@test.com',
        phone: '0151 98765432',
        address: 'Teststraße 1, 12345 Teststadt',
        availableTimesAdults: [
          { day: 'Montag', hour: '18:00', venue: 'BTHV' },
          { day: 'Dienstag', hour: '19:00', venue: 'BTHV' },
          { day: 'Mittwoch', hour: '18:00', venue: 'Brüser Berg' },
          { day: 'Donnerstag', hour: '19:00', venue: 'Röttgen' },
          { day: 'Freitag', hour: '18:00', venue: 'BTHV' },
        ],
        spielstärke: 'Fortgeschrittene',
        trainingGoals: ['Fitness', 'Turniere'],
        groupSize: ['zu dritt'],
        sepaMandate: true,
        accountHolder: 'Sandra Test',
        iban: encryptedIBAN,
        privacyConsent: true,
        status: 'pending',
      });

      const response = await request(app)
        .get(`/api/seasonal-registrations/${registration._id}`)
        .expect(200);

      expect(response.body.registration).toBeDefined();
      expect(response.body.registration.firstName).toBe('Sandra');
      expect(response.body.registration.spielstärke).toBe('Fortgeschrittene');
      expect(response.body.registration.ibanFull).toBeUndefined(); // Removed for security (B2-H3)
      expect(response.body.registration.ibanMasked).toBeDefined(); // Only masked IBAN in response
      expect(response.body.registration.sepaMandate).toBe(true);
    });

    it('should return 404 for non-existent submission', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      await request(app).get(`/api/seasonal-registrations/${fakeId}`).expect(404);
    });
  });

  describe('PUT /:id - Update pending submission', () => {
    it('should update pending submission successfully', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Test',
        birthdate: new Date('2010-05-15'),
        email: 'max@test.com',
        availableTimesKids: [
          { day: 'Montag', hour: 14, venue: 'BTHV' },
          { day: 'Montag', hour: 15, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 16, venue: 'Brüser Berg' },
          { day: 'Donnerstag', hour: 17, venue: 'Röttgen' },
          { day: 'Freitag', hour: 15, venue: 'BTHV' },
        ],
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'Jugend TEAM (Gelb)',
        privacyConsent: true,
        status: 'pending',
      });

      const updatedData = {
        trainingsart: 'Jugend HOBBY (Gelb)',
        trainingshäufigkeit: '2x pro Woche',
        phone: '0151 12345678',
      };

      const response = await request(app)
        .put(`/api/seasonal-registrations/${registration._id}`)
        .send(updatedData)
        .expect(200);

      expect(response.body.registration.trainingsart).toBe('Jugend HOBBY (Gelb)');
      expect(response.body.registration.trainingshäufigkeit).toBe('2x pro Woche');
      expect(response.body.registration.phone).toBe('0151 12345678');
    });

    it('should prevent updating processed submission', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Test',
        birthdate: new Date('2010-05-15'),
        email: 'max@test.com',
        availableTimesKids: [
          { day: 'Montag', hour: 14, venue: 'BTHV' },
          { day: 'Montag', hour: 15, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 16, venue: 'Brüser Berg' },
          { day: 'Donnerstag', hour: 17, venue: 'Röttgen' },
          { day: 'Freitag', hour: 15, venue: 'BTHV' },
        ],
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'Jugend TEAM (Gelb)',
        privacyConsent: true,
        status: 'processed',
      });

      const updatedData = {
        trainingsart: 'Jugend HOBBY (Gelb)',
      };

      const response = await request(app)
        .put(`/api/seasonal-registrations/${registration._id}`)
        .send(updatedData)
        .expect(400);

      expect(response.body.error).toMatch(/verarbeitet|processed/i);
    });
  });

  describe('DELETE /:id - Delete pending submission', () => {
    it('should delete pending submission successfully', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Test',
        birthdate: new Date('2010-05-15'),
        email: 'max@test.com',
        availableTimesKids: [
          { day: 'Montag', hour: 14, venue: 'BTHV' },
          { day: 'Montag', hour: 15, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 16, venue: 'Brüser Berg' },
          { day: 'Donnerstag', hour: 17, venue: 'Röttgen' },
          { day: 'Freitag', hour: 15, venue: 'BTHV' },
        ],
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'Jugend TEAM (Gelb)',
        privacyConsent: true,
        status: 'pending',
      });

      const response = await request(app)
        .delete(`/api/seasonal-registrations/${registration._id}`)
        .expect(200);

      expect(response.body.message).toMatch(/gelöscht|deleted/i);

      // Verify registration is deleted
      const deletedReg = await SeasonalRegistration.findById(registration._id);
      expect(deletedReg).toBeNull();
    });

    it('should prevent deleting processed submission', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Test',
        birthdate: new Date('2010-05-15'),
        email: 'max@test.com',
        availableTimesKids: [
          { day: 'Montag', hour: 14, venue: 'BTHV' },
          { day: 'Montag', hour: 15, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 16, venue: 'Brüser Berg' },
          { day: 'Donnerstag', hour: 17, venue: 'Röttgen' },
          { day: 'Freitag', hour: 15, venue: 'BTHV' },
        ],
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'Jugend TEAM (Gelb)',
        privacyConsent: true,
        status: 'processed',
      });

      const response = await request(app)
        .delete(`/api/seasonal-registrations/${registration._id}`)
        .expect(400);

      expect(response.body.error).toMatch(/ausstehende|pending/i);
    });
  });

  describe('POST /:id/process - Process single submission', () => {
    it('should process submission and create student record', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Test',
        birthdate: new Date('2010-05-15'),
        email: 'max@test.com',
        phone: '0151 12345678',
        address: 'Teststraße 1, 12345 Teststadt',
        availableTimesKids: [
          { day: 'Montag', hour: 14, venue: 'BTHV' },
          { day: 'Montag', hour: 15, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 16, venue: 'Brüser Berg' },
          { day: 'Donnerstag', hour: 17, venue: 'Röttgen' },
          { day: 'Freitag', hour: 15, venue: 'BTHV' },
        ],
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'Jugend TEAM (Gelb)',
        trainingshäufigkeit: '2x pro Woche',
        teamParticipation: 'Team',
        privacyConsent: true,
        status: 'pending',
      });

      const response = await request(app)
        .post(`/api/seasonal-registrations/${registration._id}/process`)
        .expect(200);

      expect(response.body.message).toMatch(/verarbeitet|processed/i);

      // Verify student was created
      const student = await Student.findOne({ email: 'max@test.com' });
      expect(student).toBeDefined();
      expect(student.firstName).toBe('Max');
      expect(student.trainigGroup).toBe('Gelb Team'); // mapped from 'Jugend TEAM (Gelb)'
      expect(student.frequence).toBe('2');
      expect(student.member).toBe(true);
      expect(student.team).toBe(true); // teamParticipation truthy → team=true (Boolean cast from 'Team')
      expect(student.adult).toBe(false);

      // Verify registration is marked as processed
      const updatedReg = await SeasonalRegistration.findById(registration._id);
      expect(updatedReg.status).toBe('processed');
      expect(updatedReg.studentId).toEqual(student._id);
      expect(updatedReg.processedBy).toBeDefined();
      expect(updatedReg.processedAt).toBeDefined();
    });

    it('should process adults submission and create adult student', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'adults',
        firstName: 'Sandra',
        lastName: 'Test',
        birthdate: new Date('1980-03-20'),
        email: 'sandra@test.com',
        phone: '0151 98765432',
        address: 'Teststraße 2, 12345 Teststadt',
        availableTimesAdults: [
          { day: 'Montag', hour: '18:00', venue: 'BTHV' },
          { day: 'Dienstag', hour: '19:00', venue: 'BTHV' },
          { day: 'Mittwoch', hour: '18:00', venue: 'Brüser Berg' },
          { day: 'Donnerstag', hour: '19:00', venue: 'Röttgen' },
          { day: 'Freitag', hour: '18:00', venue: 'BTHV' },
        ],
        spielstärke: 'Fortgeschrittene',
        trainingGoals: ['Fitness', 'Turniere'],
        groupSize: ['zu dritt', 'zu viert'],
        privacyConsent: true,
        status: 'pending',
      });

      const response = await request(app)
        .post(`/api/seasonal-registrations/${registration._id}/process`)
        .expect(200);

      expect(response.body.message).toMatch(/verarbeitet|processed/i);

      // Verify student was created
      const student = await Student.findOne({ email: 'sandra@test.com' });
      expect(student).toBeDefined();
      expect(student.firstName).toBe('Sandra');
      expect(student.skillLevel).toBe('Fortgeschrittene');
      expect(student.adult).toBe(true);
      expect(student.frequence).toBe('1'); // Adults default to 1 session/week
    });

    it('should update existing student if email matches', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      // Create existing student
      const existingStudent = await Student.create({
        firstName: 'Max',
        lastName: 'Old',
        email: 'max@test.com',
        birthDate: new Date('2010-05-15'),
        adult: false,
        trainigGroup: 'Orange',
      });

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Updated',
        birthdate: new Date('2010-05-15'),
        email: 'max@test.com', // Same email
        availableTimesKids: [
          { day: 'Montag', hour: 14, venue: 'BTHV' },
          { day: 'Montag', hour: 15, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 16, venue: 'Brüser Berg' },
          { day: 'Donnerstag', hour: 17, venue: 'Röttgen' },
          { day: 'Freitag', hour: 15, venue: 'BTHV' },
        ],
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'Jugend TEAM (Gelb)',
        privacyConsent: true,
        status: 'pending',
      });

      await request(app)
        .post(`/api/seasonal-registrations/${registration._id}/process`)
        .expect(200);

      // Verify student was updated (not created new)
      const students = await Student.find({});
      expect(students).toHaveLength(1);

      const updatedStudent = students[0];
      expect(updatedStudent._id.toString()).toBe(existingStudent._id.toString());
      expect(updatedStudent.lastName).toBe('Updated');
      expect(updatedStudent.trainigGroup).toBe('Gelb Team');
    });

    it('should prevent processing already processed submission', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Test',
        birthdate: new Date('2010-05-15'),
        email: 'max@test.com',
        availableTimesKids: [
          { day: 'Montag', hour: 14, venue: 'BTHV' },
          { day: 'Montag', hour: 15, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 16, venue: 'Brüser Berg' },
          { day: 'Donnerstag', hour: 17, venue: 'Röttgen' },
          { day: 'Freitag', hour: 15, venue: 'BTHV' },
        ],
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'Jugend TEAM (Gelb)',
        privacyConsent: true,
        status: 'processed',
      });

      const response = await request(app)
        .post(`/api/seasonal-registrations/${registration._id}/process`)
        .expect(400);

      expect(response.body.error).toMatch(/bereits|already/i);
    });
  });

  describe('POST /:id/reject - Reject submission', () => {
    it('should reject submission with reason', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Test',
        birthdate: new Date('2010-05-15'),
        email: 'max@test.com',
        availableTimesKids: [
          { day: 'Montag', hour: 14, venue: 'BTHV' },
          { day: 'Montag', hour: 15, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 16, venue: 'Brüser Berg' },
          { day: 'Donnerstag', hour: 17, venue: 'Röttgen' },
          { day: 'Freitag', hour: 15, venue: 'BTHV' },
        ],
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'Jugend TEAM (Gelb)',
        privacyConsent: true,
        status: 'pending',
      });

      const rejectionData = {
        reason: 'Keine Plätze verfügbar für Gelb Team',
      };

      const response = await request(app)
        .post(`/api/seasonal-registrations/${registration._id}/reject`)
        .send(rejectionData)
        .expect(200);

      expect(response.body.message).toMatch(/abgelehnt|rejected/i);

      // Verify registration is rejected
      const updatedReg = await SeasonalRegistration.findById(registration._id);
      expect(updatedReg.status).toBe('rejected');
      expect(updatedReg.rejectionReason).toBe('Keine Plätze verfügbar für Gelb Team');
      expect(updatedReg.processedBy).toBeDefined();
      expect(updatedReg.processedAt).toBeDefined();
    });

    it('should require rejection reason', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Test',
        birthdate: new Date('2010-05-15'),
        email: 'max@test.com',
        availableTimesKids: [
          { day: 'Montag', hour: 14, venue: 'BTHV' },
          { day: 'Montag', hour: 15, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 16, venue: 'Brüser Berg' },
          { day: 'Donnerstag', hour: 17, venue: 'Röttgen' },
          { day: 'Freitag', hour: 15, venue: 'BTHV' },
        ],
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'Jugend TEAM (Gelb)',
        privacyConsent: true,
        status: 'pending',
      });

      const response = await request(app)
        .post(`/api/seasonal-registrations/${registration._id}/reject`)
        .send({}) // No reason
        .expect(400);

      expect(response.body.error).toMatch(/grund|reason/i);
    });

    it('should prevent rejecting already processed submission', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Test',
        birthdate: new Date('2010-05-15'),
        email: 'max@test.com',
        availableTimesKids: [
          { day: 'Montag', hour: 14, venue: 'BTHV' },
          { day: 'Montag', hour: 15, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 16, venue: 'Brüser Berg' },
          { day: 'Donnerstag', hour: 17, venue: 'Röttgen' },
          { day: 'Freitag', hour: 15, venue: 'BTHV' },
        ],
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'Jugend TEAM (Gelb)',
        privacyConsent: true,
        status: 'processed',
      });

      const rejectionData = {
        reason: 'Test rejection',
      };

      const response = await request(app)
        .post(`/api/seasonal-registrations/${registration._id}/reject`)
        .send(rejectionData)
        .expect(400);

      expect(response.body.error).toMatch(/bereits|already/i);
    });
  });

  describe('Youth Winter 2026/2027 Talentinos & Adaptations', () => {
    it('should allow creating and processing a TEAM-GELB registration with team=true and Gelb Team', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'kids',
        firstName: 'Leo',
        lastName: 'Talentino',
        birthdate: new Date('2013-03-10'),
        email: 'leo@test.com',
        availableTimesKids: [
          { day: 'Montag', hour: 15, venue: 'BTHV' },
          { day: 'Dienstag', hour: 16, venue: 'BTHV' },
        ],
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'TEAM-GELB (11–17 Jahre / U15)',
        sessionDuration: 90,
        privacyConsent: true,
        status: 'pending',
      });

      const response = await request(app)
        .post(`/api/seasonal-registrations/${registration._id}/process`)
        .send({ studentAction: 'create' })
        .expect(200);

      expect(response.body.success).toBe(true);

      const createdStudent = await Student.findOne({ email: 'leo@test.com' });
      expect(createdStudent).toBeTruthy();
      expect(createdStudent.trainigGroup).toBe('Gelb Team');
      expect(createdStudent.team).toBe(true);
      expect(createdStudent.sessionDuration).toBe(90);
    });

    it('should map ROT group to "Rot" and allow updating sessionDuration via PUT', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'kids',
        firstName: 'Mia',
        lastName: 'Talentino',
        birthdate: new Date('2018-02-14'),
        email: 'mia@test.com',
        availableTimesKids: [
          { day: 'Montag', hour: 14, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 15, venue: 'BTHV' },
        ],
        mitgliedsstatus: 'Schnuppermitglied',
        trainingsart: 'ROT (ca. 6–8 Jahre)',
        sessionDuration: 60,
        privacyConsent: true,
        status: 'pending',
      });

      // Try PUT with 90 minutes for ROT (should be rejected)
      const invalidPut = await request(app)
        .put(`/api/seasonal-registrations/${registration._id}`)
        .send({ sessionDuration: 90 })
        .expect(400);

      expect(invalidPut.body.error).toContain('90 Minuten Trainingsdauer ist ausschließlich');

      // Process ROT registration
      const response = await request(app)
        .post(`/api/seasonal-registrations/${registration._id}/process`)
        .send({ studentAction: 'create' })
        .expect(200);

      expect(response.body.success).toBe(true);

      const createdStudent = await Student.findOne({ email: 'mia@test.com' });
      expect(createdStudent).toBeTruthy();
      expect(createdStudent.trainigGroup).toBe('Rot');
      expect(createdStudent.member).toBe(false); // Schnuppermitglied != Vollmitglied
    });
  });

  describe('POST /:id/reject - Reject submission', () => {
    it('should reject a pending submission with a reason', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'kids',
        firstName: 'Anna',
        lastName: 'RejectTest',
        birthdate: new Date('2012-06-15'),
        email: 'anna@reject.com',
        privacyConsent: true,
        status: 'pending',
      });

      const response = await request(app)
        .post(`/api/seasonal-registrations/${registration._id}/reject`)
        .send({ reason: 'Leider keine passenden Trainingszeiten verfügbar.' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.registration.status).toBe('rejected');
      expect(response.body.registration.rejectionReason).toBe('Leider keine passenden Trainingszeiten verfügbar.');

      const updated = await SeasonalRegistration.findById(registration._id);
      expect(updated.status).toBe('rejected');
      expect(updated.rejectionReason).toBe('Leider keine passenden Trainingszeiten verfügbar.');
    });

    it('should return 400 when rejection reason is missing or empty', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'kids',
        firstName: 'Ben',
        lastName: 'NoReason',
        birthdate: new Date('2013-01-10'),
        email: 'ben@noreason.com',
        privacyConsent: true,
        status: 'pending',
      });

      const response = await request(app)
        .post(`/api/seasonal-registrations/${registration._id}/reject`)
        .send({ reason: '   ' })
        .expect(400);

      expect(response.body.error).toContain('Ablehnungsgrund ist erforderlich');
    });

    it('should return 400 when attempting to reject an already processed registration', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'kids',
        firstName: 'Clara',
        lastName: 'AlreadyProcessed',
        birthdate: new Date('2011-04-20'),
        email: 'clara@processed.com',
        privacyConsent: true,
        status: 'processed',
      });

      const response = await request(app)
        .post(`/api/seasonal-registrations/${registration._id}/reject`)
        .send({ reason: 'Zu spät' })
        .expect(400);

      expect(response.body.error).toContain('bereits verarbeitet');
    });
  });

  describe('POST /:id/cancel - Admin cancellation', () => {
    it('should cancel a pending registration and set cancelledBy admin', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'adults',
        firstName: 'David',
        lastName: 'CancelTest',
        birthdate: new Date('1990-08-12'),
        email: 'david@cancel.com',
        privacyConsent: true,
        status: 'pending',
      });

      const response = await request(app)
        .post(`/api/seasonal-registrations/${registration._id}/cancel`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.registration.status).toBe('cancelled');

      const updated = await SeasonalRegistration.findById(registration._id);
      expect(updated.status).toBe('cancelled');
      expect(updated.cancelledBy).toBe('admin');
      expect(updated.cancelledAt).toBeTruthy();
    });

    it('should cancel a processed registration and clear student assignments', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const student = await Student.create({
        firstName: 'Eva',
        lastName: 'StudentAssignments',
        email: 'eva@assignments.com',
        assignments: [
          { day: 'Dienstag', hour: 17, coach: new mongoose.Types.ObjectId() }
        ]
      });

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        studentId: student._id,
        formType: 'kids',
        firstName: 'Eva',
        lastName: 'StudentAssignments',
        birthdate: new Date('2014-09-05'),
        email: 'eva@assignments.com',
        privacyConsent: true,
        status: 'processed',
      });

      const response = await request(app)
        .post(`/api/seasonal-registrations/${registration._id}/cancel`)
        .expect(200);

      expect(response.body.success).toBe(true);

      const updatedRegistration = await SeasonalRegistration.findById(registration._id);
      expect(updatedRegistration.status).toBe('cancelled');
      expect(updatedRegistration.cancelledBy).toBe('admin');

      const updatedStudent = await Student.findById(student._id);
      expect(updatedStudent.assignments).toEqual([]);
    });

    it('should return 400 when attempting to cancel an already cancelled registration', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'adults',
        firstName: 'Felix',
        lastName: 'DoubleCancel',
        birthdate: new Date('1988-11-30'),
        email: 'felix@cancel.com',
        privacyConsent: true,
        status: 'cancelled',
      });

      const response = await request(app)
        .post(`/api/seasonal-registrations/${registration._id}/cancel`)
        .expect(400);

      expect(response.body.error).toContain('bereits storniert');
    });
  });

  describe('POST /:id/unprocess - Revert to pending', () => {
    it('should revert a processed registration to pending', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'kids',
        firstName: 'Greta',
        lastName: 'UnprocessTest',
        birthdate: new Date('2015-03-22'),
        email: 'greta@unprocess.com',
        privacyConsent: true,
        status: 'processed',
        processedAt: new Date(),
        processedBy: mockAdminId,
      });

      const response = await request(app)
        .post(`/api/seasonal-registrations/${registration._id}/unprocess`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.registration.status).toBe('pending');

      const updated = await SeasonalRegistration.findById(registration._id);
      expect(updated.status).toBe('pending');
      expect(updated.processedAt).toBeUndefined();
    });

    it('should return 400 if already pending', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'adults',
        firstName: 'Hans',
        lastName: 'AlreadyPending',
        birthdate: new Date('1995-07-07'),
        email: 'hans@pending.com',
        privacyConsent: true,
        status: 'pending',
      });

      const response = await request(app)
        .post(`/api/seasonal-registrations/${registration._id}/unprocess`)
        .expect(400);

      expect(response.body.error).toContain('bereits im Status ausstehend');
    });
  });
});
