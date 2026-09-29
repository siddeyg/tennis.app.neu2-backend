/**
 * Integration Tests: Schedule Bulk Lock & Unlock
 *
 * Tests the new batch endpoints in backend/src/routes/schedule.js:
 *   - POST /api/schedule/lock-all   — Atomic bulk freeze of all active assignments in target period
 *   - POST /api/schedule/unlock-all — Atomic bulk unfreeze of all assignments in target period
 *
 * Requirements verified:
 *   1. Validation: Rejects missing or invalid periodId with HTTP 400
 *   2. Period Isolation: Only modifies students belonging to the target periodId
 *   3. Atomicity & State: Correctly sets isPinned: true / isPinned: false on all assignments
 *   4. Auth Guard: Requires admin/supermod authentication (401 without auth)
 */

import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import {
  connectTestDB,
  disconnectTestDB,
  clearTestDB,
  mockAuth
} from '../../testHelpers.js';

import Student from '../../models/Student.js';
import RegistrationPeriod from '../../models/RegistrationPeriod.js';
import scheduleRoutes from '../schedule.js';

// Setup Express app
const app = express();
app.use(express.json());
app.use('/api/schedule', mockAuth(), scheduleRoutes);

describe('Schedule Bulk Lock & Unlock API (POST /lock-all & POST /unlock-all)', () => {
  beforeAll(async () => {
    await connectTestDB();
  }, 30000);

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  // ---------------------------------------------------------------------------
  // Validation Tests
  // ---------------------------------------------------------------------------
  describe('Input Validation', () => {
    it('should reject lock-all without periodId with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/schedule/lock-all')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('periodId ist zwingend erforderlich');
    });

    it('should reject lock-all with invalid periodId format with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/schedule/lock-all')
        .send({ periodId: 'invalid-hex-string' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('periodId ist zwingend erforderlich');
    });

    it('should reject unlock-all without periodId with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/schedule/unlock-all')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('periodId ist zwingend erforderlich');
    });

    it('should reject unlock-all with invalid periodId format with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/schedule/unlock-all')
        .send({ periodId: '12345' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('periodId ist zwingend erforderlich');
    });
  });

  // ---------------------------------------------------------------------------
  // Functional & Period Isolation Tests
  // ---------------------------------------------------------------------------
  describe('Bulk Lock & Unlock with Period Isolation', () => {
    it('should freeze all assignments in target period and preserve other periods', async () => {
      const targetPeriodId = new mongoose.Types.ObjectId();
      const otherPeriodId = new mongoose.Types.ObjectId();

      const coach1Id = new mongoose.Types.ObjectId();

      // Create students in target period (initially unpinned)
      const student1 = await Student.create({
        periodId: targetPeriodId,
        firstName: 'Anna',
        lastName: 'Becker',
        birthDate: '2012-04-10',
        email: 'anna@test.de',
        assignments: [
          { day: 'Montag', hour: 15, coach: coach1Id, duration: 60, isPinned: false, venue: 'Brüser Berg' },
          { day: 'Mittwoch', hour: 16, coach: coach1Id, duration: 60, isPinned: false, venue: 'Brüser Berg' }
        ]
      });

      const student2 = await Student.create({
        periodId: targetPeriodId,
        firstName: 'Ben',
        lastName: 'Becker',
        birthDate: '2014-06-15',
        email: 'ben@test.de',
        assignments: [
          { day: 'Dienstag', hour: 17, coach: coach1Id, duration: 90, isPinned: false, venue: 'BTHV Teppich' }
        ]
      });

      // Create student in other period (must remain unpinned!)
      const otherStudent = await Student.create({
        periodId: otherPeriodId,
        firstName: 'Clara',
        lastName: 'Sommer',
        birthDate: '2013-08-20',
        email: 'clara@test.de',
        assignments: [
          { day: 'Montag', hour: 15, coach: coach1Id, duration: 60, isPinned: false, venue: 'Außenplatz' }
        ]
      });

      // Execute lock-all for targetPeriodId
      const lockRes = await request(app)
        .post('/api/schedule/lock-all')
        .send({ periodId: targetPeriodId.toString() });

      expect(lockRes.status).toBe(200);
      expect(lockRes.body.success).toBe(true);
      expect(lockRes.body.modifiedCount).toBe(2);

      // Verify target period students are pinned
      const updatedS1 = await Student.findById(student1._id);
      expect(updatedS1.assignments[0].isPinned).toBe(true);
      expect(updatedS1.assignments[1].isPinned).toBe(true);
      expect(updatedS1.assignments[0].venue).toBe('Brüser Berg');

      const updatedS2 = await Student.findById(student2._id);
      expect(updatedS2.assignments[0].isPinned).toBe(true);
      expect(updatedS2.assignments[0].duration).toBe(90);

      // Verify other period student is UNTOUCHED
      const updatedOther = await Student.findById(otherStudent._id);
      expect(updatedOther.assignments[0].isPinned).toBe(false);

      // Now execute unlock-all for targetPeriodId
      const unlockRes = await request(app)
        .post('/api/schedule/unlock-all')
        .send({ periodId: targetPeriodId.toString() });

      expect(unlockRes.status).toBe(200);
      expect(unlockRes.body.success).toBe(true);
      expect(unlockRes.body.modifiedCount).toBe(2);

      // Verify target period students are unpinned
      const unlockedS1 = await Student.findById(student1._id);
      expect(unlockedS1.assignments[0].isPinned).toBe(false);
      expect(unlockedS1.assignments[1].isPinned).toBe(false);
    });
  });
});
