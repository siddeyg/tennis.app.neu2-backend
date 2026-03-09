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
});
