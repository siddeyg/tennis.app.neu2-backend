import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import Student from '../../models/Student.js';
import StudentPortalUser from '../../models/StudentPortalUser.js';
import Absence from '../../models/Absence.js';
import portalScheduleRoutes from '../../routes/portalSchedule.js';
import {
  connectTestDB,
  disconnectTestDB,
  clearTestDB,
  createTestStudent,
} from '../../testHelpers.js';

// Create Express app for testing
const app = express();
app.use(express.json());
app.use(cookieParser());

// Mock portal authentication middleware
const mockPortalAuth = () => {
  return (req, res, next) => {
    req.user = {
      id: req.testPortalUserId || new mongoose.Types.ObjectId(),
      role: 'student',
      studentId: req.testStudentId || new mongoose.Types.ObjectId(),
    };
    next();
  };
};

app.use(mockPortalAuth());
app.use('/api/portal', portalScheduleRoutes);

describe('Absences API Integration Tests', () => {
  let testStudent;
  let testPortalUser;

  // Setup: Connect to in-memory DB before all tests
  beforeAll(async () => {
    await connectTestDB();
  });

  // Cleanup: Clear DB between each test
  afterEach(async () => {
    await clearTestDB();
  });

  // Teardown: Disconnect after all tests
  afterAll(async () => {
    await disconnectTestDB();
  });

  // Helper to create test data
  const createTestData = async () => {
    testStudent = await Student.create(
      createTestStudent({
        firstName: 'Max',
        lastName: 'Mustermann',
        assignments: [{ day: 'Montag', hour: 14, coach: null }],
      })
    );

    testPortalUser = await StudentPortalUser.create({
      email: 'max.mustermann@test.com',
      password: 'testpassword123',
      firstName: 'Max',
      lastName: 'Mustermann',
      studentId: testStudent._id,
      emailVerified: true,
    });

    return { testStudent, testPortalUser };
  };

  describe('POST /api/portal/absences', () => {
    test('should create new absence notification', async () => {
      const { testStudent, testPortalUser } = await createTestData();
      app.request.testStudentId = testStudent._id;
      app.request.testPortalUserId = testPortalUser._id;

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const absenceData = {
        absenceDate: tomorrow.toISOString().split('T')[0],
        day: 'Montag',
        hour: 14,
        absenceType: 'illness',
        reason: 'Ich bin krank',
      };

      const response = await request(app)
        .post('/api/portal/absences')
        .send(absenceData);

      expect(response.status).toBe(201);
      expect(response.body.absenceType).toBe('illness');
      expect(response.body.status).toBe('pending');
      expect(response.body.reason).toBe('Ich bin krank');
      expect(response.body.day).toBe('Montag');
      expect(response.body.hour).toBe(14);
    });

    test('should reject absence for past date', async () => {
      const { testStudent, testPortalUser } = await createTestData();
      app.request.testStudentId = testStudent._id;
      app.request.testPortalUserId = testPortalUser._id;

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const absenceData = {
        absenceDate: yesterday.toISOString().split('T')[0],
        day: 'Montag',
        hour: 14,
        absenceType: 'illness',
        reason: 'Test',
      };

      const response = await request(app)
        .post('/api/portal/absences')
        .send(absenceData);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('vergangene Termine');
    });

    test('should validate required fields', async () => {
      const { testStudent, testPortalUser } = await createTestData();
      app.request.testStudentId = testStudent._id;
      app.request.testPortalUserId = testPortalUser._id;

      const invalidData = {
        absenceDate: new Date().toISOString().split('T')[0],
        // Missing day, hour, absenceType, reason
      };

      const response = await request(app)
        .post('/api/portal/absences')
        .send(invalidData);

      expect(response.status).toBe(400);
    });

    test('should validate absenceType enum', async () => {
      const { testStudent, testPortalUser } = await createTestData();
      app.request.testStudentId = testStudent._id;
      app.request.testPortalUserId = testPortalUser._id;

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const invalidData = {
        absenceDate: tomorrow.toISOString().split('T')[0],
        day: 'Montag',
        hour: 14,
        absenceType: 'invalid_type',
        reason: 'Test',
      };

      const response = await request(app)
        .post('/api/portal/absences')
        .send(invalidData);

      expect(response.status).toBe(400);
    });

    test('should enforce reason max length (500 chars)', async () => {
      const { testStudent, testPortalUser } = await createTestData();
      app.request.testStudentId = testStudent._id;
      app.request.testPortalUserId = testPortalUser._id;

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const longReason = 'a'.repeat(501);

      const absenceData = {
        absenceDate: tomorrow.toISOString().split('T')[0],
        day: 'Montag',
        hour: 14,
        absenceType: 'illness',
        reason: longReason,
      };

      const response = await request(app)
        .post('/api/portal/absences')
        .send(absenceData);

      expect(response.status).toBe(400);
    });

    test('should allow all 4 absence types', async () => {
      const { testStudent, testPortalUser } = await createTestData();
      app.request.testStudentId = testStudent._id;
      app.request.testPortalUserId = testPortalUser._id;

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const types = ['illness', 'vacation', 'school', 'other'];

      for (let i = 0; i < types.length; i++) {
        const type = types[i];
        const absenceData = {
          absenceDate: tomorrow.toISOString().split('T')[0],
          day: 'Montag',
          hour: 14 + i, // Different hour for each type to avoid duplicate
          absenceType: type,
          reason: `Test ${type}`,
        };

        const response = await request(app)
          .post('/api/portal/absences')
          .send(absenceData);

        expect(response.status).toBe(201);
        expect(response.body.absenceType).toBe(type);
      }
    });
  });

  describe('GET /api/portal/absences/upcoming', () => {
    test('should return upcoming absences', async () => {
      const { testStudent, testPortalUser } = await createTestData();
      app.request.testStudentId = testStudent._id;
      app.request.testPortalUserId = testPortalUser._id;

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);

      // Create upcoming absences
      await Absence.create([
        {
          studentId: testStudent._id,
          portalUserId: testPortalUser._id,
          absenceDate: tomorrow,
          day: 'Montag',
          hour: 14,
          absenceType: 'illness',
          reason: 'Tomorrow',
          status: 'pending',
        },
        {
          studentId: testStudent._id,
          portalUserId: testPortalUser._id,
          absenceDate: nextWeek,
          day: 'Montag',
          hour: 14,
          absenceType: 'vacation',
          reason: 'Next week',
          status: 'pending',
        },
      ]);

      const response = await request(app).get('/api/portal/absences/upcoming');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
    });

    test('should not return past absences in upcoming', async () => {
      const { testStudent, testPortalUser } = await createTestData();
      app.request.testStudentId = testStudent._id;
      app.request.testPortalUserId = testPortalUser._id;

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      // Create past absence (manually bypass validation)
      await Absence.collection.insertOne({
        studentId: testStudent._id,
        portalUserId: testPortalUser._id,
        absenceDate: yesterday,
        day: 'Montag',
        hour: 14,
        absenceType: 'illness',
        reason: 'Yesterday',
        status: 'pending',
      });

      const response = await request(app).get('/api/portal/absences/upcoming');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(0);
    });

    test('should not return cancelled absences in upcoming', async () => {
      const { testStudent, testPortalUser } = await createTestData();
      app.request.testStudentId = testStudent._id;
      app.request.testPortalUserId = testPortalUser._id;

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      await Absence.create({
        studentId: testStudent._id,
        portalUserId: testPortalUser._id,
        absenceDate: tomorrow,
        day: 'Montag',
        hour: 14,
        absenceType: 'illness',
        reason: 'Cancelled',
        status: 'cancelled',
      });

      const response = await request(app).get('/api/portal/absences/upcoming');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(0);
    });
  });

  describe('GET /api/portal/absences', () => {
    test('should return all absences (upcoming + history)', async () => {
      const { testStudent, testPortalUser } = await createTestData();
      app.request.testStudentId = testStudent._id;
      app.request.testPortalUserId = testPortalUser._id;

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Create mix of past and future
      await Absence.collection.insertMany([
        {
          studentId: testStudent._id,
          portalUserId: testPortalUser._id,
          absenceDate: yesterday,
          day: 'Montag',
          hour: 14,
          absenceType: 'illness',
          reason: 'Past',
          status: 'acknowledged',
        },
        {
          studentId: testStudent._id,
          portalUserId: testPortalUser._id,
          absenceDate: tomorrow,
          day: 'Montag',
          hour: 14,
          absenceType: 'vacation',
          reason: 'Future',
          status: 'pending',
        },
      ]);

      const response = await request(app).get('/api/portal/absences');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
    });

    test('should return empty array if no absences', async () => {
      const { testStudent } = await createTestData();
      app.request.testStudentId = testStudent._id;

      const response = await request(app).get('/api/portal/absences');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
  });

  describe('DELETE /api/portal/absences/:id', () => {
    test('should cancel pending absence', async () => {
      const { testStudent, testPortalUser } = await createTestData();
      app.request.testStudentId = testStudent._id;
      app.request.testPortalUserId = testPortalUser._id;

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const absence = await Absence.create({
        studentId: testStudent._id,
        portalUserId: testPortalUser._id,
        absenceDate: tomorrow,
        day: 'Montag',
        hour: 14,
        absenceType: 'illness',
        reason: 'Test',
        status: 'pending',
      });

      const response = await request(app).delete(
        `/api/portal/absences/${absence._id}`
      );

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('gelöscht');

      // Verify deletion
      const deletedAbsence = await Absence.findById(absence._id);
      expect(deletedAbsence).toBeNull();
    });

    test('should not cancel non-pending absence', async () => {
      const { testStudent, testPortalUser } = await createTestData();
      app.request.testStudentId = testStudent._id;
      app.request.testPortalUserId = testPortalUser._id;

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const absence = await Absence.create({
        studentId: testStudent._id,
        portalUserId: testPortalUser._id,
        absenceDate: tomorrow,
        day: 'Montag',
        hour: 14,
        absenceType: 'illness',
        reason: 'Test',
        status: 'acknowledged',
      });

      const response = await request(app).delete(
        `/api/portal/absences/${absence._id}`
      );

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Nur ausstehende');
    });

    test('should return 404 for non-existent absence', async () => {
      const { testStudent } = await createTestData();
      app.request.testStudentId = testStudent._id;

      const fakeId = new mongoose.Types.ObjectId();

      const response = await request(app).delete(
        `/api/portal/absences/${fakeId}`
      );

      expect(response.status).toBe(404);
    });

    test('should not cancel other student absence', async () => {
      const { testStudent, testPortalUser } = await createTestData();

      // Create another student
      const otherStudent = await Student.create(
        createTestStudent({ firstName: 'Other' })
      );

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Create absence for other student
      const absence = await Absence.create({
        studentId: otherStudent._id,
        portalUserId: testPortalUser._id,
        absenceDate: tomorrow,
        day: 'Montag',
        hour: 14,
        absenceType: 'illness',
        reason: 'Test',
        status: 'pending',
      });

      // Try to delete with different student ID in auth
      app.request.testStudentId = testStudent._id;

      const response = await request(app).delete(
        `/api/portal/absences/${absence._id}`
      );

      expect(response.status).toBe(404); // Not found for this student
    });
  });
});
