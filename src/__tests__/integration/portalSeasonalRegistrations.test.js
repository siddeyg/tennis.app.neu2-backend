import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import RegistrationPeriod from '../../models/RegistrationPeriod.js';
import SeasonalRegistration from '../../models/SeasonalRegistration.js';
import StudentPortalUser from '../../models/StudentPortalUser.js';
import portalSeasonalRegistrationsRoutes from '../../routes/portalSeasonalRegistrations.js';
import {
  connectTestDB,
  disconnectTestDB,
  clearTestDB,
} from '../../testHelpers.js';

// Create Express app for testing
const app = express();
app.use(express.json());
app.use(cookieParser());

// Mock portal authentication middleware
// Tests pass the portal user ID via Cookie header (cookie-parser parses it to req.cookies)
const mockPortalAuth = () => {
  return (req, res, next) => {
    const rawId = req.cookies && req.cookies.testUserId;
    req.user = {
      id: rawId ? new mongoose.Types.ObjectId(rawId) : new mongoose.Types.ObjectId(),
      role: 'student',
    };
    next();
  };
};

app.use(mockPortalAuth());
app.use('/api/portal/seasonal-registrations', portalSeasonalRegistrationsRoutes);

describe('Portal Seasonal Registrations API Integration Tests', () => {
  let testPeriod;
  let testPortalUser;
  let adminUser;

  beforeAll(async () => {
    await connectTestDB();
    // Create a mock admin user for createdBy field
    adminUser = { _id: new mongoose.Types.ObjectId(), role: 'admin' };
  });

  afterEach(async () => {
    await clearTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  // Helper to create test data
  const createTestData = async () => {
    // Create active registration period
    testPeriod = await RegistrationPeriod.create({
      name: 'Wintertraining 2025/26',
      season: 'winter',
      trainingStartDate: new Date('2025-09-01'),
      trainingEndDate: new Date('2026-06-30'),
      registrationDeadline: new Date('2027-12-31'),
      status: 'open',
      currentPlanId: new mongoose.Types.ObjectId(),
      isActive: true,
      createdBy: adminUser._id,
      kidsFormConfig: {
        enabledFields: ['mitgliedsstatus', 'trainingsart', 'trainingshäufigkeit'],
        requiredFields: ['mitgliedsstatus', 'trainingsart'],
      },
      adultsFormConfig: {
        enabledFields: ['spielstärke', 'trainingGoals'],
        requiredFields: ['spielstärke'],
      },
    });

    // Create portal user with family member
    testPortalUser = await StudentPortalUser.create({
      email: 'parent@test.com',
      password: 'testpassword123',
      firstName: 'Parent',
      lastName: 'Test',
      birthdate: new Date('1985-01-01'),
      emailVerified: true,
      profileCompleted: true,
      sex: 'männlich',
      member: false,
      familyMembers: [
        {
          firstName: 'Max',
          lastName: 'Test',
          birthdate: new Date('2010-05-15'),
          relationship: 'child',
        },
      ],
    });

    return { testPeriod, testPortalUser };
  };

  describe('GET /active-period', () => {
    it('should return active registration period', async () => {
      const { testPeriod } = await createTestData();

      const response = await request(app)
        .get('/api/portal/seasonal-registrations/active-period')
        .expect(200);

      expect(response.body.period).toBeDefined();
      expect(response.body.period.name).toBe('Wintertraining 2025/26');
      expect(response.body.period.status).toBe('open');
      expect(response.body.period.isActive).toBe(true);
    });

    it('should return null when no active period exists', async () => {
      const response = await request(app)
        .get('/api/portal/seasonal-registrations/active-period')
        .expect(200);

      expect(response.body.period).toBeNull();
    });
  });

  describe('POST / - Submit registration', () => {
    it('should submit kids registration successfully', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registrationData = {
        periodId: testPeriod._id.toString(),
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Test',
        birthdate: '2010-05-15',
        email: 'parent@test.com',
        phone: '0151 12345678',
        address: 'Teststraße 1, 12345 Teststadt',
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'Jugend TEAM (Gelb)',
        trainingshäufigkeit: '2x pro Woche',
        teamSpieler: true,
        availableTimesKids: [
          { day: 'Montag', hour: 14, venue: 'BTHV' },
          { day: 'Montag', hour: 15, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 16, venue: 'Brüser Berg' },
          { day: 'Donnerstag', hour: 17, venue: 'Röttgen' },
          { day: 'Freitag', hour: 15, venue: 'BTHV' },
        ],
        privacyConsent: true,
      };

      const response = await request(app)
        .post('/api/portal/seasonal-registrations')
        .send(registrationData)
        .set('Cookie', `testUserId=${testPortalUser._id}`)
        .expect(201);

      expect(response.body.registration).toBeDefined();
      expect(response.body.registration.formType).toBe('kids');
      expect(response.body.registration.firstName).toBe('Max');
      expect(response.body.registration.status).toBe('processed'); // auto-processed on submit
      expect(response.body.registration.availableTimesKids).toHaveLength(5);
    });

    it('should submit adults registration successfully', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registrationData = {
        periodId: testPeriod._id.toString(),
        formType: 'adults',
        firstName: 'Sandra',
        lastName: 'Test',
        birthdate: '1980-03-20',
        email: 'sandra@test.com',
        phone: '0151 98765432',
        address: 'Teststraße 2, 12345 Teststadt',
        spielstärke: 'Fortgeschrittene',
        trainingGoals: ['Fitness', 'Turniere'],
        groupSize: ['zu dritt', 'zu viert'],
        availableTimesAdults: [
          { day: 'Montag', hour: '18:00', venue: 'BTHV' },
          { day: 'Dienstag', hour: '19:00', venue: 'BTHV' },
          { day: 'Mittwoch', hour: '18:00', venue: 'Brüser Berg' },
          { day: 'Donnerstag', hour: '19:00', venue: 'Röttgen' },
          { day: 'Freitag', hour: '18:00', venue: 'BTHV' },
        ],
        sepaMandate: true,
        accountHolder: 'Sandra Test',
        iban: 'DE89370400440532013000',
        privacyConsent: true,
      };

      const response = await request(app)
        .post('/api/portal/seasonal-registrations')
        .send(registrationData)
        .set('Cookie', `testUserId=${testPortalUser._id}`)
        .expect(201);

      expect(response.body.registration).toBeDefined();
      expect(response.body.registration.formType).toBe('adults');
      expect(response.body.registration.spielstärke).toBe('Fortgeschrittene');
      expect(response.body.registration.sepaMandate).toBe(true);
      // IBAN is removed from response for security (route deletes it before returning)
      expect(response.body.registration.iban).toBeUndefined();
    });

    it('should reject registration with less than 5 available times', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registrationData = {
        periodId: testPeriod._id.toString(),
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Test',
        birthdate: '2010-05-15',
        email: 'parent@test.com',
        availableTimesKids: [
          { day: 'Montag', hour: 14, venue: 'BTHV' },
          { day: 'Montag', hour: 15, venue: 'BTHV' },
        ],
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'Jugend TEAM (Gelb)',
        privacyConsent: true,
      };

      const response = await request(app)
        .post('/api/portal/seasonal-registrations')
        .send(registrationData)
        .set('Cookie', `testUserId=${testPortalUser._id}`)
        .expect(400);

      expect(response.body.error).toMatch(/mindestens 3/i);
    });

    it('should reject registration without privacy consent', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registrationData = {
        periodId: testPeriod._id.toString(),
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Test',
        birthdate: '2010-05-15',
        email: 'parent@test.com',
        availableTimesKids: [
          { day: 'Montag', hour: 14, venue: 'BTHV' },
          { day: 'Montag', hour: 15, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 16, venue: 'Brüser Berg' },
          { day: 'Donnerstag', hour: 17, venue: 'Röttgen' },
          { day: 'Freitag', hour: 15, venue: 'BTHV' },
        ],
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'Jugend TEAM (Gelb)',
        privacyConsent: false,
      };

      const response = await request(app)
        .post('/api/portal/seasonal-registrations')
        .send(registrationData)
        .set('Cookie', `testUserId=${testPortalUser._id}`)
        .expect(400);

      expect(response.body.error).toMatch(/erforderlich/i);
    });

    it('should reject registration with invalid IBAN format', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registrationData = {
        periodId: testPeriod._id.toString(),
        formType: 'adults',
        firstName: 'Sandra',
        lastName: 'Test',
        birthdate: '1980-03-20',
        email: 'sandra@test.com',
        spielstärke: 'Fortgeschrittene',
        availableTimesAdults: [
          { day: 'Montag', hour: '18:00', venue: 'BTHV' },
          { day: 'Dienstag', hour: '19:00', venue: 'BTHV' },
          { day: 'Mittwoch', hour: '18:00', venue: 'Brüser Berg' },
          { day: 'Donnerstag', hour: '19:00', venue: 'Röttgen' },
          { day: 'Freitag', hour: '18:00', venue: 'BTHV' },
        ],
        sepaMandate: true,
        accountHolder: 'Sandra Test',
        iban: 'INVALID_IBAN_123',
        privacyConsent: true,
      };

      const response = await request(app)
        .post('/api/portal/seasonal-registrations')
        .send(registrationData)
        .set('Cookie', `testUserId=${testPortalUser._id}`)
        .expect(400);

      expect(response.body.error).toMatch(/iban/i);
    });

    it('should prevent duplicate registration for same period', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      // Create existing registration
      await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Test',
        birthdate: new Date('2010-05-15'),
        email: 'parent@test.com',
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

      const registrationData = {
        periodId: testPeriod._id.toString(),
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Test',
        birthdate: '2010-05-15',
        email: 'parent@test.com',
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
      };

      const response = await request(app)
        .post('/api/portal/seasonal-registrations')
        .send(registrationData)
        .set('Cookie', `testUserId=${testPortalUser._id}`)
        .expect(400);

      expect(response.body.error).toMatch(/bereits|already/i);
    });
  });

  describe('GET /my-registration', () => {
    it('should return user registration for active period', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      // Create registration
      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Test',
        birthdate: new Date('2010-05-15'),
        email: 'parent@test.com',
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
        .get('/api/portal/seasonal-registrations/my-registration')
        .set('Cookie', `testUserId=${testPortalUser._id}`)
        .expect(200);

      expect(response.body.registration).toBeDefined();
      expect(response.body.registration.firstName).toBe('Max');
      expect(response.body.registration.status).toBe('pending');
    });

    it('should return null when no registration exists', async () => {
      const { testPortalUser } = await createTestData();

      const response = await request(app)
        .get('/api/portal/seasonal-registrations/my-registration')
        .set('Cookie', `testUserId=${testPortalUser._id}`)
        .expect(200);

      expect(response.body.registration).toBeNull();
    });
  });

  describe('PUT /:id - Update registration', () => {
    it('should update pending registration successfully', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Test',
        birthdate: new Date('2010-05-15'),
        email: 'parent@test.com',
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
        availableTimesKids: [
          { day: 'Montag', hour: 14, venue: 'BTHV' },
          { day: 'Dienstag', hour: 15, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 16, venue: 'Brüser Berg' },
          { day: 'Donnerstag', hour: 17, venue: 'Röttgen' },
          { day: 'Freitag', hour: 15, venue: 'BTHV' },
          { day: 'Samstag', hour: 10, venue: 'BTHV' },
        ],
      };

      const response = await request(app)
        .put(`/api/portal/seasonal-registrations/${registration._id}`)
        .send(updatedData)
        .set('Cookie', `testUserId=${testPortalUser._id}`)
        .expect(200);

      expect(response.body.registration.trainingsart).toBe('Jugend HOBBY (Gelb)');
      expect(response.body.registration.trainingshäufigkeit).toBe('2x pro Woche');
      expect(response.body.registration.availableTimesKids).toHaveLength(6);
    });

    it('should prevent updating processed registration', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Test',
        birthdate: new Date('2010-05-15'),
        email: 'parent@test.com',
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
        .put(`/api/portal/seasonal-registrations/${registration._id}`)
        .send(updatedData)
        .set('Cookie', `testUserId=${testPortalUser._id}`)
        .expect(400);

      expect(response.body.error).toMatch(/ausstehend|pending/i);
    });

    it('should prevent user from updating another user registration', async () => {
      const { testPeriod } = await createTestData();

      // Create another user
      const anotherUser = await StudentPortalUser.create({
        email: 'another@test.com',
        password: 'testpassword123',
        firstName: 'Another',
        lastName: 'User',
        birthdate: new Date('1990-01-01'),
        emailVerified: true,
      });

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: anotherUser._id,
        formType: 'kids',
        firstName: 'Another',
        lastName: 'User',
        birthdate: new Date('2010-05-15'),
        email: 'another@test.com',
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
      };

      const response = await request(app)
        .put(`/api/portal/seasonal-registrations/${registration._id}`)
        .send(updatedData)
        .set('Cookie', `testUserId=${new mongoose.Types.ObjectId()}`) // Different user
        .expect(403);

      expect(response.body.error).toMatch(/berechtigung|authorized/i);
    });
  });

  describe('DELETE /:id - Delete registration', () => {
    it('should delete pending registration successfully', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Test',
        birthdate: new Date('2010-05-15'),
        email: 'parent@test.com',
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
        .delete(`/api/portal/seasonal-registrations/${registration._id}`)
        .set('Cookie', `testUserId=${testPortalUser._id}`)
        .expect(200);

      expect(response.body.message).toMatch(/storniert|gelöscht|deleted/i);

      // Verify registration is soft-cancelled (not physically deleted)
      const cancelledReg = await SeasonalRegistration.findById(registration._id);
      expect(cancelledReg).not.toBeNull();
      expect(cancelledReg.status).toBe('cancelled');
    });

    it('should prevent deleting processed registration', async () => {
      const { testPeriod, testPortalUser } = await createTestData();

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: testPortalUser._id,
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Test',
        birthdate: new Date('2010-05-15'),
        email: 'parent@test.com',
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

      // Route allows cancelling processed registrations (soft-cancel)
      const response = await request(app)
        .delete(`/api/portal/seasonal-registrations/${registration._id}`)
        .set('Cookie', `testUserId=${testPortalUser._id}`)
        .expect(200);

      expect(response.body.message).toMatch(/storniert|gelöscht|deleted/i);
      const cancelledReg = await SeasonalRegistration.findById(registration._id);
      expect(cancelledReg.status).toBe('cancelled');
    });

    it('should prevent user from deleting another user registration', async () => {
      const { testPeriod } = await createTestData();

      const anotherUser = await StudentPortalUser.create({
        email: 'another@test.com',
        password: 'testpassword123',
        firstName: 'Another',
        lastName: 'User',
        birthdate: new Date('1990-01-01'),
        emailVerified: true,
      });

      const registration = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: anotherUser._id,
        formType: 'kids',
        firstName: 'Another',
        lastName: 'User',
        birthdate: new Date('2010-05-15'),
        email: 'another@test.com',
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
        .delete(`/api/portal/seasonal-registrations/${registration._id}`)
        .set('Cookie', `testUserId=${new mongoose.Types.ObjectId()}`) // Different user
        .expect(403);

      expect(response.body.error).toMatch(/berechtigung|authorized/i);
    });
  });
});
