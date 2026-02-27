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
