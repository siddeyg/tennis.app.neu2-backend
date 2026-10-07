import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Coach from '../../models/Coach.js';
import coachRoutes from '../../routes/coaches.js';
import { connectTestDB, disconnectTestDB, clearTestDB, createTestCoach, mockAuth } from '../../testHelpers.js';

import Student from '../../models/Student.js';
import RegistrationPeriod from '../../models/RegistrationPeriod.js';

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

    test('should return all coaches when no periodId specified', async () => {
      // Create test coaches
      const coach1 = await Coach.create(createTestCoach({ firstName: 'Max' }));
      const coach2 = await Coach.create(createTestCoach({ firstName: 'Anna' }));

      const response = await request(app).get('/api/coaches');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].firstName).toBe('Max');
      expect(response.body[1].firstName).toBe('Anna');
    });

    test('should return only period-active coaches when periodId is specified', async () => {
      // Create 2 coaches
      const summerCoach = await Coach.create(createTestCoach({
        firstName: 'SommerTrainer',
        availableTimes: [{ day: 'Montag', hour: 14 }]
      }));
      const winterCoach = await Coach.create(createTestCoach({
        firstName: 'WinterTrainer',
        availableTimes: [{ day: 'Dienstag', hour: 16 }]
      }));

      // Create winter period with only winterCoach configured
      const winterPeriod = await RegistrationPeriod.create({
        name: 'Wintertraining 2026/2027',
        season: 'winter',
        trainingStartDate: new Date('2026-10-01'),
        trainingEndDate: new Date('2027-04-01'),
        registrationDeadline: new Date('2026-09-15'),
        createdBy: new mongoose.Types.ObjectId(),
        hasConfiguredCoaches: true,
        activeCoaches: [{
          coachId: winterCoach._id,
          availableTimes: [{ day: 'Mittwoch', hour: 17 }]
        }]
      });

      // Request coaches for winter period
      const response = await request(app).get(`/api/coaches?periodId=${winterPeriod._id}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].firstName).toBe('WinterTrainer');
      expect(response.body[0].availableTimes).toEqual([{ day: 'Mittwoch', hour: 17 }]);
      expect(response.body[0].isActiveInPeriod).toBe(true);
    });

    test('should strictly return empty availableTimes when all times are cleared for a period without fallback', async () => {
      // Coach with global summer times
      const coach = await Coach.create(createTestCoach({
        firstName: 'CoachWithSummerTimes',
        availableTimes: [{ day: 'Montag', hour: 14 }, { day: 'Mittwoch', hour: 16 }]
      }));

      // Winter period where coach has 0 times (cleared/no training)
      const winterPeriod = await RegistrationPeriod.create({
        name: 'Winter 2026',
        season: 'winter',
        trainingStartDate: new Date('2026-10-01'),
        trainingEndDate: new Date('2027-04-01'),
        registrationDeadline: new Date('2026-09-15'),
        createdBy: new mongoose.Types.ObjectId(),
        hasConfiguredCoaches: true,
        activeCoaches: [{
          coachId: coach._id,
          availableTimes: [] // explicitly cleared: 0 training hours in winter!
        }]
      });

      const response = await request(app).get(`/api/coaches?periodId=${winterPeriod._id}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].firstName).toBe('CoachWithSummerTimes');
      // Crucial: Must be strictly empty array, NO fallback to the coach's global summer times!
      expect(response.body[0].availableTimes).toEqual([]);
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
        availableTimes: [{ day: 'Montag', hour: 14 }, { day: 'Mittwoch', hour: 16 }]
      });

      const response = await request(app)
        .post('/api/coaches')
        .send(newCoach);

      expect(response.status).toBe(201);
      expect(response.body.availableTimes).toHaveLength(2);
      expect(response.body.availableTimes[0].day).toBe('Montag');
      expect(response.body.availableTimes[0].hour).toBe(14);
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
        availableTimes: [{ day: 'Montag', hour: 14 }]
      }));

      const newTimes = [
        { day: 'Montag', hour: 14 },
        { day: 'Dienstag', hour: 15 },
        { day: 'Mittwoch', hour: 16 }
      ];
      const response = await request(app)
        .put(`/api/coaches/${coach._id}`)
        .send({ availableTimes: newTimes });

      expect(response.status).toBe(200);
      expect(response.body.availableTimes).toHaveLength(3);
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
    test('should delete an existing coach when no students assigned', async () => {
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

    test('should return 409 conflict when deleting coach with assigned students', async () => {
      // Create coach
      const coach = await Coach.create(createTestCoach({ firstName: 'Jens' }));

      // Create student with assignment to Jens
      await Student.create({
        firstName: 'Tim',
        lastName: 'Muster',
        email: 'tim@example.com',
        phone: '12345',
        assignments: [{
          day: 'Montag',
          hour: 14,
          coach: coach._id,
        }]
      });

      // Try to delete coach
      const response = await request(app)
        .delete(`/api/coaches/${coach._id}`);

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('Trainer kann nicht gelöscht werden');

      // Verify coach is still in DB
      const coachStillThere = await Coach.findById(coach._id);
      expect(coachStillThere).not.toBeNull();
    });

    test('should return 404 when deleting non-existent coach', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .delete(`/api/coaches/${fakeId}`);

      expect(response.status).toBe(404);
    });
  });
});
