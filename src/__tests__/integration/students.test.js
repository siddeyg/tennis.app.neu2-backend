import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Student from '../../models/Student.js';
// Import models that students.js route uses via mongoose.model() to ensure they are registered
import '../../models/SeasonalRegistration.js';
import '../../models/StudentPortalUser.js';
import studentRoutes from '../../routes/students.js';
import { connectTestDB, disconnectTestDB, clearTestDB, createTestStudent, mockAuth } from '../../testHelpers.js';

// Create Express app for testing
const app = express();
app.use(express.json());
app.use(mockAuth()); // Mock authentication
app.use('/api/students', studentRoutes);

describe('Student API Integration Tests', () => {
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

  describe('GET /api/students', () => {
    test('should return empty array when no students exist', async () => {
      const response = await request(app).get('/api/students');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    test('should return all students', async () => {
      // Create test students
      const student1 = await Student.create(createTestStudent({ firstName: 'Alice' }));
      const student2 = await Student.create(createTestStudent({ firstName: 'Bob' }));

      const response = await request(app).get('/api/students');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].firstName).toBe('Alice');
      expect(response.body[1].firstName).toBe('Bob');
    });
  });

  describe('POST /api/students', () => {
    test('should create a new student with valid data', async () => {
      const newStudent = createTestStudent({ firstName: 'Charlie' });

      const response = await request(app)
        .post('/api/students')
        .send(newStudent);

      expect(response.status).toBe(201);
      expect(response.body.firstName).toBe('Charlie');
      expect(response.body._id).toBeDefined();

      // Verify student was saved to DB
      const savedStudent = await Student.findById(response.body._id);
      expect(savedStudent).toBeDefined();
      expect(savedStudent.firstName).toBe('Charlie');
    });

    // Security regression test — mass assignment prevention
    // BEFORE the fix: new Student(req.body) would copy every field from the body,
    // including internal fields like `assignments` and `priorityTime` that are
    // supposed to be set only by dedicated routes/algorithms, not by the caller.
    // AFTER the fix: only whitelisted fields are copied; injected internals are ignored.
    test('POST /api/students — injected assignments and priorityTime are silently ignored', async () => {
      const maliciousBody = createTestStudent({
        firstName: 'Attacker',
        // Attempt to pre-load course assignments (bypasses capacity checks + assignment route)
        assignments: [{ day: 'Montag', hour: 14, coach: null }],
        // Attempt to set priority slot (bypasses seasonal registration processing)
        priorityTime: { day: 'Dienstag', hour: 15, venue: 'BTHV' },
      });

      const res = await request(app).post('/api/students').send(maliciousBody);

      expect(res.status).toBe(201);

      const saved = await Student.findById(res.body._id).lean();
      // assignments must be empty — injected slots were stripped
      expect(saved.assignments).toHaveLength(0);
      // priorityTime subdoc always exists (schema default), but the injected
      // day/hour values must not have been written
      expect(saved.priorityTime?.day).toBeUndefined();
      expect(saved.priorityTime?.hour).toBeUndefined();
    });

    test('should create student with availableTimes array', async () => {
      const newStudent = createTestStudent({
        availableTimes: [{ day: 'Montag', hour: 14, venue: '' }, { day: 'Mittwoch', hour: 16, venue: '' }]
      });

      const response = await request(app)
        .post('/api/students')
        .send(newStudent);

      expect(response.status).toBe(201);
      expect(response.body.availableTimes).toHaveLength(2);
      expect(response.body.availableTimes[0].day).toBe('Montag');
    });
  });

  describe('PUT /api/students/:id', () => {
    test('should update an existing student', async () => {
      // Create student
      const student = await Student.create(createTestStudent({ firstName: 'David' }));

      // Update student
      const response = await request(app)
        .put(`/api/students/${student._id}`)
        .send({ firstName: 'David Updated' });

      expect(response.status).toBe(200);
      expect(response.body.firstName).toBe('David Updated');

      // Verify update in DB
      const updatedStudent = await Student.findById(student._id);
      expect(updatedStudent.firstName).toBe('David Updated');
    });

    test('should return 404 for non-existent student', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .put(`/api/students/${fakeId}`)
        .send({ firstName: 'Nobody' });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/students/:id', () => {
    test('should delete an existing student', async () => {
      // Create student
      const student = await Student.create(createTestStudent({ firstName: 'Eve' }));

      // Delete student
      const response = await request(app)
        .delete(`/api/students/${student._id}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Student deleted');

      // Verify deletion in DB
      const deletedStudent = await Student.findById(student._id);
      expect(deletedStudent).toBeNull();
    });

    test('should return 404 when deleting non-existent student', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .delete(`/api/students/${fakeId}`);

      expect(response.status).toBe(404);
    });
  });
});
