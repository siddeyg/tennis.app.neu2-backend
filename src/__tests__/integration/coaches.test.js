import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Coach from '../../models/Coach.js';
import coachRoutes from '../../routes/coaches.js';
import { connectTestDB, disconnectTestDB, clearTestDB, createTestCoach, mockAuth } from '../../testHelpers.js';

// Create Express app for testing
const app = express();
app.use(express.json());
app.use(mockAuth()); // Mock authentication
app.use('/api/coaches', coachRoutes);

describe('Coach API Integration Tests', () => {
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

  describe('GET /api/coaches', () => {
    test('should return empty array when no coaches exist', async () => {
      const response = await request(app).get('/api/coaches');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    test('should return all coaches', async () => {
      // Create test coaches
      const coach1 = await Coach.create(createTestCoach({ firstName: 'Max' }));
      const coach2 = await Coach.create(createTestCoach({ firstName: 'Anna' }));

      const response = await request(app).get('/api/coaches');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].firstName).toBe('Max');
      expect(response.body[1].firstName).toBe('Anna');
    });
  });

  describe('POST /api/coaches', () => {
    test('should create a new coach with valid data', async () => {
      const newCoach = createTestCoach({ firstName: 'Peter' });

      const response = await request(app)
        .post('/api/coaches')
        .send(newCoach);

      expect(response.status).toBe(201);
      expect(response.body.firstName).toBe('Peter');
      expect(response.body._id).toBeDefined();

      // Verify coach was saved to DB
      const savedCoach = await Coach.findById(response.body._id);
      expect(savedCoach).toBeDefined();
      expect(savedCoach.firstName).toBe('Peter');
    });

    test('should create coach with availableTimes array', async () => {
      const newCoach = createTestCoach({
        availableTimes: ['Montag 14', 'Mittwoch 16']
      });

      const response = await request(app)
        .post('/api/coaches')
        .send(newCoach);

      expect(response.status).toBe(201);
      expect(response.body.availableTimes).toEqual(['Montag 14', 'Mittwoch 16']);
    });

    test('should create coach with coaching qualifications', async () => {
      const newCoach = createTestCoach({
        isCoachingAdult: true,
        isCoachingChildren: true,
        CoachingAdultLevels: ['Anfänger', 'Fortgeschritten'],
        CoachingChildrenLevels: ['Rot', 'Orange']
      });

      const response = await request(app)
        .post('/api/coaches')
        .send(newCoach);

      expect(response.status).toBe(201);
      expect(response.body.isCoachingAdult).toBe(true);
      expect(response.body.isCoachingChildren).toBe(true);
      expect(response.body.CoachingAdultLevels).toEqual(['Anfänger', 'Fortgeschritten']);
      expect(response.body.CoachingChildrenLevels).toEqual(['Rot', 'Orange']);
    });
  });

  describe('PUT /api/coaches/:id', () => {
    test('should update an existing coach', async () => {
      // Create coach
      const coach = await Coach.create(createTestCoach({ firstName: 'Tom' }));

      // Update coach
      const response = await request(app)
        .put(`/api/coaches/${coach._id}`)
        .send({ firstName: 'Tom Updated' });

      expect(response.status).toBe(200);
      expect(response.body.firstName).toBe('Tom Updated');

      // Verify update in DB
      const updatedCoach = await Coach.findById(coach._id);
      expect(updatedCoach.firstName).toBe('Tom Updated');
    });

    test('should update coach availableTimes', async () => {
      const coach = await Coach.create(createTestCoach({
        firstName: 'Sarah',
        availableTimes: ['Montag 14']
      }));

      const response = await request(app)
        .put(`/api/coaches/${coach._id}`)
        .send({ availableTimes: ['Montag 14', 'Dienstag 15', 'Mittwoch 16'] });

      expect(response.status).toBe(200);
      expect(response.body.availableTimes).toEqual(['Montag 14', 'Dienstag 15', 'Mittwoch 16']);
    });

    test('should return 404 for non-existent coach', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .put(`/api/coaches/${fakeId}`)
        .send({ firstName: 'Nobody' });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/coaches/:id', () => {
    test('should delete an existing coach', async () => {
      // Create coach
      const coach = await Coach.create(createTestCoach({ firstName: 'Lisa' }));

      // Delete coach
      const response = await request(app)
        .delete(`/api/coaches/${coach._id}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Coach deleted');

      // Verify deletion in DB
      const deletedCoach = await Coach.findById(coach._id);
      expect(deletedCoach).toBeNull();
    });

    test('should return 404 when deleting non-existent coach', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .delete(`/api/coaches/${fakeId}`);

      expect(response.status).toBe(404);
    });
  });
});
