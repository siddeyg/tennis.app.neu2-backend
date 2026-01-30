import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let mongoServer;

/**
 * Connect to in-memory MongoDB
 */
export const connectTestDB = async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
};

/**
 * Disconnect and stop MongoDB
 */
export const disconnectTestDB = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
};

/**
 * Clear all collections in database
 */
export const clearTestDB = async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
};

/**
 * Create test student with defaults
 */
export const createTestStudent = (overrides = {}) => ({
  firstName: 'Test',
  lastName: 'Student',
  birthDate: '2010-01-01',
  email: 'test@example.com',
  phone: '123456789',
  adress: 'Test Street 123',
  adult: false,
  member: true,
  team: false,
  trainigGroup: 'Rot',
  availableTimes: ['Montag 14', 'Mittwoch 14'],
  frequence: '2',
  ...overrides
});

/**
 * Create test coach with defaults
 */
export const createTestCoach = (overrides = {}) => ({
  firstName: 'Test',
  lastName: 'Coach',
  email: 'coach@example.com',
  phone: '987654321',
  birthday: '1985-05-15',
  adress: 'Coach Street 456',
  isCoachingAdult: true,
  isCoachingChildren: true,
  CoachingAdultLevels: ['Anfänger', 'wenig Fortgeschritten', 'Fortgeschritten', 'gute:r Spieler:in'],
  CoachingChildrenLevels: ['Kinderland', 'Rot', 'Orange', 'Grün', 'Gelb Team', 'Gelb Hobby'],
  availableTimes: ['Montag 14', 'Dienstag 15', 'Mittwoch 14'],
  ...overrides
});

/**
 * Create test settings with defaults
 */
export const createTestSettings = (overrides = {}) => ({
  singleton: true,
  courseCapacity: {
    defaultMaxStudents: 4,
    capacityByGroup: {
      Kinderland: 6,
      Rot: 4,
      Orange: 4,
      Grün: 4,
      'Gelb Team': 3,
      'Gelb Hobby': 4,
      Erwachsene: 4
    },
    minStudentsToRun: 1
  },
  ...overrides
});

/**
 * Mock admin authentication middleware for testing
 * Creates a mock admin user for requireAuth/requireRole middleware
 */
export const mockAuth = (userId = null) => {
  return (req, res, next) => {
    // Create ObjectId if not provided
    const adminId = userId || new mongoose.Types.ObjectId();

    // Create mock admin user compatible with Passport JWT strategy
    req.user = {
      _id: adminId,
      id: adminId,
      role: 'admin',
      firstName: 'Test',
      lastName: 'Admin',
      email: 'admin@test.com'
    };
    next();
  };
};

/**
 * Create multiple test students at once
 */
export const createTestStudents = (count, baseOverrides = {}) => {
  const students = [];
  for (let i = 0; i < count; i++) {
    students.push(createTestStudent({
      firstName: `Student${i + 1}`,
      lastName: `Last${i + 1}`,
      email: `student${i + 1}@test.com`,
      ...baseOverrides
    }));
  }
  return students;
};

/**
 * Create multiple test coaches at once
 */
export const createTestCoaches = (count, baseOverrides = {}) => {
  const coaches = [];
  for (let i = 0; i < count; i++) {
    coaches.push(createTestCoach({
      firstName: `Coach${i + 1}`,
      lastName: `Last${i + 1}`,
      email: `coach${i + 1}@test.com`,
      ...baseOverrides
    }));
  }
  return coaches;
};
