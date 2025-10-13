import request from 'supertest';
import express from 'express';
import Settings from '../../models/Settings.js';
import settingsRoutes from '../../routes/settings.js';
import { connectTestDB, disconnectTestDB, clearTestDB, createTestSettings, mockAuth } from '../../testHelpers.js';

// Create Express app for testing
const app = express();
app.use(express.json());
app.use(mockAuth()); // Mock authentication
app.use('/api/settings', settingsRoutes);

describe('Settings API Integration Tests', () => {
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

  describe('GET /api/settings', () => {
    test('should create and return default settings if none exist', async () => {
      const response = await request(app).get('/api/settings');

      expect(response.status).toBe(200);
      expect(response.body.singleton).toBe(true);
      expect(response.body.courseCapacity).toBeDefined();
      expect(response.body.courseCapacity.defaultMaxStudents).toBe(4);
    });

    test('should return existing settings', async () => {
      // First, create settings via PUT
      await request(app)
        .put('/api/settings')
        .send({
          courseCapacity: {
            defaultMaxStudents: 5,
            minStudentsToRun: 2
          }
        });

      const response = await request(app).get('/api/settings');

      expect(response.status).toBe(200);
      expect(response.body.courseCapacity.defaultMaxStudents).toBe(5);
      expect(response.body.courseCapacity.minStudentsToRun).toBe(2);
    });

    test('should only have one settings document (singleton)', async () => {
      await request(app).get('/api/settings');
      await request(app).get('/api/settings');

      const count = await Settings.countDocuments();
      expect(count).toBe(1);
    });
  });

  describe('PUT /api/settings', () => {
    test('should create settings if none exist', async () => {
      const response = await request(app)
        .put('/api/settings')
        .send({
          courseCapacity: {
            defaultMaxStudents: 5,
            minStudentsToRun: 2
          }
        });

      expect(response.status).toBe(200);
      expect(response.body.courseCapacity.defaultMaxStudents).toBe(5);
      expect(response.body.courseCapacity.minStudentsToRun).toBe(2);

      // Verify in DB
      const settings = await Settings.findOne({ singleton: true });
      expect(settings.courseCapacity.defaultMaxStudents).toBe(5);
    });

    test('should update existing settings', async () => {
      // Create initial settings via GET
      await request(app).get('/api/settings');

      // Update settings
      const response = await request(app)
        .put('/api/settings')
        .send({
          courseCapacity: {
            defaultMaxStudents: 6,
            minStudentsToRun: 3
          }
        });

      expect(response.status).toBe(200);
      expect(response.body.courseCapacity.defaultMaxStudents).toBe(6);
      expect(response.body.courseCapacity.minStudentsToRun).toBe(3);
    });

    test('should update specific capacity by group', async () => {
      // Create initial settings via GET
      await request(app).get('/api/settings');

      // Update specific groups
      const response = await request(app)
        .put('/api/settings')
        .send({
          courseCapacity: {
            capacityByGroup: {
              Rot: 5,
              'Gelb Team': 2
            }
          }
        });

      expect(response.status).toBe(200);
      expect(response.body.courseCapacity.capacityByGroup.Rot).toBe(5);
      expect(response.body.courseCapacity.capacityByGroup['Gelb Team']).toBe(2);
      // Other groups should retain default values
      expect(response.body.courseCapacity.capacityByGroup.Kinderland).toBe(6);
    });

    test('should merge capacity settings without overwriting all fields', async () => {
      // Create initial settings via GET
      await request(app).get('/api/settings');

      // First update to set some values
      await request(app)
        .put('/api/settings')
        .send({
          courseCapacity: {
            capacityByGroup: {
              Rot: 4,
              Orange: 4
            }
          }
        });

      // Update only one capacity
      const response = await request(app)
        .put('/api/settings')
        .send({
          courseCapacity: {
            capacityByGroup: {
              Rot: 5
            }
          }
        });

      expect(response.status).toBe(200);
      expect(response.body.courseCapacity.capacityByGroup.Rot).toBe(5);
      expect(response.body.courseCapacity.capacityByGroup.Orange).toBe(4); // Should remain
      expect(response.body.courseCapacity.defaultMaxStudents).toBe(4); // Should remain
    });

    test('should maintain singleton constraint', async () => {
      await request(app)
        .put('/api/settings')
        .send({ courseCapacity: { defaultMaxStudents: 5 } });

      await request(app)
        .put('/api/settings')
        .send({ courseCapacity: { defaultMaxStudents: 6 } });

      const count = await Settings.countDocuments();
      expect(count).toBe(1);

      const settings = await Settings.findOne({ singleton: true });
      expect(settings.courseCapacity.defaultMaxStudents).toBe(6);
    });

    test('should validate capacity values', async () => {
      // The model should have validation, but this tests the API behavior
      await Settings.create(createTestSettings());

      // This should be handled by Mongoose validation
      const response = await request(app)
        .put('/api/settings')
        .send({
          courseCapacity: {
            defaultMaxStudents: -1 // Invalid: should be >= 1
          }
        });

      // Should fail validation
      expect(response.status).toBe(500);
    });
  });

  describe('Settings Defaults', () => {
    test('should have correct default values for all training groups', async () => {
      const response = await request(app).get('/api/settings');

      const capacityByGroup = response.body.courseCapacity.capacityByGroup;
      expect(capacityByGroup.Kinderland).toBe(6);
      expect(capacityByGroup.Rot).toBe(4);
      expect(capacityByGroup.Orange).toBe(4);
      expect(capacityByGroup.Grün).toBe(4);
      expect(capacityByGroup['Gelb Team']).toBe(3);
      expect(capacityByGroup['Gelb Hobby']).toBe(4);
      expect(capacityByGroup.Erwachsene).toBe(4);
    });

    test('should have default minStudentsToRun of 1', async () => {
      const response = await request(app).get('/api/settings');

      expect(response.body.courseCapacity.minStudentsToRun).toBe(1);
    });
  });
});
