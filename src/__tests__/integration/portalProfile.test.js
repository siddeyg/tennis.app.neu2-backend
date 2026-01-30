import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import Student from '../../models/Student.js';
import StudentPortalUser from '../../models/StudentPortalUser.js';
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
    // Simulate portal JWT token in req.user
    req.user = {
      id: new mongoose.Types.ObjectId(),
      role: 'student',
      studentId: req.testStudentId || new mongoose.Types.ObjectId(),
    };
    next();
  };
};

app.use(mockPortalAuth());
app.use('/api/portal', portalScheduleRoutes);

describe('Portal Profile API Integration Tests', () => {
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

  // Helper to create test student and portal user
  const createTestData = async () => {
    testStudent = await Student.create(
      createTestStudent({
        firstName: 'Max',
        lastName: 'Mustermann',
        birthDate: new Date('2010-05-15'),
        email: 'max.mustermann@test.com',
        phone: '0151 12345678',
        adress: 'Teststra�e 1, 12345 Teststadt',
        adult: false,
        trainigGroup: 'Gelb Team',
      })
    );

    testPortalUser = await StudentPortalUser.create({
      email: 'max.mustermann@test.com',
      password: 'testpassword123',
      firstName: 'Max',
      lastName: 'Mustermann',
      birthdate: new Date('2010-05-15'),
      phone: '0151 12345678',
      studentId: testStudent._id,
      emailVerified: true,
    });

    return { testStudent, testPortalUser };
  };

  describe('GET /api/portal/profile', () => {
    test('should return student profile data', async () => {
      const { testStudent } = await createTestData();

      // Set studentId in mock auth
      app.request.testStudentId = testStudent._id;

      const response = await request(app).get('/api/portal/profile');

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      expect(response.body.firstName).toBe('Max');
      expect(response.body.lastName).toBe('Mustermann');
      expect(response.body.email).toBe('max.mustermann@test.com');
      expect(response.body.phone).toBe('0151 12345678');
      expect(response.body.address).toBe('Teststra�e 1, 12345 Teststadt');
      expect(response.body.trainigGroup).toBe('Gelb Team');
    });

    test('should return 404 if student not found', async () => {
      const fakeStudentId = new mongoose.Types.ObjectId();
      app.request.testStudentId = fakeStudentId;

      const response = await request(app).get('/api/portal/profile');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Schüler nicht gefunden');
    });
  });

  describe('PUT /api/portal/profile', () => {
    test('should update student contact info', async () => {
      const { testStudent } = await createTestData();
      app.request.testStudentId = testStudent._id;

      const updatedData = {
        email: 'new.email@test.com',
        phone: '0160 99999999',
        address: 'Neue Stra�e 99, 54321 Neustadt',
      };

      const response = await request(app)
        .put('/api/portal/profile')
        .send(updatedData);

      expect(response.status).toBe(200);
      expect(response.body.email).toBe('new.email@test.com');
      expect(response.body.phone).toBe('0160 99999999');
      expect(response.body.address).toBe('Neue Stra�e 99, 54321 Neustadt');

      // Verify update in DB
      const updatedStudent = await Student.findById(testStudent._id);
      expect(updatedStudent.email).toBe('new.email@test.com');
      expect(updatedStudent.phone).toBe('0160 99999999');
      expect(updatedStudent.adress).toBe('Neue Stra�e 99, 54321 Neustadt');
    });

    test('should not update stammdaten (firstName, lastName, birthDate)', async () => {
      const { testStudent } = await createTestData();
      app.request.testStudentId = testStudent._id;

      const attemptedUpdate = {
        firstName: 'Hacker',
        lastName: 'McHackface',
        birthDate: new Date('1990-01-01'),
        email: 'valid@test.com',
      };

      const response = await request(app)
        .put('/api/portal/profile')
        .send(attemptedUpdate);

      expect(response.status).toBe(200);

      // Verify stammdaten NOT changed
      const updatedStudent = await Student.findById(testStudent._id);
      expect(updatedStudent.firstName).toBe('Max'); // NOT changed
      expect(updatedStudent.lastName).toBe('Mustermann'); // NOT changed
      expect(updatedStudent.email).toBe('valid@test.com'); // Only contact changed
    });

    test('should validate email format', async () => {
      const { testStudent } = await createTestData();
      app.request.testStudentId = testStudent._id;

      const invalidData = {
        email: 'invalid-email-format',
        phone: '0151 12345678',
      };

      const response = await request(app)
        .put('/api/portal/profile')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Ungültige Email-Adresse');
    });

    test('should validate phone format', async () => {
      const { testStudent } = await createTestData();
      app.request.testStudentId = testStudent._id;

      const invalidData = {
        email: 'valid@test.com',
        phone: 'invalid!@#$%phone',
      };

      const response = await request(app)
        .put('/api/portal/profile')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Ungültige Telefonnummer');
    });

    test('should allow empty email and phone', async () => {
      const { testStudent } = await createTestData();
      app.request.testStudentId = testStudent._id;

      const emptyData = {
        email: '',
        phone: '',
        address: 'Some Address',
      };

      const response = await request(app)
        .put('/api/portal/profile')
        .send(emptyData);

      expect(response.status).toBe(200);
      expect(response.body.email).toBe('');
      expect(response.body.phone).toBe('');
      expect(response.body.address).toBe('Some Address');
    });

    test('should trim whitespace from inputs', async () => {
      const { testStudent } = await createTestData();
      app.request.testStudentId = testStudent._id;

      const dataWithSpaces = {
        email: '  trimmed@test.com  ',
        phone: '  0151 12345678  ',
        address: '  Trimmed Street 1  ',
      };

      const response = await request(app)
        .put('/api/portal/profile')
        .send(dataWithSpaces);

      expect(response.status).toBe(200);
      expect(response.body.email).toBe('trimmed@test.com');
      expect(response.body.phone).toBe('0151 12345678');
      expect(response.body.address).toBe('Trimmed Street 1');
    });

    test('should return 404 if student not found', async () => {
      const fakeStudentId = new mongoose.Types.ObjectId();
      app.request.testStudentId = fakeStudentId;

      const response = await request(app)
        .put('/api/portal/profile')
        .send({ email: 'test@test.com' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Schüler nicht gefunden');
    });
  });
});
