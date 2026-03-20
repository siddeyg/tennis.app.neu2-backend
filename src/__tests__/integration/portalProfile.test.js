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
      id: req.testPortalUserId || new mongoose.Types.ObjectId(),
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

    // Set both IDs on the app request prototype for mock auth
    app.request.testStudentId = testStudent._id;
    app.request.testPortalUserId = testPortalUser._id;

    return { testStudent, testPortalUser };
  };

  // Required fields for all PUT /profile requests
  const requiredFields = {
    firstName: 'Max',
    lastName: 'Mustermann',
    birthDate: '2010-05-15',
    sex: 'männlich',
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
      expect(response.body.error).toBe('Portal-Benutzer nicht gefunden');
    });
  });

  describe('PUT /api/portal/profile', () => {
    test('should update student phone and address', async () => {
      const { testStudent } = await createTestData();

      const updatedData = {
        ...requiredFields,
        phone: '0160 99999999',
        address: 'Neue Strasse 99, 54321 Neustadt',
      };

      const response = await request(app)
        .put('/api/portal/profile')
        .send(updatedData);

      expect(response.status).toBe(200);
      expect(response.body.phone).toBe('0160 99999999');
      expect(response.body.address).toBe('Neue Strasse 99, 54321 Neustadt');

      // Verify update in DB
      const updatedStudent = await Student.findById(testStudent._id);
      expect(updatedStudent.phone).toBe('0160 99999999');
      expect(updatedStudent.adress).toBe('Neue Strasse 99, 54321 Neustadt');
    });

    test('should update name and personal data', async () => {
      const { testStudent } = await createTestData();

      const updatedData = {
        firstName: 'Maximiliane',
        lastName: 'Musterfrau',
        birthDate: '2010-05-15',
        sex: 'weiblich',
        phone: '0160 11111111',
      };

      const response = await request(app)
        .put('/api/portal/profile')
        .send(updatedData);

      expect(response.status).toBe(200);
      expect(response.body.firstName).toBe('Maximiliane');
      expect(response.body.lastName).toBe('Musterfrau');

      // Verify update in DB
      const updatedStudent = await Student.findById(testStudent._id);
      expect(updatedStudent.firstName).toBe('Maximiliane');
      expect(updatedStudent.lastName).toBe('Musterfrau');
    });

    test('should validate email format', async () => {
      await createTestData();

      const invalidData = {
        ...requiredFields,
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
      await createTestData();

      const invalidData = {
        ...requiredFields,
        email: 'valid@test.com',
        phone: 'invalid!@#$%phone',
      };

      const response = await request(app)
        .put('/api/portal/profile')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Ungültige Telefonnummer');
    });

    test('should allow empty phone and address', async () => {
      const { testStudent } = await createTestData();

      const emptyData = {
        ...requiredFields,
        phone: '',
        address: 'Some Address',
      };

      const response = await request(app)
        .put('/api/portal/profile')
        .send(emptyData);

      expect(response.status).toBe(200);
      expect(response.body.phone).toBe('');
      expect(response.body.address).toBe('Some Address');

      const updatedStudent = await Student.findById(testStudent._id);
      expect(updatedStudent.phone).toBe('');
    });

    test('should trim whitespace from inputs', async () => {
      const { testStudent } = await createTestData();

      const dataWithSpaces = {
        ...requiredFields,
        phone: '  0151 12345678  ',
        address: '  Trimmed Street 1  ',
      };

      const response = await request(app)
        .put('/api/portal/profile')
        .send(dataWithSpaces);

      expect(response.status).toBe(200);
      expect(response.body.phone).toBe('0151 12345678');
      expect(response.body.address).toBe('Trimmed Street 1');
    });

    test('should return 404 if student not found', async () => {
      await createTestData();
      app.request.testStudentId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .put('/api/portal/profile')
        .send(requiredFields);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Schüler nicht gefunden');
    });

    test('should require firstName', async () => {
      await createTestData();

      const response = await request(app)
        .put('/api/portal/profile')
        .send({ lastName: 'Mustermann', birthDate: '2010-05-15', sex: 'männlich' });

      expect(response.status).toBe(400);
    });

    test('should require sex', async () => {
      await createTestData();

      const response = await request(app)
        .put('/api/portal/profile')
        .send({ firstName: 'Max', lastName: 'Mustermann', birthDate: '2010-05-15' });

      expect(response.status).toBe(400);
    });
  });
});
