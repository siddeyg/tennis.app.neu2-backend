import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import RegistrationPeriod from '../../models/RegistrationPeriod.js';
import SeasonalRegistration from '../../models/SeasonalRegistration.js';
import Student from '../../models/Student.js';
import StudentPortalUser from '../../models/StudentPortalUser.js';
// User model must be imported so Mongoose can populate 'createdBy' (ref: 'User')
import '../../models/User.js';
import registrationPeriodsRoutes from '../../routes/registrationPeriods.js';
import {
  connectTestDB,
  disconnectTestDB,
  clearTestDB,
} from '../../testHelpers.js';

// Shared admin ObjectId used for req.user and RegistrationPeriod.createdBy
const mockAdminId = new mongoose.Types.ObjectId();
// Placeholder plan ID used when status='open' requires currentPlanId (pre-save hook)
const mockPlanId = new mongoose.Types.ObjectId();

// Create Express app for testing
const app = express();
app.use(express.json());
app.use(cookieParser());

// Correct mock admin authentication middleware
// requireAuth checks: NODE_ENV=test AND req.user is set AND req.user.role is valid
app.use((req, res, next) => {
  req.user = {
    _id: mockAdminId,
    id: mockAdminId,
    role: 'admin',
    firstName: 'Test',
    lastName: 'Admin',
    email: 'admin@test.com',
  };
  next();
});

app.use('/api/registration-periods', registrationPeriodsRoutes);

describe('Registration Periods API Integration Tests', () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterEach(async () => {
    await clearTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  describe('POST / - Create period', () => {
    it('should create registration period successfully', async () => {
      const periodData = {
        name: 'Wintertraining 2025/26',
        season: 'winter',
        trainingStartDate: '2025-09-01',
        trainingEndDate: '2026-06-30',
        registrationDeadline: '2025-08-15',
        status: 'draft',
      };

      const response = await request(app)
        .post('/api/registration-periods')
        .send(periodData)
        .expect(201);

      expect(response.body.period).toBeDefined();
      expect(response.body.period.name).toBe('Wintertraining 2025/26');
      expect(response.body.period.season).toBe('winter');
      expect(response.body.period.status).toBe('draft');
      expect(response.body.period.isActive).toBe(false);
      // Form configs should be auto-generated
      expect(response.body.period.kidsFormConfig).toBeDefined();
      expect(response.body.period.adultsFormConfig).toBeDefined();
    });

    it('should reject period with end date before start date', async () => {
      const periodData = {
        name: 'Invalid Period',
        season: 'winter',
        trainingStartDate: '2025-09-01',
        trainingEndDate: '2025-06-30', // Before start date
        registrationDeadline: '2025-08-15',
      };

      const response = await request(app)
        .post('/api/registration-periods')
        .send(periodData)
        .expect(400);

      expect(response.body.error).toMatch(/datum|date/i);
    });

    it('should reject period with deadline after training start', async () => {
      const periodData = {
        name: 'Invalid Deadline',
        season: 'winter',
        trainingStartDate: '2025-09-01',
        trainingEndDate: '2026-06-30',
        registrationDeadline: '2025-09-15', // After training start
      };

      const response = await request(app)
        .post('/api/registration-periods')
        .send(periodData)
        .expect(400);

      expect(response.body.error).toMatch(/anmeldefrist|deadline/i);
    });
  });

  describe('GET / - List periods', () => {
    beforeEach(async () => {
      // Create test periods (createdBy required by schema)
      await RegistrationPeriod.create([
        {
          name: 'Wintertraining 2024/25',
          season: 'winter',
          trainingStartDate: new Date('2024-09-01'),
          trainingEndDate: new Date('2025-06-30'),
          registrationDeadline: new Date('2024-08-15'),
          status: 'closed',
          createdBy: mockAdminId,
        },
        {
          name: 'Sommertraining 2025',
          season: 'summer',
          trainingStartDate: new Date('2025-07-01'),
          trainingEndDate: new Date('2025-08-31'),
          registrationDeadline: new Date('2025-06-15'),
          status: 'open',
          currentPlanId: mockPlanId,
          isActive: true,
          createdBy: mockAdminId,
        },
        {
          name: 'Wintertraining 2025/26',
          season: 'winter',
          trainingStartDate: new Date('2025-09-01'),
          trainingEndDate: new Date('2026-06-30'),
          registrationDeadline: new Date('2025-08-15'),
          status: 'draft',
          createdBy: mockAdminId,
        },
      ]);
    });

    it('should list all registration periods', async () => {
      const response = await request(app)
        .get('/api/registration-periods')
        .expect(200);

      expect(response.body.periods).toHaveLength(3);
    });

    it('should filter periods by status', async () => {
      const response = await request(app)
        .get('/api/registration-periods?status=open')
        .expect(200);

      expect(response.body.periods).toHaveLength(1);
      expect(response.body.periods[0].status).toBe('open');
    });

    it('should filter periods by season', async () => {
      const response = await request(app)
        .get('/api/registration-periods?season=winter')
        .expect(200);

      expect(response.body.periods).toHaveLength(2);
      expect(response.body.periods.every((p) => p.season === 'winter')).toBe(true);
    });
  });

  describe('GET /:id - Get period with stats', () => {
    it('should return period with submission count', async () => {
      const period = await RegistrationPeriod.create({
        name: 'Wintertraining 2025/26',
        season: 'winter',
        trainingStartDate: new Date('2025-09-01'),
        trainingEndDate: new Date('2026-06-30'),
        registrationDeadline: new Date('2025-08-15'),
        status: 'open',
        currentPlanId: mockPlanId,
        isActive: true,
        createdBy: mockAdminId,
      });

      const portalUser = await StudentPortalUser.create({
        email: 'test@test.com',
        password: 'testpass1',
        firstName: 'Test',
        lastName: 'User',
        birthdate: new Date('1990-01-01'),
        emailVerified: true,
      });

      // Create 3 submissions (use distinct familyMemberId to satisfy unique partial index)
      const [fam1, fam2, fam3] = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
      await SeasonalRegistration.create([
        {
          periodId: period._id,
          studentPortalUserId: portalUser._id,
          familyMemberId: fam1,
          formType: 'kids',
          firstName: 'Max',
          lastName: 'Test',
          birthdate: new Date('2010-05-15'),
          email: 'test@test.com',
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
          periodId: period._id,
          studentPortalUserId: portalUser._id,
          familyMemberId: fam2,
          formType: 'kids',
          firstName: 'Anna',
          lastName: 'Test',
          birthdate: new Date('2012-03-20'),
          email: 'test@test.com',
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
          status: 'pending',
        },
        {
          periodId: period._id,
          studentPortalUserId: portalUser._id,
          familyMemberId: fam3,
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
      ]);

      const response = await request(app)
        .get(`/api/registration-periods/${period._id}`)
        .expect(200);

      expect(response.body.period).toBeDefined();
      expect(response.body.period.name).toBe('Wintertraining 2025/26');
      expect(response.body.stats.totalSubmissions).toBe(3);
    });

    it('should return 404 for non-existent period', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      await request(app)
        .get(`/api/registration-periods/${fakeId}`)
        .expect(404);
    });
  });

  describe('PUT /:id - Update period', () => {
    it('should update period successfully', async () => {
      const period = await RegistrationPeriod.create({
        name: 'Wintertraining 2025/26',
        season: 'winter',
        trainingStartDate: new Date('2025-09-01'),
        trainingEndDate: new Date('2026-06-30'),
        registrationDeadline: new Date('2025-08-15'),
        status: 'draft',
        createdBy: mockAdminId,
      });

      const updatedData = {
        name: 'Wintertraining 2025/26 (Aktualisiert)',
        registrationDeadline: '2025-08-10',
      };

      const response = await request(app)
        .put(`/api/registration-periods/${period._id}`)
        .send(updatedData)
        .expect(200);

      expect(response.body.period.name).toBe('Wintertraining 2025/26 (Aktualisiert)');
      expect(new Date(response.body.period.registrationDeadline).toISOString()).toBe(
        new Date('2025-08-10').toISOString()
      );
    });

    it('should prevent updating period with submissions to delete', async () => {
      const period = await RegistrationPeriod.create({
        name: 'Wintertraining 2025/26',
        season: 'winter',
        trainingStartDate: new Date('2025-09-01'),
        trainingEndDate: new Date('2026-06-30'),
        registrationDeadline: new Date('2025-08-15'),
        status: 'open',
        currentPlanId: mockPlanId,
        createdBy: mockAdminId,
      });

      const portalUser = await StudentPortalUser.create({
        email: 'test@test.com',
        password: 'testpass1',
        firstName: 'Test',
        lastName: 'User',
        birthdate: new Date('1990-01-01'),
        emailVerified: true,
      });

      await SeasonalRegistration.create({
        periodId: period._id,
        studentPortalUserId: portalUser._id,
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Test',
        birthdate: new Date('2010-05-15'),
        email: 'test@test.com',
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

      // Try to update critical fields
      const updatedData = {
        trainingStartDate: '2025-10-01', // Different start date
      };

      const response = await request(app)
        .put(`/api/registration-periods/${period._id}`)
        .send(updatedData)
        .expect(400);

      expect(response.body.error).toMatch(/anmeldungen|anmeldezeitraum|submissions/i);
    });
  });

  describe('DELETE /:id - Delete period', () => {
    it('should delete period without submissions', async () => {
      const period = await RegistrationPeriod.create({
        name: 'Wintertraining 2025/26',
        season: 'winter',
        trainingStartDate: new Date('2025-09-01'),
        trainingEndDate: new Date('2026-06-30'),
        registrationDeadline: new Date('2025-08-15'),
        status: 'draft',
        createdBy: mockAdminId,
      });

      const response = await request(app)
        .delete(`/api/registration-periods/${period._id}`)
        .expect(200);

      expect(response.body.message).toMatch(/gelöscht|deleted/i);

      // Verify period is deleted
      const deletedPeriod = await RegistrationPeriod.findById(period._id);
      expect(deletedPeriod).toBeNull();
    });

    it('should cascade-delete submissions when deleting period', async () => {
      const period = await RegistrationPeriod.create({
        name: 'Wintertraining 2025/26',
        season: 'winter',
        trainingStartDate: new Date('2025-09-01'),
        trainingEndDate: new Date('2026-06-30'),
        registrationDeadline: new Date('2025-08-15'),
        status: 'open',
        currentPlanId: mockPlanId,
        createdBy: mockAdminId,
      });

      const portalUser = await StudentPortalUser.create({
        email: 'test@test.com',
        password: 'testpass1',
        firstName: 'Test',
        lastName: 'User',
        birthdate: new Date('1990-01-01'),
        emailVerified: true,
      });

      await SeasonalRegistration.create({
        periodId: period._id,
        studentPortalUserId: portalUser._id,
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Test',
        birthdate: new Date('2010-05-15'),
        email: 'test@test.com',
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

      // Route cascade-deletes all submissions when period is deleted
      const response = await request(app)
        .delete(`/api/registration-periods/${period._id}`)
        .expect(200);

      expect(response.body.message).toMatch(/gelöscht|deleted/i);

      // Period is deleted
      const deletedPeriod = await RegistrationPeriod.findById(period._id);
      expect(deletedPeriod).toBeNull();

      // Submissions are also cascade-deleted
      const submissions = await SeasonalRegistration.find({ periodId: period._id });
      expect(submissions).toHaveLength(0);
    });
  });

  describe('POST /:id/open - Open registration', () => {
    it('should open registration and set as active', async () => {
      const period = await RegistrationPeriod.create({
        name: 'Wintertraining 2025/26',
        season: 'winter',
        trainingStartDate: new Date('2025-09-01'),
        trainingEndDate: new Date('2026-06-30'),
        registrationDeadline: new Date('2025-08-15'),
        status: 'draft',
        // currentPlanId required by pre-save hook when status changes to 'open'
        currentPlanId: mockPlanId,
        createdBy: mockAdminId,
      });

      const response = await request(app)
        .post(`/api/registration-periods/${period._id}/open`)
        .expect(200);

      expect(response.body.period.status).toBe('open');
      expect(response.body.period.isActive).toBe(true);
    });

    it('should deactivate other periods when opening new one', async () => {
      // Create existing active period
      const existingPeriod = await RegistrationPeriod.create({
        name: 'Sommertraining 2025',
        season: 'summer',
        trainingStartDate: new Date('2025-07-01'),
        trainingEndDate: new Date('2025-08-31'),
        registrationDeadline: new Date('2025-06-15'),
        status: 'open',
        currentPlanId: mockPlanId,
        isActive: true,
        createdBy: mockAdminId,
      });

      // Create new draft period (currentPlanId required when status changes to 'open')
      const newPeriod = await RegistrationPeriod.create({
        name: 'Wintertraining 2025/26',
        season: 'winter',
        trainingStartDate: new Date('2025-09-01'),
        trainingEndDate: new Date('2026-06-30'),
        registrationDeadline: new Date('2025-08-15'),
        status: 'draft',
        currentPlanId: mockPlanId,
        createdBy: mockAdminId,
      });

      // Open new period
      await request(app)
        .post(`/api/registration-periods/${newPeriod._id}/open`)
        .expect(200);

      // Check existing period is deactivated
      const updatedExisting = await RegistrationPeriod.findById(existingPeriod._id);
      expect(updatedExisting.isActive).toBe(false);

      // Check new period is active
      const updatedNew = await RegistrationPeriod.findById(newPeriod._id);
      expect(updatedNew.isActive).toBe(true);
      expect(updatedNew.status).toBe('open');
    });
  });

  describe('POST /:id/close - Close registration', () => {
    it('should close registration and deactivate', async () => {
      const period = await RegistrationPeriod.create({
        name: 'Wintertraining 2025/26',
        season: 'winter',
        trainingStartDate: new Date('2025-09-01'),
        trainingEndDate: new Date('2026-06-30'),
        registrationDeadline: new Date('2025-08-15'),
        status: 'open',
        currentPlanId: mockPlanId,
        isActive: true,
        createdBy: mockAdminId,
      });

      const response = await request(app)
        .post(`/api/registration-periods/${period._id}/close`)
        .expect(200);

      expect(response.body.period.status).toBe('closed');
      expect(response.body.period.isActive).toBe(false);
    });
  });

  describe('GET /:id/submissions - List submissions', () => {
    it('should return all submissions for period', async () => {
      const period = await RegistrationPeriod.create({
        name: 'Wintertraining 2025/26',
        season: 'winter',
        trainingStartDate: new Date('2025-09-01'),
        trainingEndDate: new Date('2026-06-30'),
        registrationDeadline: new Date('2025-08-15'),
        status: 'open',
        currentPlanId: mockPlanId,
        isActive: true,
        createdBy: mockAdminId,
      });

      const portalUser = await StudentPortalUser.create({
        email: 'test@test.com',
        password: 'testpass1',
        firstName: 'Test',
        lastName: 'User',
        birthdate: new Date('1990-01-01'),
        emailVerified: true,
      });

      // Create 2 submissions (use distinct familyMemberId to satisfy unique partial index)
      const [subFam1, subFam2] = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
      await SeasonalRegistration.create([
        {
          periodId: period._id,
          studentPortalUserId: portalUser._id,
          familyMemberId: subFam1,
          formType: 'kids',
          firstName: 'Max',
          lastName: 'Test',
          birthdate: new Date('2010-05-15'),
          email: 'test@test.com',
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
          periodId: period._id,
          studentPortalUserId: portalUser._id,
          familyMemberId: subFam2,
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
          status: 'pending',
        },
      ]);

      const response = await request(app)
        .get(`/api/registration-periods/${period._id}/submissions`)
        .expect(200);

      expect(response.body.submissions).toHaveLength(2);
      expect(response.body.submissions[0].firstName).toBeDefined();
      expect(response.body.submissions[1].firstName).toBeDefined();
    });
  });

  describe('POST /:id/process-all - Bulk process submissions', () => {
    it('should process all pending submissions and create students', async () => {
      const period = await RegistrationPeriod.create({
        name: 'Wintertraining 2025/26',
        season: 'winter',
        trainingStartDate: new Date('2025-09-01'),
        trainingEndDate: new Date('2026-06-30'),
        registrationDeadline: new Date('2025-08-15'),
        status: 'open',
        currentPlanId: mockPlanId,
        isActive: true,
        createdBy: mockAdminId,
      });

      const portalUser = await StudentPortalUser.create({
        email: 'test@test.com',
        password: 'testpass1',
        firstName: 'Test',
        lastName: 'User',
        birthdate: new Date('1990-01-01'),
        emailVerified: true,
      });

      // Create 3 submissions (2 pending, 1 processed)
      // Use distinct familyMemberId to satisfy unique partial index per {studentPortalUserId, periodId, familyMemberId}
      const [procFam1, procFam2, procFam3] = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
      await SeasonalRegistration.create([
        {
          periodId: period._id,
          studentPortalUserId: portalUser._id,
          familyMemberId: procFam1,
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
          trainingshäufigkeit: '2x pro Woche',
          privacyConsent: true,
          status: 'pending',
        },
        {
          periodId: period._id,
          studentPortalUserId: portalUser._id,
          familyMemberId: procFam2,
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
          status: 'pending',
        },
        {
          periodId: period._id,
          studentPortalUserId: portalUser._id,
          familyMemberId: procFam3,
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
          status: 'processed', // Already processed
        },
      ]);

      const response = await request(app)
        .post(`/api/registration-periods/${period._id}/process-all`)
        .expect(200);

      expect(response.body.message).toMatch(/verarbeitet|processed/i);
      expect(response.body.processed).toBe(2); // Only pending ones

      // Verify students were created
      const students = await Student.find({});
      expect(students).toHaveLength(2);

      // Verify kids student
      const kidsStudent = students.find((s) => s.firstName === 'Max');
      expect(kidsStudent.trainigGroup).toBe('Gelb Team'); // mapped from 'Jugend TEAM (Gelb)'
      expect(kidsStudent.frequence).toBe('2');
      expect(kidsStudent.adult).toBe(false);

      // Verify adults student
      const adultsStudent = students.find((s) => s.firstName === 'Sandra');
      expect(adultsStudent.skillLevel).toBe('Fortgeschrittene'); // from spielstärke field
      expect(adultsStudent.adult).toBe(true);

      // Verify registrations are marked as processed
      const processedRegs = await SeasonalRegistration.find({ status: 'processed' });
      expect(processedRegs).toHaveLength(3); // 2 newly processed + 1 already processed
    });

    it('should update existing student if email matches', async () => {
      const period = await RegistrationPeriod.create({
        name: 'Wintertraining 2025/26',
        season: 'winter',
        trainingStartDate: new Date('2025-09-01'),
        trainingEndDate: new Date('2026-06-30'),
        registrationDeadline: new Date('2025-08-15'),
        status: 'open',
        currentPlanId: mockPlanId,
        isActive: true,
        createdBy: mockAdminId,
      });

      // Create existing student
      const existingStudent = await Student.create({
        firstName: 'Max',
        lastName: 'Old',
        email: 'max@test.com',
        birthDate: new Date('2010-05-15'),
        adult: false,
        trainigGroup: 'Orange',
      });

      const portalUser = await StudentPortalUser.create({
        email: 'test@test.com',
        password: 'testpass1',
        firstName: 'Test',
        lastName: 'User',
        birthdate: new Date('1990-01-01'),
        emailVerified: true,
      });

      // Create registration with same email but updated data
      await SeasonalRegistration.create({
        periodId: period._id,
        studentPortalUserId: portalUser._id,
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Updated',
        birthdate: new Date('2010-05-15'),
        email: 'max@test.com', // Same email as existing
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
        .post(`/api/registration-periods/${period._id}/process-all`)
        .expect(200);

      // Verify student was updated (not created new)
      const students = await Student.find({});
      expect(students).toHaveLength(1);

      const updatedStudent = students[0];
      expect(updatedStudent._id.toString()).toBe(existingStudent._id.toString());
      expect(updatedStudent.lastName).toBe('Updated');
      expect(updatedStudent.trainigGroup).toBe('Gelb Team'); // mapped from 'Jugend TEAM (Gelb)'
    });
  });
});
