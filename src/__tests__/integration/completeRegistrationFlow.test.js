/**
 * Complete Registration Flow - End-to-End Integration Test
 *
 * Tests the complete GDPR-compliant user journey from registration
 * to seasonal training signup with auto-created Student record.
 */

import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import StudentPortalUser from '../../models/StudentPortalUser.js';
import Student from '../../models/Student.js';
import RegistrationPeriod from '../../models/RegistrationPeriod.js';
import SeasonalRegistration from '../../models/SeasonalRegistration.js';
import User from '../../models/User.js';
import portalAuthRoutes from '../../routes/portalAuth.js';
import portalSeasonalRegistrationsRoutes from '../../routes/portalSeasonalRegistrations.js';
import {
  connectTestDB,
  disconnectTestDB,
  clearTestDB,
} from '../../testHelpers.js';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/portal/auth', portalAuthRoutes);
app.use('/api/portal/seasonal-registrations', portalSeasonalRegistrationsRoutes);

describe('Complete Registration Flow - E2E', () => {
  let registrationPeriod;
  let adminUser;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    // Create mock admin user
    adminUser = new User({
      email: 'admin@test.com',
      password: 'hashedpassword123',
      firstName: 'Test',
      lastName: 'Admin',
      role: 'admin',
    });
    await adminUser.save();

    // Create active registration period
    registrationPeriod = new RegistrationPeriod({
      name: 'Summer 2026 Training',
      season: 'summer',
      registrationStart: new Date('2026-01-01'),
      registrationDeadline: new Date('2026-12-31'),
      trainingStartDate: new Date('2026-04-01'),
      trainingEndDate: new Date('2026-09-30'),
      isActive: true,
      status: 'open',
      currentPlanId: new mongoose.Types.ObjectId(),
      createdBy: adminUser._id,
      kidsFormConfig: {
        enabledFields: ['mitgliedsstatus', 'trainingsart', 'trainingshäufigkeit', 'teamParticipation', 'availableTimesKids'],
        requiredFields: ['mitgliedsstatus', 'trainingsart', 'trainingshäufigkeit', 'availableTimesKids']
      }
    });
    await registrationPeriod.save();
  });

  test('Complete Flow: Registration → Verification → Login → Seasonal Registration → Student Created', async () => {
    const userEmail = 'e2e@example.com';
    const userPassword = 'SecurePass123!';

    // STEP 1: User Registers
    const registrationRes = await request(app)
      .post('/api/portal/auth/register')
      .send({
        email: userEmail,
        password: userPassword,
        firstName: 'Emma',
        lastName: 'E2E-Test',
        birthdate: '2013-07-20',
        sex: 'weiblich',
        member: false,
        phone: '+49111222333',
        address: 'Teststraße 1, 10115 Berlin',
        parentName: 'Maria E2E-Test',
        parentEmail: 'parent-e2e@example.com',
        parentPhone: '+49111222000'
      })
      .expect(201);

    expect(registrationRes.body.message).toContain('Registrierung erfolgreich');
    const userId = registrationRes.body.userId;

    let user = await StudentPortalUser.findById(userId);
    expect(user.emailVerified).toBe(false);
    expect(user.studentId).toBeNull();

    // STEP 2: User Tries to Login (Should Fail)
    const loginFailRes = await request(app)
      .post('/api/portal/auth/login')
      .send({ email: userEmail, password: userPassword })
      .expect(403);

    expect(loginFailRes.body.error).toContain('Email noch nicht verifiziert');

    // STEP 3: Simulate email verification via direct DB update
    // (Raw token not accessible in test env — route stores SHA-256 hash)
    // Also set profileCompleted: true (normally set via profile edit page)
    await StudentPortalUser.findByIdAndUpdate(userId, {
      emailVerified: true,
      profileCompleted: true,
      $unset: { verificationToken: 1, verificationTokenExpires: 1 }
    });

    user = await StudentPortalUser.findById(userId);
    expect(user.emailVerified).toBe(true);

    // STEP 4: User Logs In Successfully
    const loginSuccessRes = await request(app)
      .post('/api/portal/auth/login')
      .send({ email: userEmail, password: userPassword })
      .expect(200);

    expect(loginSuccessRes.body.message).toBe('Login erfolgreich');
    const authCookies = loginSuccessRes.headers['set-cookie'];

    // STEP 5: User Submits Seasonal Registration
    const seasonalRegData = {
      periodId: registrationPeriod._id,
      formType: 'kids',
      firstName: 'Emma',
      lastName: 'E2E-Test',
      birthdate: '2013-07-20',
      email: userEmail,
      phone: '+49111222333',
      address: 'E2E-Teststr. 99, 10115 Berlin',
      mitgliedsstatus: 'Mitglied',
      trainingsart: 'Jugend TEAM (Gelb)',
      trainingshäufigkeit: '2x pro Woche',
      teamParticipation: 'Team',
      availableTimesKids: [
        { day: 'Dienstag', hour: 15, venue: 'BTHV' },
        { day: 'Dienstag', hour: 16, venue: 'BTHV' },
        { day: 'Donnerstag', hour: 15, venue: 'BTHV' },
        { day: 'Donnerstag', hour: 16, venue: 'BTHV' },
        { day: 'Freitag', hour: 15, venue: 'BTHV' },
      ],
      privacyConsent: true,
      remarks: 'E2E Test - Bitte Teamtraining'
    };

    const seasonalRegRes = await request(app)
      .post('/api/portal/seasonal-registrations')
      .set('Cookie', authCookies)
      .send(seasonalRegData)
      .expect(201);

    expect(seasonalRegRes.body.success).toBe(true);

    // STEP 6: Verify Student Auto-Created
    const students = await Student.find({});
    expect(students).toHaveLength(1);

    const student = students[0];
    expect(student.firstName).toBe('Emma');
    expect(student.lastName).toBe('E2E-Test');
    expect(student.member).toBe(true);
    expect(student.trainigGroup).toBe('Gelb Team'); // mapped from 'Jugend TEAM (Gelb)'
    expect(student.frequence).toBe('2');

    // STEP 7: Verify StudentPortalUser Linked
    user = await StudentPortalUser.findById(userId);
    expect(user.studentId).toBeDefined();
    expect(user.studentId.toString()).toBe(student._id.toString());

    // STEP 8: Verify Registration Auto-Approved
    const seasonalReg = await SeasonalRegistration.findOne({
      studentPortalUserId: userId,
      periodId: registrationPeriod._id
    });

    expect(seasonalReg.status).toBe('processed');
    expect(seasonalReg.processedAt).toBeDefined();

    // STEP 9: User Can Login Again and See Student Info
    const secondLoginRes = await request(app)
      .post('/api/portal/auth/login')
      .send({ email: userEmail, password: userPassword })
      .expect(200);

    expect(secondLoginRes.body.user.studentId).toBeDefined();
    expect(secondLoginRes.body.user.studentName).toBe('Emma E2E-Test');

    // STEP 10: Admin Can See Student in Database
    const allStudents = await Student.find({});
    expect(allStudents).toHaveLength(1);
    expect(allStudents[0].email).toBe(userEmail);
  });

  test('Complete Flow: Adult User Registration', async () => {
    const userEmail = 'adult-e2e@example.com';
    const userPassword = 'AdultPass123!';

    registrationPeriod.adultsFormConfig = {
      enabledFields: ['spielstärke', 'trainingGoals', 'groupSize', 'availableTimesAdults'],
      requiredFields: ['spielstärke', 'availableTimesAdults']
    };
    await registrationPeriod.save();

    // Register
    const regRes = await request(app)
      .post('/api/portal/auth/register')
      .send({
        email: userEmail,
        password: userPassword,
        firstName: 'Peter',
        lastName: 'Erwachsen',
        birthdate: '1982-11-05',
        sex: 'männlich',
        member: false,
        phone: '+49222333444',
        address: 'Erwachsenenstr. 5, 80331 München'
      })
      .expect(201);

    const userId = regRes.body.userId;
    let user = await StudentPortalUser.findById(userId);

    // Simulate email verification + profile completion via direct DB update
    await StudentPortalUser.findByIdAndUpdate(userId, {
      emailVerified: true,
      profileCompleted: true,
      $unset: { verificationToken: 1, verificationTokenExpires: 1 }
    });

    // Login
    const loginRes = await request(app)
      .post('/api/portal/auth/login')
      .send({ email: userEmail, password: userPassword })
      .expect(200);

    const authCookies = loginRes.headers['set-cookie'];

    // Submit seasonal registration
    await request(app)
      .post('/api/portal/seasonal-registrations')
      .set('Cookie', authCookies)
      .send({
        periodId: registrationPeriod._id,
        formType: 'adults',
        firstName: 'Peter',
        lastName: 'Erwachsen',
        birthdate: '1982-11-05',
        email: userEmail,
        phone: '+49222333444',
        address: 'Erwachsenenstr. 7, 80331 München',
        spielstärke: 'Fortgeschrittene',
        trainingGoals: ['Turniere', 'Fitness'],
        groupSize: ['zu zweit', 'zu dritt'],
        availableTimesAdults: [
          { day: 'Montag', hour: '19:00', venue: 'BTHV' },
          { day: 'Mittwoch', hour: '19:00', venue: 'BTHV' },
          { day: 'Freitag', hour: '19:00', venue: 'BTHV' },
          { day: 'Samstag', hour: '10:00', venue: 'BTHV' },
          { day: 'Samstag', hour: '11:00', venue: 'BTHV' },
        ],
        privacyConsent: true,
        remarks: 'Bevorzugt Doppeltraining'
      })
      .expect(201);

    // Verify adult Student created
    const student = await Student.findOne({ email: userEmail });
    expect(student).toBeDefined();
    expect(student.adult).toBe(true);
    expect(student.skillLevel).toBe('Fortgeschrittene');
    expect(student.comment2).toBe('Turniere, Fitness');
    expect(student.groupSize).toBe('zu zweit, zu dritt');
    expect(student.frequence).toBe('1');
  });

  test('Error Handling: Cannot register for season without email verification', async () => {
    // Register user but don't verify
    const regRes = await request(app)
      .post('/api/portal/auth/register')
      .send({
        email: 'unverified-e2e@example.com',
        password: 'TestPass123!',
        firstName: 'Unverified',
        lastName: 'User',
        birthdate: '2010-01-01',
        sex: 'weiblich',
        member: false,
        address: 'Testweg 9, 10115 Berlin',
        parentName: 'Test Elternteil',
        parentEmail: 'parent-unverified@example.com',
        parentPhone: '+49100200300'
      })
      .expect(201);

    // Try to login (should fail)
    const loginRes = await request(app)
      .post('/api/portal/auth/login')
      .send({ email: 'unverified-e2e@example.com', password: 'TestPass123!' })
      .expect(403);

    expect(loginRes.body.error).toContain('Email noch nicht verifiziert');

    // Verify no Student was created
    const students = await Student.find({});
    expect(students).toHaveLength(0);
  });

  test('GDPR Compliance: No public student list exposure', async () => {
    // Create some students in database
    const student1 = new Student({
      firstName: 'Private',
      lastName: 'Student1',
      email: 'private1@example.com',
      birthDate: '2010-01-01'
    });
    await student1.save();

    const student2 = new Student({
      firstName: 'Private',
      lastName: 'Student2',
      email: 'private2@example.com',
      birthDate: '2011-01-01'
    });
    await student2.save();

    // Registration should NOT require selecting from student list
    const regRes = await request(app)
      .post('/api/portal/auth/register')
      .send({
        email: 'gdpr-test@example.com',
        password: 'TestPass123!',
        firstName: 'New',
        lastName: 'User',
        birthdate: '2012-06-15',
        sex: 'weiblich',
        member: false,
        address: 'DSGVO-Str. 1, 10115 Berlin',
        parentName: 'GDPR Elternteil',
        parentEmail: 'parent-gdpr@example.com',
        parentPhone: '+49100200400'
      })
      .expect(201);

    expect(regRes.body.userId).toBeDefined();

    // Verify new user created without needing existing student data
    const user = await StudentPortalUser.findById(regRes.body.userId);
    expect(user.firstName).toBe('New');
    expect(user.lastName).toBe('User');
    expect(user.studentId).toBeNull();
  });
});
