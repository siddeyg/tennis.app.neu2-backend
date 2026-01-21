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
const mockPortalAuth = (req, res, next) => {
  req.user = {
    id: req.testPortalUserId,
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
        trainingsart: 'Orange',
        trainingshäufigkeit: '2',
        teamParticipation: true,
        availableTimesKids: ['Montag 14', 'Montag 15', 'Mittwoch 14', 'Mittwoch 15', 'Freitag 14'],
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
      expect(student.trainigGroup).toBe('Orange');
      expect(student.frequence).toBe('2');

      const updatedPortalUser = await StudentPortalUser.findById(portalUser._id);
      expect(updatedPortalUser.studentId).toBeDefined();

      const registration = await SeasonalRegistration.findOne({
        studentPortalUserId: portalUser._id,
        periodId: registrationPeriod._id
      });
      expect(registration.status).toBe('processed');
    });

    test('Should NOT create duplicate Student on second registration', async () => {
      const registrationData1 = {
        periodId: registrationPeriod._id,
        formType: 'kids',
        firstName: 'Emma',
        lastName: 'Test',
        birthdate: '2014-03-20',
        email: 'emma@example.com',
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'Gelb Team',
        trainingshäufigkeit: '3',
        availableTimesKids: ['Montag 14', 'Dienstag 15', 'Mittwoch 14', 'Donnerstag 15', 'Freitag 14'],
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
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'Grün',
        trainingshäufigkeit: '2',
        availableTimesKids: ['Montag 15', 'Dienstag 15', 'Mittwoch 15', 'Donnerstag 15', 'Freitag 15'],
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
        mitgliedsstatus: 'Nicht-Mitglied',
        trainingsart: 'Rot',
        trainingshäufigkeit: '1',
        teamParticipation: false,
        availableTimesKids: ['Montag 14', 'Dienstag 14', 'Mittwoch 14', 'Donnerstag 14', 'Freitag 14'],
        privacyConsent: true
      };

      await request(app)
        .post('/api/portal/seasonal-registrations')
        .set('testPortalUserId', portalUser._id.toString())
        .send(registrationData)
        .expect(201);

      const student = await Student.findOne({ email: 'leon@example.com' });
      expect(student.member).toBe(false);
      expect(student.trainigGroup).toBe('Rot');
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
        spielstärke: 'gute:r Spieler:in',
        trainingGoals: ['Matchtraining', 'Technik', 'Taktik'],
        groupSize: ['2er', '3er'],
        availableTimesAdults: ['Montag 19', 'Mittwoch 19', 'Freitag 19', 'Samstag 10', 'Samstag 11'],
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
      expect(student.skillLevel).toBe('gute:r Spieler:in');
      expect(student.comment2).toBe('Matchtraining, Technik, Taktik');
      expect(student.groupSize).toBe('2er, 3er');
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
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'Orange',
        trainingshäufigkeit: '2',
        availableTimesKids: ['Montag 14', 'Dienstag 14', 'Mittwoch 14', 'Donnerstag 14', 'Freitag 14'],
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

      expect(registration.status).toBe('processed');
      expect(registration.processedAt).toBeInstanceOf(Date);
    });

    test('Should set processedAt timestamp on auto-approval', async () => {
      const registrationData = {
        periodId: registrationPeriod._id,
        formType: 'kids',
        firstName: 'Timestamp',
        lastName: 'Test',
        birthdate: '2011-06-15',
        email: 'timestamp@example.com',
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'Grün',
        trainingshäufigkeit: '2',
        availableTimesKids: ['Montag 14', 'Dienstag 14', 'Mittwoch 14', 'Donnerstag 14', 'Freitag 14'],
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

      expect(registration.processedAt).toBeDefined();
      expect(registration.processedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(registration.processedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    test('Should link Student immediately (not pending admin review)', async () => {
      const registrationData = {
        periodId: registrationPeriod._id,
        formType: 'kids',
        firstName: 'Immediate',
        lastName: 'Link',
        birthdate: '2014-09-01',
        email: 'immediate@example.com',
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'Gelb Hobby',
        trainingshäufigkeit: '2',
        availableTimesKids: ['Montag 14', 'Dienstag 14', 'Mittwoch 14', 'Donnerstag 14', 'Freitag 14'],
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
