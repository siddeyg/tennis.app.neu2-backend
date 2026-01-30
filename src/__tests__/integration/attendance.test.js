import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import Student from '../../models/Student.js';
import StudentPortalUser from '../../models/StudentPortalUser.js';
import Attendance from '../../models/Attendance.js';
import Coach from '../../models/Coach.js';
import User from '../../models/User.js';
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

describe('Attendance API Integration Tests', () => {
  let testStudent;
  let testPortalUser;
  let testCoach;
  let testMarker;

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

    testCoach = await Coach.create({
      firstName: 'Nicole',
      lastName: 'Kreienborg',
      email: 'nicole@test.com',
      availableTimes: ['Montag 14'],
      isCoachingChildren: true,
    });

    testMarker = await User.create({
      email: 'admin@test.com',
      password: 'password',
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin',
    });

    return { testStudent, testPortalUser, testCoach, testMarker };
  };

  describe('GET /api/portal/attendance/history', () => {
    test('should return attendance history for student', async () => {
      const { testStudent, testPortalUser, testCoach, testMarker } =
        await createTestData();
      app.request.testStudentId = testStudent._id;
      app.request.testPortalUserId = testPortalUser._id;

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const lastWeek = new Date();
      lastWeek.setDate(lastWeek.getDate() - 7);

      // Create attendance records
      await Attendance.create([
        {
          courseDate: yesterday,
          day: 'Montag',
          hour: 14,
          coach: testCoach._id,
          students: [
            {
              studentId: testStudent._id,
              status: 'present',
              notes: 'Good session',
            },
          ],
          markedBy: testMarker._id,
          markedAt: yesterday,
          sessionNotes: 'Great weather',
        },
        {
          courseDate: lastWeek,
          day: 'Montag',
          hour: 14,
          coach: testCoach._id,
          students: [
            {
              studentId: testStudent._id,
              status: 'absent',
              notes: 'Was sick',
            },
          ],
          markedBy: testMarker._id,
          markedAt: lastWeek,
        },
      ]);

      const response = await request(app).get(
        '/api/portal/attendance/history'
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].status).toBe('present'); // Sorted by date desc
      expect(response.body[0].coach).toHaveProperty('firstName', 'Nicole');
      expect(response.body[0].notes).toBe('Good session');
      expect(response.body[0].sessionNotes).toBe('Great weather');
      expect(response.body[1].status).toBe('absent');
    });

    test('should return empty array if no attendance records', async () => {
      const { testStudent } = await createTestData();
      app.request.testStudentId = testStudent._id;

      const response = await request(app).get(
        '/api/portal/attendance/history'
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    test('should not return attendance for other students', async () => {
      const { testStudent, testPortalUser, testCoach, testMarker } =
        await createTestData();
      app.request.testStudentId = testStudent._id;

      // Create another student
      const otherStudent = await Student.create(
        createTestStudent({ firstName: 'Other' })
      );

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      // Create attendance for other student only
      await Attendance.create({
        courseDate: yesterday,
        day: 'Montag',
        hour: 14,
        coach: testCoach._id,
        students: [
          {
            studentId: otherStudent._id,
            status: 'present',
          },
        ],
        markedBy: testMarker._id,
      });

      const response = await request(app).get(
        '/api/portal/attendance/history'
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(0);
    });

    test('should limit to 50 most recent records', async () => {
      const { testStudent, testPortalUser, testCoach, testMarker } =
        await createTestData();
      app.request.testStudentId = testStudent._id;

      // Create 60 attendance records
      const records = [];
      for (let i = 0; i < 60; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        records.push({
          courseDate: date,
          day: 'Montag',
          hour: 14,
          coach: testCoach._id,
          students: [{ studentId: testStudent._id, status: 'present' }],
          markedBy: testMarker._id,
        });
      }
      await Attendance.create(records);

      const response = await request(app).get(
        '/api/portal/attendance/history'
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(50); // Limited to 50
    });

    test('should populate coach and markedBy fields', async () => {
      const { testStudent, testPortalUser, testCoach, testMarker } =
        await createTestData();
      app.request.testStudentId = testStudent._id;

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      await Attendance.create({
        courseDate: yesterday,
        day: 'Montag',
        hour: 14,
        coach: testCoach._id,
        students: [{ studentId: testStudent._id, status: 'present' }],
        markedBy: testMarker._id,
      });

      const response = await request(app).get(
        '/api/portal/attendance/history'
      );

      expect(response.status).toBe(200);
      expect(response.body[0].coach).toHaveProperty('firstName', 'Nicole');
      expect(response.body[0].coach).toHaveProperty('lastName', 'Kreienborg');
      expect(response.body[0].markedBy).toHaveProperty('firstName', 'Admin');
      expect(response.body[0].markedBy).toHaveProperty('lastName', 'User');
    });
  });

  describe('GET /api/portal/attendance/statistics', () => {
    test('should return attendance statistics for student', async () => {
      const { testStudent, testPortalUser, testCoach, testMarker } =
        await createTestData();
      app.request.testStudentId = testStudent._id;

      // Create attendance records: 7 present, 2 absent, 1 excused = 10 total
      const records = [];
      for (let i = 0; i < 10; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);

        let status;
        if (i < 7) status = 'present';
        else if (i < 9) status = 'absent';
        else status = 'excused';

        records.push({
          courseDate: date,
          day: 'Montag',
          hour: 14,
          coach: testCoach._id,
          students: [{ studentId: testStudent._id, status }],
          markedBy: testMarker._id,
        });
      }
      await Attendance.create(records);

      const response = await request(app).get(
        '/api/portal/attendance/statistics'
      );

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(10);
      expect(response.body.present).toBe(7);
      expect(response.body.absent).toBe(2);
      expect(response.body.excused).toBe(1);
      expect(response.body.attendanceRate).toBe(70); // 7/10 = 70%
    });

    test('should return zeros if no attendance records', async () => {
      const { testStudent } = await createTestData();
      app.request.testStudentId = testStudent._id;

      const response = await request(app).get(
        '/api/portal/attendance/statistics'
      );

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(0);
      expect(response.body.present).toBe(0);
      expect(response.body.absent).toBe(0);
      expect(response.body.excused).toBe(0);
      expect(response.body.attendanceRate).toBe(0);
    });

    test('should calculate attendance rate correctly', async () => {
      const { testStudent, testPortalUser, testCoach, testMarker } =
        await createTestData();
      app.request.testStudentId = testStudent._id;

      // Create 8 present, 2 absent = 80% rate
      const records = [];
      for (let i = 0; i < 10; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        records.push({
          courseDate: date,
          day: 'Montag',
          hour: 14,
          coach: testCoach._id,
          students: [
            {
              studentId: testStudent._id,
              status: i < 8 ? 'present' : 'absent',
            },
          ],
          markedBy: testMarker._id,
        });
      }
      await Attendance.create(records);

      const response = await request(app).get(
        '/api/portal/attendance/statistics'
      );

      expect(response.status).toBe(200);
      expect(response.body.attendanceRate).toBe(80);
    });

    test('should not include other students in statistics', async () => {
      const { testStudent, testPortalUser, testCoach, testMarker } =
        await createTestData();
      app.request.testStudentId = testStudent._id;

      const otherStudent = await Student.create(
        createTestStudent({ firstName: 'Other' })
      );

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      // Create attendance with both students
      await Attendance.create({
        courseDate: yesterday,
        day: 'Montag',
        hour: 14,
        coach: testCoach._id,
        students: [
          { studentId: testStudent._id, status: 'present' },
          { studentId: otherStudent._id, status: 'present' },
        ],
        markedBy: testMarker._id,
      });

      const response = await request(app).get(
        '/api/portal/attendance/statistics'
      );

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1); // Only 1 session for testStudent
    });
  });

  describe('Attendance Model Static Methods', () => {
    test('getStudentHistory should extract only student status', async () => {
      const { testStudent, testPortalUser, testCoach, testMarker } =
        await createTestData();

      const otherStudent = await Student.create(
        createTestStudent({ firstName: 'Other' })
      );

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      // Create session with multiple students
      await Attendance.create({
        courseDate: yesterday,
        day: 'Montag',
        hour: 14,
        coach: testCoach._id,
        students: [
          { studentId: testStudent._id, status: 'present', notes: 'Max note' },
          { studentId: otherStudent._id, status: 'absent', notes: 'Other note' },
        ],
        markedBy: testMarker._id,
      });

      const history = await Attendance.getStudentHistory(testStudent._id);

      expect(history).toHaveLength(1);
      expect(history[0].status).toBe('present');
      expect(history[0].notes).toBe('Max note');
      expect(history[0]).not.toHaveProperty('students'); // Should not include all students
    });

    test('getStudentStatistics should calculate correctly', async () => {
      const { testStudent, testCoach, testMarker } = await createTestData();

      // Create 6 present, 3 absent, 1 excused
      const records = [];
      for (let i = 0; i < 10; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);

        let status;
        if (i < 6) status = 'present';
        else if (i < 9) status = 'absent';
        else status = 'excused';

        records.push({
          courseDate: date,
          day: 'Montag',
          hour: 14,
          coach: testCoach._id,
          students: [{ studentId: testStudent._id, status }],
          markedBy: testMarker._id,
        });
      }
      await Attendance.create(records);

      const stats = await Attendance.getStudentStatistics(testStudent._id);

      expect(stats.total).toBe(10);
      expect(stats.present).toBe(6);
      expect(stats.absent).toBe(3);
      expect(stats.excused).toBe(1);
      expect(stats.attendanceRate).toBe(60);
    });
  });
});
