import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import AuditLog from '../../models/AuditLog.js';
import User from '../../models/User.js';
import Coach from '../../models/Coach.js';
import Student from '../../models/Student.js';
import auditLogsRouter from '../../routes/auditLogs.js';
import { createAuditLog } from '../../middleware/auditLog.js';
import { connectTestDB, disconnectTestDB, clearTestDB, mockAuth } from '../../testHelpers.js';

const app = express();
app.use(express.json());
app.use(mockAuth());
app.use('/api/audit-logs', auditLogsRouter);

describe('Audit Log Enhancements Integration Tests', () => {
  let adminUser;
  let nicoleUser;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    adminUser = await User.create({
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@test.com',
      password: 'hashedpassword123',
      role: 'admin'
    });

    nicoleUser = await User.create({
      firstName: 'Nicole',
      lastName: 'Kreienborg',
      email: 'nicole@mondo-tennis.de',
      password: 'hashedpassword123',
      role: 'admin'
    });
  });

  describe('Model Enum & Indexing', () => {
    test('should accept EXPORT as a valid action enum', async () => {
      const log = new AuditLog({
        action: 'EXPORT',
        resource: 'AuditLog',
        method: 'POST',
        endpoint: '/api/audit-logs/export',
        userId: adminUser._id,
        userEmail: adminUser.email,
        userRole: 'admin',
        status: 'SUCCESS'
      });

      const saved = await log.save();
      expect(saved._id).toBeDefined();
      expect(saved.action).toBe('EXPORT');
    });

    test('should have indexes on userEmail and timestamp_userEmail', async () => {
      const indexes = await AuditLog.collection.indexes();
      const indexNames = indexes.map(idx => idx.name);

      expect(indexNames).toContain('userEmail_1');
      expect(indexNames).toContain('timestamp_-1_userEmail_1');
    });
  });

  describe('Sanitization in createAuditLog', () => {
    test('should redact IBAN, kontoinhaber, accountHolder and password across requestBody, changes and metadata', async () => {
      await createAuditLog({
        userId: nicoleUser._id,
        userEmail: nicoleUser.email,
        userRole: nicoleUser.role,
        action: 'UPDATE',
        resource: 'Student',
        resourceId: 'test-123',
        method: 'PUT',
        endpoint: '/api/students/test-123',
        requestBody: {
          iban: 'DE12345678901234567890',
          kontoinhaber: 'Nicole Test',
          accountHolder: 'Nicole Test',
          password: 'SecretPassword!',
          safeField: 'visibleData'
        },
        changes: {
          iban: { before: 'DE11111111111111111111', after: 'DE22222222222222222222' },
          name: { before: 'Old', after: 'New' }
        },
        metadata: {
          kontoinhaber: 'Nicole Test',
          note: 'Bank details updated'
        },
        status: 'SUCCESS'
      });

      const saved = await AuditLog.findOne({ resourceId: 'test-123' }).lean();
      expect(saved).toBeDefined();

      // Check requestBody
      expect(saved.requestBody.iban).toBe('[REDACTED]');
      expect(saved.requestBody.kontoinhaber).toBe('[REDACTED]');
      expect(saved.requestBody.accountHolder).toBe('[REDACTED]');
      expect(saved.requestBody.password).toBe('[REDACTED]');
      expect(saved.requestBody.safeField).toBe('visibleData');

      // Check changes
      expect(saved.changes.iban).toBe('[REDACTED]');
      expect(saved.changes.name).toEqual({ before: 'Old', after: 'New' });

      // Check metadata
      expect(saved.metadata.kontoinhaber).toBe('[REDACTED]');
      expect(saved.metadata.note).toBe('Bank details updated');
    });
  });

  describe('Search & User Name Resolution', () => {
    beforeEach(async () => {
      // Create log by Nicole
      await AuditLog.create({
        action: 'UPDATE',
        resource: 'Schedule',
        method: 'PUT',
        endpoint: '/api/schedule',
        userId: nicoleUser._id,
        userEmail: nicoleUser.email,
        userRole: 'admin',
        status: 'SUCCESS',
        timestamp: new Date()
      });

      // Create log by another user
      await AuditLog.create({
        action: 'CREATE',
        resource: 'BroadcastEmail',
        method: 'POST',
        endpoint: '/api/broadcast-email/send',
        userId: adminUser._id,
        userEmail: adminUser.email,
        userRole: 'admin',
        status: 'SUCCESS',
        timestamp: new Date()
      });
    });

    test('should find Nicole\'s logs when searching for "nicole"', async () => {
      const res = await request(app)
        .get('/api/audit-logs')
        .query({ search: 'nicole' });

      expect(res.status).toBe(200);
      expect(res.body.logs.length).toBe(1);
      expect(res.body.logs[0].userEmail).toBe('nicole@mondo-tennis.de');
    });

    test('should find Nicole\'s logs when searching for "Kreienborg"', async () => {
      const res = await request(app)
        .get('/api/audit-logs')
        .query({ search: 'Kreienborg' });

      expect(res.status).toBe(200);
      expect(res.body.logs.length).toBe(1);
      expect(res.body.logs[0].userEmail).toBe('nicole@mondo-tennis.de');
    });

    test('should find Nicole\'s logs when searching by full name "Nicole Kreienborg"', async () => {
      const res = await request(app)
        .get('/api/audit-logs')
        .query({ search: 'Nicole Kreienborg' });

      expect(res.status).toBe(200);
      expect(res.body.logs.length).toBe(1);
      expect(res.body.logs[0].userEmail).toBe('nicole@mondo-tennis.de');
    });

    test('should filter by action and resource', async () => {
      const res = await request(app)
        .get('/api/audit-logs')
        .query({ resource: 'BroadcastEmail', action: 'CREATE' });

      expect(res.status).toBe(200);
      expect(res.body.logs.length).toBe(1);
      expect(res.body.logs[0].resource).toBe('BroadcastEmail');
    });
  });

  describe('CSV Export Endpoint', () => {
    test('should export logs to CSV with UTF-8 BOM', async () => {
      await AuditLog.create({
        action: 'EXPORT',
        resource: 'AuditLog',
        method: 'POST',
        endpoint: '/api/audit-logs/export',
        userId: adminUser._id,
        userEmail: adminUser.email,
        userRole: 'admin',
        status: 'SUCCESS',
        timestamp: new Date()
      });

      const res = await request(app)
        .post('/api/audit-logs/export')
        .send({ action: 'EXPORT' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('EXPORT');
      expect(res.text).toContain('AuditLog');
    });
  });

  describe('Human-Readable Activity Summaries & Entity Name Resolution', () => {
    test('should resolve Coach name and generate human-readable summary for availableTimes update', async () => {
      const coach = await Coach.create({
        firstName: 'Nicole',
        lastName: 'Kreienborg',
        color: '#ff0000',
        availableTimes: []
      });

      await AuditLog.create({
        action: 'UPDATE',
        resource: 'Coach',
        resourceId: String(coach._id),
        method: 'PUT',
        endpoint: `/api/coaches/${coach._id}`,
        requestBody: { availableTimes: [{ day: 'Montag', hour: 14 }] },
        userId: nicoleUser._id,
        userEmail: nicoleUser.email,
        userRole: 'admin',
        status: 'SUCCESS',
        timestamp: new Date()
      });

      const res = await request(app).get('/api/audit-logs');

      expect(res.status).toBe(200);
      const coachLog = res.body.logs.find(l => String(l.resourceId) === String(coach._id));
      expect(coachLog).toBeDefined();
      expect(coachLog.resourceName).toBe('Nicole Kreienborg');
      expect(coachLog.description).toContain('Verfügbarkeitszeiten von Trainerin/Trainer "Nicole Kreienborg" aktualisiert');
    });

    test('should resolve Student name and generate human-readable summary for student update', async () => {
      const student = await Student.create({
        firstName: 'Felix',
        lastName: 'Müller',
        email: 'felix@test.com',
        periodId: new mongoose.Types.ObjectId()
      });

      await AuditLog.create({
        action: 'UPDATE',
        resource: 'Student',
        resourceId: String(student._id),
        method: 'PUT',
        endpoint: `/api/students/${student._id}`,
        requestBody: { phone: '0123456789' },
        userId: nicoleUser._id,
        userEmail: nicoleUser.email,
        userRole: 'admin',
        status: 'SUCCESS',
        timestamp: new Date()
      });

      const res = await request(app).get('/api/audit-logs');

      expect(res.status).toBe(200);
      const studentLog = res.body.logs.find(l => String(l.resourceId) === String(student._id));
      expect(studentLog).toBeDefined();
      expect(studentLog.resourceName).toBe('Felix Müller');
      expect(studentLog.description).toContain('Schülerdaten von "Felix Müller" bearbeitet');
    });
  });
});
