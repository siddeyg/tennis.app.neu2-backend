/**
 * Integration Tests for Coach Portal API
 *
 * Tests all coach portal endpoints:
 * - GET /api/coach/schedule/today - Today's schedule for coach
 * - GET /api/coach/students - Students assigned to coach
 * - GET /api/coach/stats - Coach attendance statistics
 *
 * Coverage: Authentication, role-based access, data filtering, business logic
 */

import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import {
  connectTestDB,
  clearTestDB,
  disconnectTestDB,
  createTestStudent
} from '../../testHelpers.js';
import User from '../../models/User.js';
import Student from '../../models/Student.js';
import Coach from '../../models/Coach.js';
import Attendance from '../../models/Attendance.js';
import coachPortalRoutes from '../../routes/coachPortal.js';

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
app.use('/api/coach', coachPortalRoutes);

describe('Coach Portal API', () => {
  let coachUser;
  let otherCoachUser;
  let adminUser;
  let students;

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

    // Get today's day name
    const dayNames = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
    const today = new Date();
    const dayName = dayNames[today.getDay()];

    // Create test students with assignments for today
    students = await Promise.all([
      Student.create({
        firstName: 'Student',
        lastName: 'One',
        birthDate: new Date('2010-01-01'),
        adult: false,
        trainigGroup: 'Gelb Team',
        availableTimes: [{ day: dayName, hour: 14, venue: '' }, { day: dayName, hour: 15, venue: '' }],
        frequence: '1',
        assignments: [{ day: dayName, hour: 14, coach: coachUser._id }]
      }),
      Student.create({
        firstName: 'Student',
        lastName: 'Two',
        birthDate: new Date('2011-01-01'),
        adult: false,
        trainigGroup: 'Gelb Team',
        availableTimes: [{ day: dayName, hour: 14, venue: '' }, { day: dayName, hour: 15, venue: '' }],
        frequence: '1',
        assignments: [{ day: dayName, hour: 14, coach: coachUser._id }]
      }),
      Student.create({
        firstName: 'Student',
        lastName: 'Three',
        birthDate: new Date('2012-01-01'),
        adult: false,
        trainigGroup: 'Orange',
        availableTimes: [{ day: dayName, hour: 15, venue: '' }, { day: dayName, hour: 16, venue: '' }],
        frequence: '1',
        assignments: [{ day: dayName, hour: 15, coach: coachUser._id }]
      }),
      Student.create({
        firstName: 'Other',
        lastName: 'Student',
        birthDate: new Date('2013-01-01'),
        adult: false,
        trainigGroup: 'Rot',
        availableTimes: [{ day: dayName, hour: 16, venue: '' }, { day: dayName, hour: 17, venue: '' }],
        frequence: '1',
        assignments: [{ day: dayName, hour: 16, coach: otherCoachUser._id }]
      })
    ]);

    // Set mock authenticated user
    mockUser = coachUser;
  });

  describe('GET /api/coach/schedule/today', () => {
    it('should return today\'s schedule for authenticated coach', async () => {
      const response = await request(app)
        .get('/api/coach/schedule/today')
        .expect(200);

      expect(response.body).toHaveProperty('date');
      expect(response.body).toHaveProperty('dayName');
      expect(response.body).toHaveProperty('courses');
      expect(Array.isArray(response.body.courses)).toBe(true);
    });

    it('should only return courses assigned to this coach', async () => {
      const response = await request(app)
        .get('/api/coach/schedule/today')
        .expect(200);

      const allStudentsInCourses = response.body.courses.flatMap(course => course.students);

      // Should have 3 students (Student One, Two, Three)
      expect(allStudentsInCourses.length).toBe(3);

      // Should not include student assigned to other coach
      const otherStudent = allStudentsInCourses.find(s => s.firstName === 'Other');
      expect(otherStudent).toBeUndefined();
    });

    it('should group students by hour correctly', async () => {
      const response = await request(app)
        .get('/api/coach/schedule/today')
        .expect(200);

      const courses = response.body.courses;

      // Should have 2 courses (hour 14 and 15)
      expect(courses.length).toBe(2);

      // Find hour 14 course
      const hour14Course = courses.find(c => c.hour === 14);
      expect(hour14Course).toBeDefined();
      expect(hour14Course.students.length).toBe(2); // Student One and Two

      // Find hour 15 course
      const hour15Course = courses.find(c => c.hour === 15);
      expect(hour15Course).toBeDefined();
      expect(hour15Course.students.length).toBe(1); // Student Three
    });

    it('should include attendance status for each course', async () => {
      const dayNames = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
      const today = new Date();
      const dayName = dayNames[today.getDay()];

      // Create attendance record for hour 14
      await Attendance.create({
        courseDate: today,
        day: dayName,
        hour: 14,
        coach: coachUser._id,
        students: [
          { studentId: students[0]._id, status: 'present' },
          { studentId: students[1]._id, status: 'absent' }
        ],
        markedBy: coachUser._id
      });

      const response = await request(app)
        .get('/api/coach/schedule/today')
        .expect(200);

      const hour14Course = response.body.courses.find(c => c.hour === 14);
      expect(hour14Course.attendanceMarked).toBe(true);
      expect(hour14Course.attendanceId).toBeDefined();
    });

    it('should require authentication', async () => {
      mockUser = null; // Clear authentication

      await request(app)
        .get('/api/coach/schedule/today')
        .expect(401);

      // Restore for next tests
      mockUser = coachUser;
    });

    it('should require trainer role', async () => {
      mockUser = adminUser; // Use admin user (not trainer)

      await request(app)
        .get('/api/coach/schedule/today')
        .expect(403);

      // Restore for next tests
      mockUser = coachUser;
    });
  });

  describe('GET /api/coach/students', () => {
    it('should return all students assigned to coach', async () => {
      const response = await request(app)
        .get('/api/coach/students')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(3); // Student One, Two, Three
    });

    it('should not return students assigned to other coaches', async () => {
      const response = await request(app)
        .get('/api/coach/students')
        .expect(200);

      const otherStudent = response.body.find(s => s.firstName === 'Other');
      expect(otherStudent).toBeUndefined();
    });

    it('should include student details and assignments', async () => {
      const response = await request(app)
        .get('/api/coach/students')
        .expect(200);

      const student = response.body[0];
      expect(student).toHaveProperty('firstName');
      expect(student).toHaveProperty('lastName');
      expect(student).toHaveProperty('birthDate');
      expect(student).toHaveProperty('assignments');
      expect(Array.isArray(student.assignments)).toBe(true);
    });

    it('should populate coach information in assignments', async () => {
      const response = await request(app)
        .get('/api/coach/students')
        .expect(200);

      const student = response.body[0];
      const assignment = student.assignments[0];
      expect(assignment.coach).toHaveProperty('firstName');
      expect(assignment.coach).toHaveProperty('lastName');
      expect(assignment.coach.firstName).toBe('Test');
    });

    it('should require authentication', async () => {
      mockUser = null;

      await request(app)
        .get('/api/coach/students')
        .expect(401);

      mockUser = coachUser;
    });

    it('should require trainer role', async () => {
      mockUser = adminUser;

      await request(app)
        .get('/api/coach/students')
        .expect(403);

      mockUser = coachUser;
    });
  });

  describe('GET /api/coach/stats', () => {
    beforeEach(async () => {
      const dayNames = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
      const today = new Date();
      const dayName = dayNames[today.getDay()];

      // Create attendance records for statistics
      // This week's attendance
      await Attendance.create({
        courseDate: today,
        day: dayName,
        hour: 14,
        coach: coachUser._id,
        students: [
          { studentId: students[0]._id, status: 'present' },
          { studentId: students[1]._id, status: 'absent' }
        ],
        markedBy: coachUser._id
      });

      // Last week's attendance
      const lastWeek = new Date(today);
      lastWeek.setDate(today.getDate() - 7);
      const lastWeekDay = dayNames[lastWeek.getDay()];

      await Attendance.create({
        courseDate: lastWeek,
        day: lastWeekDay,
        hour: 15,
        coach: coachUser._id,
        students: [
          { studentId: students[2]._id, status: 'present' }
        ],
        markedBy: coachUser._id
      });
    });

    it('should return weekly statistics by default', async () => {
      const response = await request(app)
        .get('/api/coach/stats')
        .expect(200);

      expect(response.body).toHaveProperty('totalCourses');
      expect(response.body).toHaveProperty('totalStudents');
      expect(response.body).toHaveProperty('presentCount');
      expect(response.body).toHaveProperty('absentCount');
      expect(response.body).toHaveProperty('attendanceRate');
      expect(response.body).toHaveProperty('range');
    });

    it('should calculate statistics correctly for week range', async () => {
      const response = await request(app)
        .get('/api/coach/stats?range=week')
        .expect(200);

      expect(response.body.totalCourses).toBe(1); // Only this week
      expect(response.body.totalStudents).toBe(2); // Student One and Two
      expect(response.body.presentCount).toBe(1);
      expect(response.body.absentCount).toBe(1);
      expect(response.body.attendanceRate).toBe(50); // 1 present / 2 total
    });

    it('should calculate statistics correctly for month range', async () => {
      const response = await request(app)
        .get('/api/coach/stats?range=month')
        .expect(200);

      expect(response.body.totalCourses).toBe(2); // Both weeks
      expect(response.body.totalStudents).toBe(3); // All three students
      expect(response.body.presentCount).toBe(2);
      expect(response.body.absentCount).toBe(1);
      expect(response.body.attendanceRate).toBeCloseTo(66.67, 1); // 2 present / 3 total
    });

    it('should only include statistics for this coach', async () => {
      // Create attendance for other coach
      const dayNames = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
      const today = new Date();
      const dayName = dayNames[today.getDay()];

      await Attendance.create({
        courseDate: today,
        day: dayName,
        hour: 16,
        coach: otherCoachUser._id,
        students: [
          { studentId: students[3]._id, status: 'present' }
        ],
        markedBy: otherCoachUser._id
      });

      const response = await request(app)
        .get('/api/coach/stats?range=week')
        .expect(200);

      // Should not include other coach's course
      expect(response.body.totalCourses).toBe(1);
    });

    it('should require authentication', async () => {
      mockUser = null;

      await request(app)
        .get('/api/coach/stats')
        .expect(401);

      mockUser = coachUser;
    });

    it('should require trainer role', async () => {
      mockUser = adminUser;

      await request(app)
        .get('/api/coach/stats')
        .expect(403);

      mockUser = coachUser;
    });
  });
});
