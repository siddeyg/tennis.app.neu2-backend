import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import Student from '../../models/Student.js';
import StudentPortalUser from '../../models/StudentPortalUser.js';
import ScheduleChangeRequest from '../../models/ScheduleChangeRequest.js';
import User from '../../models/User.js';
import portalScheduleRoutes from '../../routes/portalSchedule.js';
import scheduleChangeRequestsRoutes from '../../routes/scheduleChangeRequests.js';
import {
  connectTestDB,
  disconnectTestDB,
  clearTestDB,
  createTestStudent,
  mockAuth,
} from '../../testHelpers.js';

// Create Express app for testing portal routes
const portalApp = express();
portalApp.use(express.json());
portalApp.use(cookieParser());

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

portalApp.use(mockPortalAuth());
portalApp.use('/api/portal', portalScheduleRoutes);

// Create Express app for testing admin routes
const adminApp = express();
adminApp.use(express.json());
adminApp.use(mockAuth()); // Mock admin authentication
adminApp.use('/api/schedule-change-requests', scheduleChangeRequestsRoutes);

describe('Schedule Change Requests API Integration Tests', () => {
  let testStudent;
  let testPortalUser;
  let testAdmin;

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

  // Helper to create test student, portal user, and admin
  const createTestData = async () => {
    testStudent = await Student.create(
      createTestStudent({
        firstName: 'Max',
        lastName: 'Mustermann',
        assignments: [
          { day: 'Montag', hour: 14, coach: null },
          { day: 'Mittwoch', hour: 16, coach: null },
        ],
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

    testAdmin = await User.create({
      email: 'admin@test.com',
      password: 'adminpassword',
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin',
    });

    return { testStudent, testPortalUser, testAdmin };
  };

  describe('Portal Routes - Student Actions', () => {
    describe('POST /api/portal/schedule-change-requests', () => {
      test('should create new schedule change request (add)', async () => {
        const { testStudent, testPortalUser } = await createTestData();
        portalApp.request.testStudentId = testStudent._id;
        portalApp.request.testPortalUserId = testPortalUser._id;

        const requestData = {
          requestType: 'add',
          requestedSlot: { day: 'Freitag', hour: 18 },
          reason: 'M�chte gerne einen zus�tzlichen Trainingstermin',
        };

        const response = await request(portalApp)
          .post('/api/portal/schedule-change-requests')
          .send(requestData);

        expect(response.status).toBe(201);
        expect(response.body.requestType).toBe('add');
        expect(response.body.status).toBe('pending');
        expect(response.body.reason).toBe(
          'M�chte gerne einen zus�tzlichen Trainingstermin'
        );
        expect(response.body.requestedSlot.day).toBe('Freitag');
        expect(response.body.requestedSlot.hour).toBe(18);
      });

      test('should create new schedule change request (remove)', async () => {
        const { testStudent, testPortalUser } = await createTestData();
        portalApp.request.testStudentId = testStudent._id;
        portalApp.request.testPortalUserId = testPortalUser._id;

        const requestData = {
          requestType: 'remove',
          currentSlot: { day: 'Montag', hour: 14 },
          reason: 'Kann montags nicht mehr kommen',
        };

        const response = await request(portalApp)
          .post('/api/portal/schedule-change-requests')
          .send(requestData);

        expect(response.status).toBe(201);
        expect(response.body.requestType).toBe('remove');
        expect(response.body.currentSlot.day).toBe('Montag');
        expect(response.body.currentSlot.hour).toBe(14);
      });

      test('should create new schedule change request (change)', async () => {
        const { testStudent, testPortalUser } = await createTestData();
        portalApp.request.testStudentId = testStudent._id;
        portalApp.request.testPortalUserId = testPortalUser._id;

        const requestData = {
          requestType: 'change',
          currentSlot: { day: 'Montag', hour: 14 },
          requestedSlot: { day: 'Dienstag', hour: 15 },
          reason: 'Dienstag passt mir besser',
        };

        const response = await request(portalApp)
          .post('/api/portal/schedule-change-requests')
          .send(requestData);

        expect(response.status).toBe(201);
        expect(response.body.requestType).toBe('change');
        expect(response.body.currentSlot.day).toBe('Montag');
        expect(response.body.requestedSlot.day).toBe('Dienstag');
      });

      test('should reject if student already has pending request', async () => {
        const { testStudent, testPortalUser } = await createTestData();
        portalApp.request.testStudentId = testStudent._id;
        portalApp.request.testPortalUserId = testPortalUser._id;

        // Create first request
        await ScheduleChangeRequest.create({
          studentId: testStudent._id,
          portalUserId: testPortalUser._id,
          requestType: 'add',
          requestedSlot: { day: 'Freitag', hour: 18 },
          reason: 'First request',
          status: 'pending',
        });

        // Try to create second request
        const requestData = {
          requestType: 'add',
          requestedSlot: { day: 'Samstag', hour: 10 },
          reason: 'Second request',
        };

        const response = await request(portalApp)
          .post('/api/portal/schedule-change-requests')
          .send(requestData);

        expect(response.status).toBe(400);
        expect(response.body.error).toContain(
          'bereits eine offene Anfrage'
        );
      });

      test('should validate required fields', async () => {
        const { testStudent, testPortalUser } = await createTestData();
        portalApp.request.testStudentId = testStudent._id;
        portalApp.request.testPortalUserId = testPortalUser._id;

        const invalidData = {
          requestType: 'add',
          // Missing requestedSlot and reason
        };

        const response = await request(portalApp)
          .post('/api/portal/schedule-change-requests')
          .send(invalidData);

        expect(response.status).toBe(400);
      });

      test('should enforce reason max length (500 chars)', async () => {
        const { testStudent, testPortalUser } = await createTestData();
        portalApp.request.testStudentId = testStudent._id;
        portalApp.request.testPortalUserId = testPortalUser._id;

        const longReason = 'a'.repeat(501);

        const requestData = {
          requestType: 'add',
          requestedSlot: { day: 'Freitag', hour: 18 },
          reason: longReason,
        };

        const response = await request(portalApp)
          .post('/api/portal/schedule-change-requests')
          .send(requestData);

        expect(response.status).toBe(400);
      });
    });

    describe('GET /api/portal/schedule-change-requests', () => {
      test('should return all requests for student', async () => {
        const { testStudent, testPortalUser } = await createTestData();
        portalApp.request.testStudentId = testStudent._id;
        portalApp.request.testPortalUserId = testPortalUser._id;

        // Create multiple requests
        await ScheduleChangeRequest.create([
          {
            studentId: testStudent._id,
            portalUserId: testPortalUser._id,
            requestType: 'add',
            requestedSlot: { day: 'Freitag', hour: 18 },
            reason: 'Request 1',
            status: 'pending',
          },
          {
            studentId: testStudent._id,
            portalUserId: testPortalUser._id,
            requestType: 'remove',
            currentSlot: { day: 'Montag', hour: 14 },
            reason: 'Request 2',
            status: 'approved',
          },
        ]);

        const response = await request(portalApp).get(
          '/api/portal/schedule-change-requests'
        );

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(2);
      });

      test('should return empty array if no requests', async () => {
        const { testStudent } = await createTestData();
        portalApp.request.testStudentId = testStudent._id;

        const response = await request(portalApp).get(
          '/api/portal/schedule-change-requests'
        );

        expect(response.status).toBe(200);
        expect(response.body).toEqual([]);
      });
    });

    describe('DELETE /api/portal/schedule-change-requests/:id', () => {
      test('should cancel pending request', async () => {
        const { testStudent, testPortalUser } = await createTestData();
        portalApp.request.testStudentId = testStudent._id;
        portalApp.request.testPortalUserId = testPortalUser._id;

        const changeRequest = await ScheduleChangeRequest.create({
          studentId: testStudent._id,
          portalUserId: testPortalUser._id,
          requestType: 'add',
          requestedSlot: { day: 'Freitag', hour: 18 },
          reason: 'Test request',
          status: 'pending',
        });

        const response = await request(portalApp).delete(
          `/api/portal/schedule-change-requests/${changeRequest._id}`
        );

        expect(response.status).toBe(200);
        expect(response.body.message).toContain('erfolgreich storniert');

        // Verify deletion
        const deletedRequest = await ScheduleChangeRequest.findById(
          changeRequest._id
        );
        expect(deletedRequest).toBeNull();
      });

      test('should not cancel non-pending request', async () => {
        const { testStudent, testPortalUser } = await createTestData();
        portalApp.request.testStudentId = testStudent._id;
        portalApp.request.testPortalUserId = testPortalUser._id;

        const changeRequest = await ScheduleChangeRequest.create({
          studentId: testStudent._id,
          portalUserId: testPortalUser._id,
          requestType: 'add',
          requestedSlot: { day: 'Freitag', hour: 18 },
          reason: 'Test request',
          status: 'approved',
        });

        const response = await request(portalApp).delete(
          `/api/portal/schedule-change-requests/${changeRequest._id}`
        );

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Nur offene');
      });
    });
  });

  describe('Admin Routes - Schedule Change Management', () => {
    describe('GET /api/schedule-change-requests', () => {
      test('should return all requests for admin', async () => {
        const { testStudent, testPortalUser } = await createTestData();

        // Create requests
        await ScheduleChangeRequest.create([
          {
            studentId: testStudent._id,
            portalUserId: testPortalUser._id,
            requestType: 'add',
            requestedSlot: { day: 'Freitag', hour: 18 },
            reason: 'Request 1',
            status: 'pending',
          },
          {
            studentId: testStudent._id,
            portalUserId: testPortalUser._id,
            requestType: 'remove',
            currentSlot: { day: 'Montag', hour: 14 },
            reason: 'Request 2',
            status: 'approved',
          },
        ]);

        const response = await request(adminApp).get(
          '/api/schedule-change-requests'
        );

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(2);
      });

      test('should filter by status=pending', async () => {
        const { testStudent, testPortalUser } = await createTestData();

        await ScheduleChangeRequest.create([
          {
            studentId: testStudent._id,
            portalUserId: testPortalUser._id,
            requestType: 'add',
            requestedSlot: { day: 'Freitag', hour: 18 },
            reason: 'Pending',
            status: 'pending',
          },
          {
            studentId: testStudent._id,
            portalUserId: testPortalUser._id,
            requestType: 'remove',
            currentSlot: { day: 'Montag', hour: 14 },
            reason: 'Approved',
            status: 'approved',
          },
        ]);

        const response = await request(adminApp).get(
          '/api/schedule-change-requests?status=pending'
        );

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(1);
        expect(response.body[0].status).toBe('pending');
      });
    });

    describe('POST /api/schedule-change-requests/:id/approve', () => {
      test('should approve request and update student schedule (add)', async () => {
        const { testStudent, testPortalUser, testAdmin } = await createTestData();

        const changeRequest = await ScheduleChangeRequest.create({
          studentId: testStudent._id,
          portalUserId: testPortalUser._id,
          requestType: 'add',
          requestedSlot: { day: 'Freitag', hour: 18 },
          reason: 'Want to add Friday',
          status: 'pending',
        });

        adminApp.request.user = { _id: testAdmin._id };

        const response = await request(adminApp)
          .post(`/api/schedule-change-requests/${changeRequest._id}/approve`)
          .send({ adminResponse: 'Genehmigt' });

        expect(response.status).toBe(200);
        expect(response.body.message).toContain('genehmigt');

        // Verify request status updated
        const updatedRequest = await ScheduleChangeRequest.findById(
          changeRequest._id
        );
        expect(updatedRequest.status).toBe('approved');
        expect(updatedRequest.adminResponse).toBe('Genehmigt');

        // Verify student schedule updated
        const updatedStudent = await Student.findById(testStudent._id);
        expect(updatedStudent.assignments).toHaveLength(3); // Was 2, now 3
        expect(updatedStudent.assignments[2].day).toBe('Freitag');
        expect(updatedStudent.assignments[2].hour).toBe(18);
      });

      test('should approve request and update student schedule (remove)', async () => {
        const { testStudent, testPortalUser, testAdmin } = await createTestData();

        const changeRequest = await ScheduleChangeRequest.create({
          studentId: testStudent._id,
          portalUserId: testPortalUser._id,
          requestType: 'remove',
          currentSlot: { day: 'Montag', hour: 14 },
          reason: 'Cannot come on Monday',
          status: 'pending',
        });

        adminApp.request.user = { _id: testAdmin._id };

        const response = await request(adminApp)
          .post(`/api/schedule-change-requests/${changeRequest._id}/approve`)
          .send({ adminResponse: 'OK' });

        expect(response.status).toBe(200);

        // Verify student schedule updated
        const updatedStudent = await Student.findById(testStudent._id);
        expect(updatedStudent.assignments).toHaveLength(1); // Was 2, now 1
        expect(updatedStudent.assignments[0].day).toBe('Mittwoch'); // Only Mittwoch left
      });

      test('should approve request and update student schedule (change)', async () => {
        const { testStudent, testPortalUser, testAdmin } = await createTestData();

        const changeRequest = await ScheduleChangeRequest.create({
          studentId: testStudent._id,
          portalUserId: testPortalUser._id,
          requestType: 'change',
          currentSlot: { day: 'Montag', hour: 14 },
          requestedSlot: { day: 'Dienstag', hour: 15 },
          reason: 'Tuesday is better',
          status: 'pending',
        });

        adminApp.request.user = { _id: testAdmin._id };

        const response = await request(adminApp)
          .post(`/api/schedule-change-requests/${changeRequest._id}/approve`)
          .send({ adminResponse: 'Approved' });

        expect(response.status).toBe(200);

        // Verify student schedule updated
        const updatedStudent = await Student.findById(testStudent._id);
        expect(updatedStudent.assignments).toHaveLength(2); // Still 2
        const mondayAssignment = updatedStudent.assignments.find(
          (a) => a.day === 'Montag'
        );
        const tuesdayAssignment = updatedStudent.assignments.find(
          (a) => a.day === 'Dienstag'
        );
        expect(mondayAssignment).toBeUndefined(); // Montag removed
        expect(tuesdayAssignment).toBeDefined(); // Dienstag added
        expect(tuesdayAssignment.hour).toBe(15);
      });

      test('should reject if request not pending', async () => {
        const { testStudent, testPortalUser, testAdmin } = await createTestData();

        const changeRequest = await ScheduleChangeRequest.create({
          studentId: testStudent._id,
          portalUserId: testPortalUser._id,
          requestType: 'add',
          requestedSlot: { day: 'Freitag', hour: 18 },
          reason: 'Test',
          status: 'approved', // Already approved
        });

        adminApp.request.user = { _id: testAdmin._id };

        const response = await request(adminApp)
          .post(`/api/schedule-change-requests/${changeRequest._id}/approve`)
          .send({ adminResponse: 'Test' });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('bereits bearbeitet');
      });
    });

    describe('POST /api/schedule-change-requests/:id/reject', () => {
      test('should reject request with reason', async () => {
        const { testStudent, testPortalUser, testAdmin } = await createTestData();

        const changeRequest = await ScheduleChangeRequest.create({
          studentId: testStudent._id,
          portalUserId: testPortalUser._id,
          requestType: 'add',
          requestedSlot: { day: 'Freitag', hour: 18 },
          reason: 'Test request',
          status: 'pending',
        });

        adminApp.request.user = { _id: testAdmin._id };

        const response = await request(adminApp)
          .post(`/api/schedule-change-requests/${changeRequest._id}/reject`)
          .send({ adminResponse: 'Kein Platz verf�gbar' });

        expect(response.status).toBe(200);
        expect(response.body.message).toContain('abgelehnt');

        // Verify request status updated
        const updatedRequest = await ScheduleChangeRequest.findById(
          changeRequest._id
        );
        expect(updatedRequest.status).toBe('rejected');
        expect(updatedRequest.adminResponse).toBe('Kein Platz verf�gbar');

        // Verify student schedule NOT changed
        const student = await Student.findById(testStudent._id);
        expect(student.assignments).toHaveLength(2); // Still 2
      });

      test('should require adminResponse', async () => {
        const { testStudent, testPortalUser } = await createTestData();

        const changeRequest = await ScheduleChangeRequest.create({
          studentId: testStudent._id,
          portalUserId: testPortalUser._id,
          requestType: 'add',
          requestedSlot: { day: 'Freitag', hour: 18 },
          reason: 'Test',
          status: 'pending',
        });

        const response = await request(adminApp)
          .post(`/api/schedule-change-requests/${changeRequest._id}/reject`)
          .send({}); // No adminResponse

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Begründung für Ablehnung');
      });
    });

    describe('DELETE /api/schedule-change-requests/:id', () => {
      test('should delete processed request', async () => {
        const { testStudent, testPortalUser } = await createTestData();

        const changeRequest = await ScheduleChangeRequest.create({
          studentId: testStudent._id,
          portalUserId: testPortalUser._id,
          requestType: 'add',
          requestedSlot: { day: 'Freitag', hour: 18 },
          reason: 'Test',
          status: 'approved',
        });

        const response = await request(adminApp).delete(
          `/api/schedule-change-requests/${changeRequest._id}`
        );

        expect(response.status).toBe(200);

        // Verify deletion
        const deletedRequest = await ScheduleChangeRequest.findById(
          changeRequest._id
        );
        expect(deletedRequest).toBeNull();
      });

      test('should not delete pending request', async () => {
        const { testStudent, testPortalUser } = await createTestData();

        const changeRequest = await ScheduleChangeRequest.create({
          studentId: testStudent._id,
          portalUserId: testPortalUser._id,
          requestType: 'add',
          requestedSlot: { day: 'Freitag', hour: 18 },
          reason: 'Test',
          status: 'pending',
        });

        const response = await request(adminApp).delete(
          `/api/schedule-change-requests/${changeRequest._id}`
        );

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Offene Anfragen');
      });
    });
  });
});
