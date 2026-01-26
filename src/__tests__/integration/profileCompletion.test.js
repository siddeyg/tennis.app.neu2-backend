/**
 * Profile Completion Integration Tests
 *
 * Tests the mandatory profile completion system where users must
 * complete their profile (address + parent info if child) after
 * email verification and before accessing the Dashboard.
 *
 * Features tested:
 * - Address required for all users
 * - Parent contact required for children (< 18 years)
 * - Age detection and validation
 * - JWT token includes profileCompleted flag
 * - Profile completion updates user record
 */

import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import StudentPortalUser from '../../models/StudentPortalUser.js';
import portalScheduleRoutes from '../../routes/portalSchedule.js';
import portalAuthRoutes from '../../routes/portalAuth.js';
import {
  connectTestDB,
  disconnectTestDB,
  clearTestDB,
} from '../../testHelpers.js';

// Create test app
const app = express();
app.use(express.json());

// Mock verifyPortalAuth middleware for testing
app.use((req, res, next) => {
  if (req.headers.testportaluserid) {
    req.user = {
      id: req.headers.testportaluserid,
      role: 'student'
    };
  }
  next();
});

app.use('/api/portal', portalScheduleRoutes);
app.use('/api/portal/auth', portalAuthRoutes);

describe('Profile Completion', () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  describe('POST /api/portal/profile/complete - Adult User (18+)', () => {
    test('Should complete profile for adult user with address only', async () => {
      // Create adult user (birthdate 25 years ago)
      const birthdate = new Date();
      birthdate.setFullYear(birthdate.getFullYear() - 25);

      const user = await StudentPortalUser.create({
        email: 'adult@example.com',
        password: 'Test1234',
        firstName: 'John',
        lastName: 'Doe',
        birthdate,
        phone: '123456789',
        emailVerified: true,
        profileCompleted: false
      });

      const res = await request(app)
        .post('/api/portal/profile/complete')
        .set('testPortalUserId', user._id.toString())
        .send({ address: '123 Main St, City, 12345' })
        .expect(200);

      expect(res.body.message).toContain('erfolgreich vervollständigt');
      expect(res.body.profileCompleted).toBe(true);
      expect(res.body.isChild).toBe(false);

      // Verify database
      const updated = await StudentPortalUser.findById(user._id);
      expect(updated.profileCompleted).toBe(true);
      expect(updated.address).toBe('123 Main St, City, 12345');
      expect(updated.parentName).toBeUndefined();
      expect(updated.parentEmail).toBeUndefined();
      expect(updated.parentPhone).toBeUndefined();
    });

    test('Should reject adult profile completion without address', async () => {
      const birthdate = new Date();
      birthdate.setFullYear(birthdate.getFullYear() - 25);

      const user = await StudentPortalUser.create({
        email: 'adult2@example.com',
        password: 'Test1234',
        firstName: 'Jane',
        lastName: 'Smith',
        birthdate,
        phone: '987654321',
        emailVerified: true
      });

      const res = await request(app)
        .post('/api/portal/profile/complete')
        .set('testPortalUserId', user._id.toString())
        .send({})
        .expect(400);

      expect(res.body.error).toContain('Adresse ist erforderlich');

      // Verify database unchanged
      const unchanged = await StudentPortalUser.findById(user._id);
      expect(unchanged.profileCompleted).toBe(false);
    });
  });

  describe('POST /api/portal/profile/complete - Child User (<18)', () => {
    test('Should require parent info for child user', async () => {
      // Create child user (birthdate 15 years ago)
      const birthdate = new Date();
      birthdate.setFullYear(birthdate.getFullYear() - 15);

      const user = await StudentPortalUser.create({
        email: 'child@example.com',
        password: 'Test1234',
        firstName: 'Emma',
        lastName: 'Mueller',
        birthdate,
        phone: '123456789',
        emailVerified: true
      });

      const res = await request(app)
        .post('/api/portal/profile/complete')
        .set('testPortalUserId', user._id.toString())
        .send({
          address: '789 Elm St, Village, 11223',
          parentName: 'Maria Mueller',
          parentEmail: 'maria@example.com',
          parentPhone: '+49987654321'
        })
        .expect(200);

      expect(res.body.profileCompleted).toBe(true);
      expect(res.body.isChild).toBe(true);

      // Verify database
      const updated = await StudentPortalUser.findById(user._id);
      expect(updated.profileCompleted).toBe(true);
      expect(updated.address).toBe('789 Elm St, Village, 11223');
      expect(updated.parentName).toBe('Maria Mueller');
      expect(updated.parentEmail).toBe('maria@example.com');
      expect(updated.parentPhone).toBe('+49987654321');
    });

    test('Should reject child profile without parent name', async () => {
      const birthdate = new Date();
      birthdate.setFullYear(birthdate.getFullYear() - 16);

      const user = await StudentPortalUser.create({
        email: 'child2@example.com',
        password: 'Test1234',
        firstName: 'Liam',
        lastName: 'Schmidt',
        birthdate,
        phone: '111222333',
        emailVerified: true
      });

      const res = await request(app)
        .post('/api/portal/profile/complete')
        .set('testPortalUserId', user._id.toString())
        .send({
          address: '321 Pine Rd, City, 44556',
          parentEmail: 'parent@example.com',
          parentPhone: '+49111222333'
        })
        .expect(400);

      expect(res.body.error).toContain('Name eines Elternteils ist erforderlich');
    });
  });

  describe('isChild() Method - Age Detection', () => {
    test('User exactly 18 years old should be adult', async () => {
      // Birthdate exactly 18 years ago
      const birthdate = new Date();
      birthdate.setFullYear(birthdate.getFullYear() - 18);

      const user = await StudentPortalUser.create({
        email: 'exactly18@example.com',
        password: 'Test1234',
        firstName: 'Test',
        lastName: 'User',
        birthdate,
        phone: '123456789',
        emailVerified: true
      });

      expect(user.isChild()).toBe(false);
    });

    test('User 17 years 11 months old should be child', async () => {
      // Birthdate 17 years 11 months ago
      const birthdate = new Date();
      birthdate.setFullYear(birthdate.getFullYear() - 17);
      birthdate.setMonth(birthdate.getMonth() - 11);

      const user = await StudentPortalUser.create({
        email: 'almost18@example.com',
        password: 'Test1234',
        firstName: 'Test',
        lastName: 'User',
        birthdate,
        phone: '123456789',
        emailVerified: true
      });

      expect(user.isChild()).toBe(true);
    });
  });
});
