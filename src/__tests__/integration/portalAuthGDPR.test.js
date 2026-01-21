/**
 * Portal Auth GDPR Registration Tests
 *
 * Tests the new GDPR-compliant registration flow where users
 * provide their own personal data instead of selecting from
 * a public student list.
 *
 * Features tested:
 * - Registration with personal data (firstName, lastName, birthdate, phone)
 * - No studentId required during registration
 * - Email verification requirement
 * - Login blocked until email verified
 * - StudentPortalUser created without Student link
 */

import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import StudentPortalUser from '../../models/StudentPortalUser.js';
import Student from '../../models/Student.js';
import portalAuthRoutes from '../../routes/portalAuth.js';
import {
  connectTestDB,
  disconnectTestDB,
  clearTestDB,
} from '../../testHelpers.js';

const app = express();
app.use(express.json());
app.use('/api/portal/auth', portalAuthRoutes);

describe('Portal Auth - GDPR Registration', () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  describe('POST /api/portal/auth/register - GDPR Compliant', () => {
    const validRegistrationData = {
      email: 'test@example.com',
      password: 'TestPass123!',
      firstName: 'Max',
      lastName: 'Mustermann',
      birthdate: '1990-05-15',
      phone: '+49123456789'
    };

    test('Should register user with personal data (no studentId)', async () => {
      const res = await request(app)
        .post('/api/portal/auth/register')
        .send(validRegistrationData)
        .expect(201);

      expect(res.body.message).toContain('Registrierung erfolgreich');
      expect(res.body.userId).toBeDefined();
      expect(res.body.emailSent).toBe(true);

      // Verify user created in database
      const user = await StudentPortalUser.findById(res.body.userId);
      expect(user).toBeDefined();
      expect(user.email).toBe('test@example.com');
      expect(user.firstName).toBe('Max');
      expect(user.lastName).toBe('Mustermann');
      expect(user.birthdate).toEqual(new Date('1990-05-15'));
      expect(user.phone).toBe('+49123456789');
      expect(user.studentId).toBeNull(); // No Student linked yet
      expect(user.emailVerified).toBe(false);
      expect(user.verificationToken).toBeDefined();
      expect(user.verificationTokenExpires).toBeDefined();
    });

    test('Should register without phone (optional field)', async () => {
      const dataWithoutPhone = { ...validRegistrationData };
      delete dataWithoutPhone.phone;

      const res = await request(app)
        .post('/api/portal/auth/register')
        .send(dataWithoutPhone)
        .expect(201);

      const user = await StudentPortalUser.findById(res.body.userId);
      expect(user.phone).toBeNull();
    });

    test('Should reject registration without required fields', async () => {
      const testCases = [
        { field: 'email', error: 'Email und Passwort sind erforderlich' },
        { field: 'password', error: 'Email und Passwort sind erforderlich' },
        { field: 'firstName', error: 'Vorname, Nachname und Geburtsdatum sind erforderlich' },
        { field: 'lastName', error: 'Vorname, Nachname und Geburtsdatum sind erforderlich' },
        { field: 'birthdate', error: 'Vorname, Nachname und Geburtsdatum sind erforderlich' }
      ];

      for (const testCase of testCases) {
        const incompleteData = { ...validRegistrationData };
        delete incompleteData[testCase.field];

        const res = await request(app)
          .post('/api/portal/auth/register')
          .send(incompleteData)
          .expect(400);

        expect(res.body.error).toBe(testCase.error);
      }
    });

    test('Should reject password shorter than 8 characters', async () => {
      const res = await request(app)
        .post('/api/portal/auth/register')
        .send({ ...validRegistrationData, password: 'Short1!' })
        .expect(400);

      expect(res.body.error).toBe('Passwort muss mindestens 8 Zeichen lang sein');
    });

    test('Should reject duplicate email', async () => {
      // First registration
      await request(app)
        .post('/api/portal/auth/register')
        .send(validRegistrationData)
        .expect(201);

      // Second registration with same email
      const res = await request(app)
        .post('/api/portal/auth/register')
        .send(validRegistrationData)
        .expect(400);

      expect(res.body.error).toBe('Diese Email-Adresse ist bereits registriert');
    });

    test('Should convert email to lowercase', async () => {
      const res = await request(app)
        .post('/api/portal/auth/register')
        .send({ ...validRegistrationData, email: 'TEST@EXAMPLE.COM' })
        .expect(201);

      const user = await StudentPortalUser.findById(res.body.userId);
      expect(user.email).toBe('test@example.com');
    });

    test('Should hash password', async () => {
      const res = await request(app)
        .post('/api/portal/auth/register')
        .send(validRegistrationData)
        .expect(201);

      const user = await StudentPortalUser.findById(res.body.userId);
      expect(user.password).not.toBe(validRegistrationData.password);
      expect(user.password.length).toBeGreaterThan(50); // Hashed password is long

      // Verify password can be compared
      const isMatch = await user.comparePassword(validRegistrationData.password);
      expect(isMatch).toBe(true);
    });

    test('Should create verification token with 24h expiry', async () => {
      const res = await request(app)
        .post('/api/portal/auth/register')
        .send(validRegistrationData)
        .expect(201);

      const user = await StudentPortalUser.findById(res.body.userId);
      expect(user.verificationToken).toBeDefined();
      expect(user.verificationToken.length).toBe(64); // 32 bytes hex = 64 chars

      // Check expiry is approximately 24 hours from now
      const now = new Date();
      const expiryTime = user.verificationTokenExpires.getTime();
      const expectedExpiry = now.getTime() + (24 * 60 * 60 * 1000);
      const timeDiff = Math.abs(expiryTime - expectedExpiry);
      expect(timeDiff).toBeLessThan(5000); // Within 5 seconds
    });
  });

  describe('POST /api/portal/auth/login - Email Verification Required', () => {
    let unverifiedUser;
    let verifiedUser;

    beforeEach(async () => {
      // Create unverified user
      unverifiedUser = new StudentPortalUser({
        email: 'unverified@example.com',
        password: 'TestPass123!',
        firstName: 'Unverified',
        lastName: 'User',
        birthdate: new Date('1990-01-01'),
        emailVerified: false
      });
      await unverifiedUser.save();

      // Create verified user with linked Student
      const student = new Student({
        firstName: 'Verified',
        lastName: 'User',
        email: 'verified@example.com'
      });
      await student.save();

      verifiedUser = new StudentPortalUser({
        email: 'verified@example.com',
        password: 'TestPass123!',
        firstName: 'Verified',
        lastName: 'User',
        birthdate: new Date('1990-01-01'),
        studentId: student._id,
        emailVerified: true
      });
      await verifiedUser.save();
    });

    test('Should block login for unverified email', async () => {
      const res = await request(app)
        .post('/api/portal/auth/login')
        .send({
          email: 'unverified@example.com',
          password: 'TestPass123!'
        })
        .expect(403);

      expect(res.body.error).toContain('Email noch nicht verifiziert');
      expect(res.body.emailVerified).toBe(false);
    });

    test('Should allow login for verified email', async () => {
      const res = await request(app)
        .post('/api/portal/auth/login')
        .send({
          email: 'verified@example.com',
          password: 'TestPass123!'
        })
        .expect(200);

      expect(res.body.message).toBe('Login erfolgreich');
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe('verified@example.com');
      expect(res.body.user.studentId).toBeDefined();
    });

    test('Should allow login without studentId if verified', async () => {
      // Update verified user to have no studentId (newly registered, verified, but not yet registered for season)
      verifiedUser.studentId = null;
      await verifiedUser.save();

      const res = await request(app)
        .post('/api/portal/auth/login')
        .send({
          email: 'verified@example.com',
          password: 'TestPass123!'
        })
        .expect(200);

      expect(res.body.user.studentId).toBeUndefined();
      expect(res.body.user.firstName).toBe('Verified');
      expect(res.body.user.lastName).toBe('User');
    });
  });

  describe('POST /api/portal/auth/verify-email', () => {
    test('Should verify email with valid token', async () => {
      // Create user with verification token
      const user = new StudentPortalUser({
        email: 'verify@example.com',
        password: 'TestPass123!',
        firstName: 'Test',
        lastName: 'User',
        birthdate: new Date('1990-01-01'),
        verificationToken: 'valid-token-12345',
        verificationTokenExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
        emailVerified: false
      });
      await user.save();

      const res = await request(app)
        .post('/api/portal/auth/verify-email')
        .send({ token: 'valid-token-12345' })
        .expect(200);

      expect(res.body.message).toContain('Email erfolgreich verifiziert');
      expect(res.body.emailVerified).toBe(true);

      // Verify in database
      const updatedUser = await StudentPortalUser.findById(user._id);
      expect(updatedUser.emailVerified).toBe(true);
      expect(updatedUser.verificationToken).toBeUndefined();
      expect(updatedUser.verificationTokenExpires).toBeUndefined();
    });

    test('Should reject expired verification token', async () => {
      const user = new StudentPortalUser({
        email: 'expired@example.com',
        password: 'TestPass123!',
        firstName: 'Test',
        lastName: 'User',
        birthdate: new Date('1990-01-01'),
        verificationToken: 'expired-token',
        verificationTokenExpires: new Date(Date.now() - 1000), // Expired 1 second ago
        emailVerified: false
      });
      await user.save();

      const res = await request(app)
        .post('/api/portal/auth/verify-email')
        .send({ token: 'expired-token' })
        .expect(400);

      expect(res.body.error).toContain('Ungültiger oder abgelaufener');
    });

    test('Should reject invalid token', async () => {
      const res = await request(app)
        .post('/api/portal/auth/verify-email')
        .send({ token: 'invalid-token' })
        .expect(400);

      expect(res.body.error).toContain('Ungültiger oder abgelaufener');
    });
  });

  describe('GET /api/portal/auth/me - Current User Info', () => {
    test('Should return user info with personal data', async () => {
      // Create verified user without Student
      const user = new StudentPortalUser({
        email: 'current@example.com',
        password: 'TestPass123!',
        firstName: 'Current',
        lastName: 'User',
        birthdate: new Date('1990-01-01'),
        phone: '+49123456789',
        studentId: null,
        emailVerified: true
      });
      await user.save();

      // Login to get token
      const loginRes = await request(app)
        .post('/api/portal/auth/login')
        .send({
          email: 'current@example.com',
          password: 'TestPass123!'
        });

      const cookies = loginRes.headers['set-cookie'];

      // Get current user
      const res = await request(app)
        .get('/api/portal/auth/me')
        .set('Cookie', cookies)
        .expect(200);

      expect(res.body.email).toBe('current@example.com');
      expect(res.body.firstName).toBe('Current');
      expect(res.body.lastName).toBe('User');
      expect(res.body.emailVerified).toBe(true);
      expect(res.body.studentId).toBeUndefined(); // No Student linked yet
    });
  });
});
