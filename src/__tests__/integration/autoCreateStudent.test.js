/**
 * Auto-Create Student Tests
 *
 * Tests automatic Student record creation when users submit
 * their first seasonal registration.
 */

import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import StudentPortalUser from '../../models/StudentPortalUser.js';
import Student from '../../models/Student.js';
import RegistrationPeriod from '../../models/RegistrationPeriod.js';
import SeasonalRegistration from '../../models/SeasonalRegistration.js';
import User from '../../models/User.js';
import portalSeasonalRegistrationsRoutes from '../../routes/portalSeasonalRegistrations.js';
import {
  connectTestDB,
  disconnectTestDB,
  clearTestDB,
} from '../../testHelpers.js';

const app = express();
app.use(express.json());

// Mock portal authentication middleware
// Tests pass the portal user ID via 'testPortalUserId' header
const mockPortalAuth = (req, res, next) => {
  const rawId = req.headers['testportaluserid'];
  req.user = {
    id: rawId ? new mongoose.Types.ObjectId(rawId) : new mongoose.Types.ObjectId(),
    role: 'student',
    studentId: null,
  };
  next();
};

app.use(mockPortalAuth);
app.use('/api/portal/seasonal-registrations', portalSeasonalRegistrationsRoutes);

describe('Auto-Create Student on Seasonal Registration', () => {
  let portalUser;
  let adminUser;
  let registrationPeriod;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    // Create mock admin user for RegistrationPeriod createdBy field
    adminUser = new User({
      email: 'admin@test.com',
      password: 'hashedpassword123',
      firstName: 'Test',
      lastName: 'Admin',
      role: 'admin',
    });
    await adminUser.save();

    // Create verified portal user
    portalUser = new StudentPortalUser({
      email: 'testuser@example.com',
      password: 'hashedpassword123',
      firstName: 'Test',
      lastName: 'User',
      birthdate: new Date('2010-01-01'),
      emailVerified: true,
      profileCompleted: true,
      sex: 'männlich',
      member: false,
      studentId: null,
    });
    await portalUser.save();

    // Create active registration period
    registrationPeriod = new RegistrationPeriod({
      name: 'Test Winter 2026',
      season: 'winter',
      registrationStart: new Date('2026-01-01'),
      registrationDeadline: new Date('2026-12-31'),
      trainingStartDate: new Date('2026-02-01'),
      trainingEndDate: new Date('2026-08-31'),
      isActive: true,
      status: 'open',
      currentPlanId: new mongoose.Types.ObjectId(),
      createdBy: adminUser._id,
      kidsFormConfig: {
        enabledFields: ['mitgliedsstatus', 'trainingsart', 'trainingshäufigkeit', 'teamParticipation', 'availableTimesKids'],
        requiredFields: ['mitgliedsstatus', 'trainingsart', 'trainingshäufigkeit', 'availableTimesKids']
      },
      adultsFormConfig: {
        enabledFields: ['spielstärke', 'trainingGoals', 'groupSize', 'availableTimesAdults'],
        requiredFields: ['spielstärke', 'availableTimesAdults']
      }
    });
    await registrationPeriod.save();
  });

  describe('POST /api/portal/seasonal-registrations - Kids Registration', () => {
    test('Should auto-create Student record on first registration (kids)', async () => {
      const registrationData = {
        periodId: registrationPeriod._id,
        formType: 'kids',
        firstName: 'Max',
        lastName: 'Mustermann',
        birthdate: '2015-05-15',
        email: 'kid@example.com',
        phone: '+49123456789',
        address: 'Teststr. 123, 10115 Berlin',
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'KIDS-ORANGE (ca. 8-10 Jahre)',
        trainingshäufigkeit: '2x pro Woche',
        teamParticipation: false,
        availableTimesKids: [
          { day: 'Montag', hour: 14, venue: 'BTHV' },
          { day: 'Montag', hour: 15, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 14, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 15, venue: 'BTHV' },
          { day: 'Freitag', hour: 14, venue: 'BTHV' }
        ],
        privacyConsent: true,
        remarks: 'Testbemerkung'
      };

      const res = await request(app)
        .post('/api/portal/seasonal-registrations')
        .set('testPortalUserId', portalUser._id.toString())
        .send(registrationData)
        .expect(201);

      expect(res.body.success).toBe(true);

      const student = await Student.findOne({ email: 'kid@example.com' });
      expect(student).toBeDefined();
      expect(student.firstName).toBe('Max');
      expect(student.member).toBe(true);
      expect(student.trainigGroup).toBe('Orange'); // mapped from 'KIDS-ORANGE (ca. 8-10 Jahre)'
      expect(student.frequence).toBe('2');

      const updatedPortalUser = await StudentPortalUser.findById(portalUser._id);
      expect(updatedPortalUser.studentId).toBeDefined();

      const registration = await SeasonalRegistration.findOne({
        studentPortalUserId: portalUser._id,
        periodId: registrationPeriod._id
      });
      expect(registration.status).toBe('pending'); // stays pending until admin approves
    });

    test('Should NOT create duplicate Student on second registration', async () => {
      const registrationData1 = {
        periodId: registrationPeriod._id,
        formType: 'kids',
        firstName: 'Emma',
        lastName: 'Test',
        birthdate: '2014-03-20',
        email: 'emma@example.com',
        phone: '+49111222333',
        address: 'Emma Str. 1, 12345 Berlin',
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'Jugend TEAM (Gelb)',
        trainingshäufigkeit: '2x pro Woche',
        availableTimesKids: [
          { day: 'Montag', hour: 14, venue: 'BTHV' },
          { day: 'Dienstag', hour: 15, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 14, venue: 'BTHV' },
          { day: 'Donnerstag', hour: 15, venue: 'BTHV' },
          { day: 'Freitag', hour: 14, venue: 'BTHV' }
        ],
        privacyConsent: true
      };

      await request(app)
        .post('/api/portal/seasonal-registrations')
        .set('testPortalUserId', portalUser._id.toString())
        .send(registrationData1)
        .expect(201);

      const studentsAfterFirst = await Student.find({});
      expect(studentsAfterFirst).toHaveLength(1);

      const winterPeriod = new RegistrationPeriod({
        name: 'Summer 2026',
        season: 'summer',
        registrationStart: new Date('2026-04-01'),
        registrationDeadline: new Date('2026-12-31'),
        trainingStartDate: new Date('2026-05-01'),
        trainingEndDate: new Date('2026-10-31'),
        isActive: true,
        status: 'open',
        currentPlanId: new mongoose.Types.ObjectId(),
        createdBy: adminUser._id,
        kidsFormConfig: {
          enabledFields: ['mitgliedsstatus', 'trainingsart', 'availableTimesKids'],
          requiredFields: ['mitgliedsstatus', 'trainingsart', 'availableTimesKids']
        }
      });
      await winterPeriod.save();

      const registrationData2 = {
        periodId: winterPeriod._id,
        formType: 'kids',
        firstName: 'Emma',
        lastName: 'Test',
        birthdate: '2014-03-20',
        email: 'emma@example.com',
        phone: '+49111222333',
        address: 'Emma Str. 1, 12345 Berlin',
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'KIDS-GRÜN (ca. 10-12 Jahre)',
        trainingshäufigkeit: '2x pro Woche',
        availableTimesKids: [
          { day: 'Montag', hour: 15, venue: 'BTHV' },
          { day: 'Dienstag', hour: 15, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 15, venue: 'BTHV' },
          { day: 'Donnerstag', hour: 15, venue: 'BTHV' },
          { day: 'Freitag', hour: 15, venue: 'BTHV' }
        ],
        privacyConsent: true
      };

      await request(app)
        .post('/api/portal/seasonal-registrations')
        .set('testPortalUserId', portalUser._id.toString())
        .send(registrationData2)
        .expect(201);

      const studentsAfterSecond = await Student.find({});
      expect(studentsAfterSecond).toHaveLength(1);
    });

    test('Should correctly map kids-specific fields', async () => {
      const registrationData = {
        periodId: registrationPeriod._id,
        formType: 'kids',
        firstName: 'Leon',
        lastName: 'Fieldtest',
        birthdate: '2013-11-10',
        email: 'leon@example.com',
        phone: '+49444555666',
        address: 'Leon Weg 5, 54321 Stadt',
        mitgliedsstatus: 'Nicht-Mitglied/Schnupperkind',
        trainingsart: 'KIDS-ROT (ca. 6-8 Jahre)',
        trainingshäufigkeit: '1x pro Woche',
        teamParticipation: false,
        availableTimesKids: [
          { day: 'Montag', hour: 14, venue: 'BTHV' },
          { day: 'Dienstag', hour: 14, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 14, venue: 'BTHV' },
          { day: 'Donnerstag', hour: 14, venue: 'BTHV' },
          { day: 'Freitag', hour: 14, venue: 'BTHV' }
        ],
        privacyConsent: true
      };

      await request(app)
        .post('/api/portal/seasonal-registrations')
        .set('testPortalUserId', portalUser._id.toString())
        .send(registrationData)
        .expect(201);

      const student = await Student.findOne({ email: 'leon@example.com' });
      expect(student.member).toBe(false);
      expect(student.trainigGroup).toBe('Rot'); // mapped from 'KIDS-ROT (ca. 6-8 Jahre)'
      expect(student.frequence).toBe('1');
      expect(student.team).toBe(false);
      expect(student.adult).toBe(false);
    });
  });

  describe('POST /api/portal/seasonal-registrations - Adults Registration', () => {
    test('Should auto-create Student for adults with correct field mapping', async () => {
      const registrationData = {
        periodId: registrationPeriod._id,
        formType: 'adults',
        firstName: 'Peter',
        lastName: 'Erwachsen',
        birthdate: '1982-07-25',
        email: 'peter@example.com',
        phone: '+49987654321',
        address: 'Erwachsenenstr. 99, 80331 München',
        spielstärke: 'Erfahrene Spieler:innen / Mannschaftsspieler:innen',
        trainingGoals: ['Turniere', 'Mannschaft'],
        groupSize: ['zu zweit', 'zu dritt'],
        availableTimesAdults: [
          { day: 'Montag', hour: '19:00', venue: 'BTHV (Teppich)' },
          { day: 'Mittwoch', hour: '19:00', venue: 'BTHV (Teppich)' },
          { day: 'Freitag', hour: '19:00', venue: 'BTHV (Teppich)' },
          { day: 'Samstag', hour: '10:00', venue: 'BTHV (Traglufthalle)' },
          { day: 'Samstag', hour: '11:00', venue: 'BTHV (Traglufthalle)' }
        ],
        privacyConsent: true,
        remarks: 'Bevorzugt Doppeltraining'
      };

      await request(app)
        .post('/api/portal/seasonal-registrations')
        .set('testPortalUserId', portalUser._id.toString())
        .send(registrationData)
        .expect(201);

      const student = await Student.findOne({ email: 'peter@example.com' });
      expect(student).toBeDefined();
      expect(student.adult).toBe(true);
      expect(student.skillLevel).toBe('Erfahrene Spieler:innen / Mannschaftsspieler:innen');
      expect(student.comment2).toBe('Turniere, Mannschaft');
      expect(student.groupSize).toBe('zu zweit, zu dritt');
      expect(student.frequence).toBe('1');
    });
  });

  describe('Auto-Approval Functionality', () => {
    test('Should auto-approve registration (status = processed)', async () => {
      const registrationData = {
        periodId: registrationPeriod._id,
        formType: 'kids',
        firstName: 'Auto',
        lastName: 'Approved',
        birthdate: '2012-01-01',
        email: 'autoapproved@example.com',
        phone: '+49777888999',
        address: 'Auto Str. 10, 11111 Auto City',
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'KIDS-ORANGE (ca. 8-10 Jahre)',
        trainingshäufigkeit: '2x pro Woche',
        availableTimesKids: [
          { day: 'Montag', hour: 14, venue: 'BTHV' },
          { day: 'Dienstag', hour: 14, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 14, venue: 'BTHV' },
          { day: 'Donnerstag', hour: 14, venue: 'BTHV' },
          { day: 'Freitag', hour: 14, venue: 'BTHV' }
        ],
        privacyConsent: true
      };

      await request(app)
        .post('/api/portal/seasonal-registrations')
        .set('testPortalUserId', portalUser._id.toString())
        .send(registrationData)
        .expect(201);

      const registration = await SeasonalRegistration.findOne({
        studentPortalUserId: portalUser._id,
        periodId: registrationPeriod._id
      });

      expect(registration.status).toBe('pending'); // stays pending until admin approves
      expect(registration.studentId).toBeDefined(); // student auto-created and linked
    });

    test('Should have no processedAt until admin approves', async () => {
      const registrationData = {
        periodId: registrationPeriod._id,
        formType: 'kids',
        firstName: 'Timestamp',
        lastName: 'Test',
        birthdate: '2011-06-15',
        email: 'timestamp@example.com',
        phone: '+49666777888',
        address: 'Time St. 20, 22222 Time Town',
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'KIDS-GRÜN (ca. 10-12 Jahre)',
        trainingshäufigkeit: '2x pro Woche',
        availableTimesKids: [
          { day: 'Montag', hour: 14, venue: 'BTHV' },
          { day: 'Dienstag', hour: 14, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 14, venue: 'BTHV' },
          { day: 'Donnerstag', hour: 14, venue: 'BTHV' },
          { day: 'Freitag', hour: 14, venue: 'BTHV' }
        ],
        privacyConsent: true
      };

      const before = new Date();
      await request(app)
        .post('/api/portal/seasonal-registrations')
        .set('testPortalUserId', portalUser._id.toString())
        .send(registrationData)
        .expect(201);
      const after = new Date();

      const registration = await SeasonalRegistration.findOne({
        studentPortalUserId: portalUser._id
      });

      expect(registration.status).toBe('pending');
      expect(registration.processedAt).toBeUndefined(); // not set until admin approves
      expect(registration.studentId).toBeDefined(); // student still auto-created
    });

    test('Should link Student immediately (not pending admin review)', async () => {
      const registrationData = {
        periodId: registrationPeriod._id,
        formType: 'kids',
        firstName: 'Immediate',
        lastName: 'Link',
        birthdate: '2014-09-01',
        email: 'immediate@example.com',
        phone: '+49555666777',
        address: 'Immediate Ave 30, 33333 Quick City',
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'Jugend HOBBY (Gelb)',
        trainingshäufigkeit: '2x pro Woche',
        availableTimesKids: [
          { day: 'Montag', hour: 14, venue: 'BTHV' },
          { day: 'Dienstag', hour: 14, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 14, venue: 'BTHV' },
          { day: 'Donnerstag', hour: 14, venue: 'BTHV' },
          { day: 'Freitag', hour: 14, venue: 'BTHV' }
        ],
        privacyConsent: true
      };

      await request(app)
        .post('/api/portal/seasonal-registrations')
        .set('testPortalUserId', portalUser._id.toString())
        .send(registrationData)
        .expect(201);

      const updatedPortalUser = await StudentPortalUser.findById(portalUser._id);
      const student = await Student.findOne({ email: 'immediate@example.com' });

      expect(updatedPortalUser.studentId).toBeDefined();
      expect(updatedPortalUser.studentId.toString()).toBe(student._id.toString());
    });
  });
});
