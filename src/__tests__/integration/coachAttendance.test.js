/**
 * Integration Tests for Coach Attendance API
 *
 * Tests all attendance endpoints:
 * - POST /api/attendance - Create attendance record
 * - PUT /api/attendance/:id - Update attendance record (with 2h window)
 * - GET /api/attendance - Fetch attendance records
 * - DELETE /api/attendance/:id - Delete attendance record (admin only)
 *
 * Coverage: CRUD operations, 2-hour edit window, role-based access, absence integration
 */

import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import {
  connectTestDB,
  clearTestDB,
  disconnectTestDB
} from '../../testHelpers.js';
import User from '../../models/User.js';
import Student from '../../models/Student.js';
import Attendance from '../../models/Attendance.js';
import Absence from '../../models/Absence.js';
import attendanceRoutes from '../../routes/attendance.js';

// Create Express app for testing
const app = express();
app.use(express.json());

// Mock authentication middleware
let mockUser = null;
const mockCoachAuth = () => {
  return (req, res, next) => {
    if (!mockUser) {
      return res.status(401).json({ error: 'Nicht authentifiziert' });
    }
    req.user = mockUser;
    next();
  };
};

app.use(mockCoachAuth());
app.use('/api/attendance', attendanceRoutes);

describe('Coach Attendance API', () => {
  let coachUser;
  let otherCoachUser;
  let adminUser;
  let students;
  let attendance;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    // Create test users
    coachUser = await User.create({
      email: 'coach@test.com',
      password: 'password123',
      firstName: 'Test',
      lastName: 'Coach',
      role: 'trainer',
      isActive: true
    });

    otherCoachUser = await User.create({
      email: 'other@test.com',
      password: 'password123',
      firstName: 'Other',
      lastName: 'Coach',
      role: 'trainer',
      isActive: true
    });

    adminUser = await User.create({
      email: 'admin@test.com',
      password: 'password123',
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin',
      isActive: true
    });

    // Create test students
    students = await Promise.all([
      Student.create({
        firstName: 'Student',
        lastName: 'One',
        birthDate: new Date('2010-01-01'),
        adult: false,
        trainigGroup: 'Gelb Team',
        availableTimes: ['Montag 14'],
        frequence: '1',
        assignments: [{ day: 'Montag', hour: 14, coach: coachUser._id }]
      }),
      Student.create({
        firstName: 'Student',
        lastName: 'Two',
        birthDate: new Date('2011-01-01'),
        adult: false,
        trainigGroup: 'Gelb Team',
        availableTimes: ['Montag 14'],
        frequence: '1',
        assignments: [{ day: 'Montag', hour: 14, coach: coachUser._id }]
      }),
      Student.create({
        firstName: 'Student',
        lastName: 'Three',
        birthDate: new Date('2012-01-01'),
        adult: false,
        trainigGroup: 'Orange',
        availableTimes: ['Montag 15'],
        frequence: '1',
        assignments: [{ day: 'Montag', hour: 15, coach: coachUser._id }]
      })
    ]);

    // Create test attendance record (within 2-hour window)
    const today = new Date();
    attendance = await Attendance.create({
      courseDate: today,
      day: 'Montag',
      hour: today.getHours() - 1, // 1 hour ago (within edit window)
      coach: coachUser._id,
      students: [
        { studentId: students[0]._id, status: 'present' },
        { studentId: students[1]._id, status: 'absent' }
      ],
      markedBy: coachUser._id
    });

    // Set mock authenticated user
    mockUser = coachUser;
  });

  describe('POST /api/attendance', () => {
    it('should create new attendance record', async () => {
      const courseDate = new Date();
      const attendanceData = {
        courseDate: courseDate.toISOString(),
        day: 'Montag',
        hour: 14,
        students: [
          { studentId: students[0]._id.toString(), status: 'present' },
          { studentId: students[1]._id.toString(), status: 'absent' }
        ]
      };

      const response = await request(app)
        .post('/api/attendance')
        .send(attendanceData)
        .expect(201);

      expect(response.body).toHaveProperty('_id');
      expect(response.body.day).toBe('Montag');
      expect(response.body.hour).toBe(14);
      expect(response.body.students.length).toBe(2);
      expect(response.body.coach).toBe(coachUser._id.toString());
    });

    it('should auto-mark students with absences as absent_notified', async () => {
      const courseDate = new Date();

      // Create absence notification for student
      await Absence.create({
        studentId: students[0]._id,
        portalUserId: new mongoose.Types.ObjectId(), // Mock portal user
        absenceDate: courseDate,
        day: 'Montag',
        hour: 14,
        absenceType: 'illness',
        reason: 'Krank'
      });

      const attendanceData = {
        courseDate: courseDate.toISOString(),
        day: 'Montag',
        hour: 14,
        students: [
          { studentId: students[0]._id.toString(), status: 'absent' },
          { studentId: students[1]._id.toString(), status: 'present' }
        ]
      };

      const response = await request(app)
        .post('/api/attendance')
        .send(attendanceData)
        .expect(201);

      const student1 = response.body.students.find(s => s.studentId === students[0]._id.toString());
      expect(student1.status).toBe('absent_notified'); // Auto-changed from absent
    });

    it('should not override present status even with absence notification', async () => {
      const courseDate = new Date();

      // Create absence notification
      await Absence.create({
        studentId: students[0]._id,
        portalUserId: new mongoose.Types.ObjectId(), // Mock portal user
        absenceDate: courseDate,
        day: 'Montag',
        hour: 14,
        absenceType: 'illness',
        reason: 'Krank'
      });

      const attendanceData = {
        courseDate: courseDate.toISOString(),
        day: 'Montag',
        hour: 14,
        students: [
          { studentId: students[0]._id.toString(), status: 'present' }, // Mark as present despite absence
          { studentId: students[1]._id.toString(), status: 'absent' }
        ]
      };

      const response = await request(app)
        .post('/api/attendance')
        .send(attendanceData)
        .expect(201);

      const student1 = response.body.students.find(s => s.studentId === students[0]._id.toString());
      expect(student1.status).toBe('present'); // Not changed to absent_notified
    });

    it('should require authentication', async () => {
      mockUser = null;

      const attendanceData = {
        courseDate: new Date().toISOString(),
        day: 'Montag',
        hour: 14,
        students: [{ studentId: students[0]._id.toString(), status: 'present' }]
      };

      await request(app)
        .post('/api/attendance')
        .send(attendanceData)
        .expect(401);
    });

    it('should require trainer role', async () => {
      mockUser = adminUser;

      const attendanceData = {
        courseDate: new Date().toISOString(),
        day: 'Montag',
        hour: 14,
        students: [{ studentId: students[0]._id.toString(), status: 'present' }]
      };

      await request(app)
        .post('/api/attendance')
        .send(attendanceData)
        .expect(403);
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/attendance')
        .send({}) // Missing all required fields
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('PUT /api/attendance/:id - 2-Hour Edit Window', () => {
    it('should allow coach to edit within 2-hour window', async () => {
      const updatedData = {
        students: [
          { studentId: students[0]._id.toString(), status: 'absent' }, // Change from present
          { studentId: students[1]._id.toString(), status: 'present' } // Change from absent
        ]
      };

      const response = await request(app)
        .put(`/api/attendance/${attendance._id}`)
        .send(updatedData)
        .expect(200);

      expect(response.body.students[0].status).toBe('absent');
      expect(response.body.students[1].status).toBe('present');
    });

    it('should reject coach edit after 2-hour window', async () => {
      // Create old attendance (>2 hours ago)
      const oldDate = new Date();
      oldDate.setHours(oldDate.getHours() - 10); // 10 hours ago

      const oldAttendance = await Attendance.create({
        courseDate: oldDate,
        day: 'Montag',
        hour: 14, // Fixed valid hour (10-21)
        coach: coachUser._id,
        students: [
          { studentId: students[0]._id, status: 'present' }
        ],
        markedBy: coachUser._id
      });

      const updatedData = {
        students: [
          { studentId: students[0]._id.toString(), status: 'absent' }
        ]
      };

      const response = await request(app)
        .put(`/api/attendance/${oldAttendance._id}`)
        .send(updatedData)
        .expect(403);

      expect(response.body.error).toBe('Bearbeitungszeit abgelaufen');
      expect(response.body.message).toContain('2 Stunden');
    });

    it('should allow admin to edit after 2-hour window', async () => {
      mockUser = adminUser;

      // Create old attendance
      const oldDate = new Date();
      oldDate.setHours(oldDate.getHours() - 10);

      const oldAttendance = await Attendance.create({
        courseDate: oldDate,
        day: 'Montag',
        hour: 14, // Fixed valid hour (10-21)
        coach: coachUser._id,
        students: [
          { studentId: students[0]._id, status: 'present' }
        ],
        markedBy: coachUser._id
      });

      const updatedData = {
        students: [
          { studentId: students[0]._id.toString(), status: 'absent' }
        ]
      };

      const response = await request(app)
        .put(`/api/attendance/${oldAttendance._id}`)
        .send(updatedData)
        .expect(200);

      expect(response.body.students[0].status).toBe('absent');
      expect(response.body.editedBy.toString()).toBe(adminUser._id.toString());
    });

    it('should track editedBy and editedAt fields', async () => {
      const updatedData = {
        students: [
          { studentId: students[0]._id.toString(), status: 'absent' }
        ]
      };

      const response = await request(app)
        .put(`/api/attendance/${attendance._id}`)
        .send(updatedData)
        .expect(200);

      expect(response.body).toHaveProperty('editedBy');
      expect(response.body).toHaveProperty('editedAt');
      expect(response.body.editedBy.toString()).toBe(coachUser._id.toString());
    });

    it('should require authentication', async () => {
      mockUser = null;

      const updatedData = {
        students: [{ studentId: students[0]._id.toString(), status: 'absent' }]
      };

      await request(app)
        .put(`/api/attendance/${attendance._id}`)
        .send(updatedData)
        .expect(401);
    });

    it('should return 404 for non-existent attendance', async () => {
      const fakeId = '507f1f77bcf86cd799439011';

      const updatedData = {
        students: [{ studentId: students[0]._id.toString(), status: 'absent' }]
      };

      await request(app)
        .put(`/api/attendance/${fakeId}`)
        .send(updatedData)
        .expect(404);
    });
  });

  describe('GET /api/attendance', () => {
    beforeEach(async () => {
      // Create additional attendance records
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      await Attendance.create({
        courseDate: yesterday,
        day: 'Sonntag',
        hour: 15,
        coach: coachUser._id,
        students: [
          { studentId: students[2]._id, status: 'present' }
        ],
        markedBy: coachUser._id
      });

      await Attendance.create({
        courseDate: new Date(),
        day: 'Montag',
        hour: 16,
        coach: otherCoachUser._id,
        students: [
          { studentId: students[0]._id, status: 'present' }
        ],
        markedBy: otherCoachUser._id
      });
    });

    it('should return all attendance records for coach', async () => {
      const response = await request(app)
        .get('/api/attendance')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(2); // Only this coach's records
    });

    it('should not return attendance records from other coaches', async () => {
      const response = await request(app)
        .get('/api/attendance')
        .expect(200);

      const otherCoachRecord = response.body.find(
        a => a.coach._id === otherCoachUser._id.toString()
      );
      expect(otherCoachRecord).toBeUndefined();
    });

    it('should filter by date range', async () => {
      const today = new Date();
      const startDate = new Date(today);
      startDate.setHours(0, 0, 0, 0);

      const response = await request(app)
        .get(`/api/attendance?startDate=${startDate.toISOString()}`)
        .expect(200);

      expect(response.body.length).toBe(1); // Only today's record
    });

    it('should populate student and coach information', async () => {
      const response = await request(app)
        .get('/api/attendance')
        .expect(200);

      const record = response.body[0];
      expect(record.coach).toHaveProperty('firstName');
      expect(record.coach).toHaveProperty('lastName');
      expect(record.students[0]).toHaveProperty('studentId');
    });

    it('should allow admin to see all coaches attendance', async () => {
      mockUser = adminUser;

      const response = await request(app)
        .get('/api/attendance')
        .expect(200);

      expect(response.body.length).toBe(3); // All records
    });

    it('should require authentication', async () => {
      mockUser = null;

      await request(app)
        .get('/api/attendance')
        .expect(401);
    });
  });

  describe('DELETE /api/attendance/:id', () => {
    it('should allow admin to delete attendance record', async () => {
      mockUser = adminUser;

      await request(app)
        .delete(`/api/attendance/${attendance._id}`)
        .expect(200);

      // Verify deletion
      const deleted = await Attendance.findById(attendance._id);
      expect(deleted).toBeNull();
    });

    it('should reject non-admin deletion', async () => {
      await request(app)
        .delete(`/api/attendance/${attendance._id}`)
        .expect(403);

      // Verify not deleted
      const stillExists = await Attendance.findById(attendance._id);
      expect(stillExists).not.toBeNull();
    });

    it('should return 404 for non-existent attendance', async () => {
      mockUser = adminUser;
      const fakeId = '507f1f77bcf86cd799439011';

      await request(app)
        .delete(`/api/attendance/${fakeId}`)
        .expect(404);
    });

    it('should require authentication', async () => {
      mockUser = null;

      await request(app)
        .delete(`/api/attendance/${attendance._id}`)
        .expect(401);
    });
  });

  describe('Business Logic - canEditByCoach()', () => {
    it('should allow edit within 2 hours of course end', () => {
      const now = new Date();
      const courseDateTime = new Date(now);
      courseDateTime.setHours(now.getHours() - 2, 0, 0, 0); // 2 hours ago, reset minutes/seconds/ms

      const testAttendance = new Attendance({
        courseDate: courseDateTime,
        day: 'Montag',
        hour: courseDateTime.getHours(),
        coach: coachUser._id,
        students: [],
        markedBy: coachUser._id
      });

      // Test at exactly the deadline (course start + 3 hours)
      const deadline = new Date(courseDateTime);
      deadline.setHours(deadline.getHours() + 3, 0, 0, 0); // Course end + 2 hours, reset minutes/seconds/ms

      expect(testAttendance.canEditByCoach(deadline)).toBe(true);
    });

    it('should reject edit after 2 hours of course end', () => {
      const now = new Date();
      const courseDateTime = new Date(now);
      courseDateTime.setHours(now.getHours() - 10, 0, 0, 0); // 10 hours ago, reset minutes/seconds/ms

      const testAttendance = new Attendance({
        courseDate: courseDateTime,
        day: 'Montag',
        hour: courseDateTime.getHours(),
        coach: coachUser._id,
        students: [],
        markedBy: coachUser._id
      });

      expect(testAttendance.canEditByCoach(now)).toBe(false);
    });
  });
});
