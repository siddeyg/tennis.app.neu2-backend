/**
 * Audit Log Entity Name Resolution & Plaintext Description Tests
 *
 * Verifies:
 * 1. Name resolution and German human summaries for Camp (CREATE & UPDATE)
 * 2. Name resolution and German human summaries for RegistrationPeriod (CREATE & UPDATE)
 * 3. Name resolution and German human summaries for Schedule (save & automatic generate)
 * 4. Plaintext summary generation for BroadcastEmail (Rundmail with subject)
 * 5. Route middleware audit log emission (DELETE_ALL on /api/students/all)
 */

import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import AuditLog from '../../models/AuditLog.js';
import User from '../../models/User.js';
import Camp from '../../models/Camp.js';
import RegistrationPeriod from '../../models/RegistrationPeriod.js';
import Student from '../../models/Student.js';
import auditLogsRouter from '../../routes/auditLogs.js';
import studentRoutes from '../../routes/students.js';
import {
  connectTestDB,
  disconnectTestDB,
  clearTestDB
} from '../../testHelpers.js';

const app = express();
app.use(express.json());

const adminId = new mongoose.Types.ObjectId();
app.use((req, res, next) => {
  req.user = {
    _id: adminId,
    id: adminId,
    role: 'admin',
    firstName: 'Nicole',
    lastName: 'Kreienborg',
    email: 'nicole@mondo-tennis.de'
  };
  next();
});

app.use('/api/audit-logs', auditLogsRouter);
app.use('/api/students', studentRoutes);

describe('Audit Log Entity Name Resolution & Plaintext Summaries', () => {
  let adminUser;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterEach(async () => {
    await clearTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    adminUser = await User.create({
      _id: adminId,
      firstName: 'Nicole',
      lastName: 'Kreienborg',
      email: 'nicole@mondo-tennis.de',
      password: 'hashedpassword123',
      role: 'admin'
    });
  });

  describe('1. Camp Entity Resolution & Summary', () => {
    it('should resolve Camp title and generate human summary for Camp creation and update', async () => {
      const camp = await Camp.create({
        title: 'Oster-Camp 2026',
        description: 'Intensives Tennistraining in den Osterferien',
        campType: 'technique-camp',
        startDate: new Date('2026-04-01'),
        endDate: new Date('2026-04-05'),
        registrationOpenDate: new Date('2026-01-01'),
        registrationCloseDate: new Date('2026-03-25'),
        maxParticipants: 20,
        createdBy: adminUser._id
      });

      // Log 1: CREATE Camp
      await AuditLog.create({
        action: 'CREATE',
        resource: 'Camp',
        resourceId: camp._id.toString(),
        method: 'POST',
        endpoint: '/api/camps',
        userId: adminUser._id,
        userEmail: adminUser.email,
        userRole: 'admin',
        status: 'SUCCESS',
        timestamp: new Date()
      });

      // Log 2: UPDATE Camp
      await AuditLog.create({
        action: 'UPDATE',
        resource: 'Camp',
        resourceId: camp._id.toString(),
        method: 'PUT',
        endpoint: `/api/camps/${camp._id}`,
        userId: adminUser._id,
        userEmail: adminUser.email,
        userRole: 'admin',
        status: 'SUCCESS',
        timestamp: new Date()
      });

      const res = await request(app)
        .get('/api/audit-logs')
        .query({ resource: 'Camp' })
        .expect(200);

      expect(res.body.logs).toHaveLength(2);

      const updateLog = res.body.logs.find(l => l.action === 'UPDATE');
      const createLog = res.body.logs.find(l => l.action === 'CREATE');

      expect(updateLog.resourceName).toBe('Oster-Camp 2026');
      expect(updateLog.description).toContain('Camp/Event gespeichert: "Oster-Camp 2026"');

      expect(createLog.resourceName).toBe('Oster-Camp 2026');
      expect(createLog.description).toContain('Neues Camp/Event angelegt: "Oster-Camp 2026"');
    });
  });

  describe('2. RegistrationPeriod Entity Resolution & Summary', () => {
    it('should resolve RegistrationPeriod name and generate human summary', async () => {
      const period = await RegistrationPeriod.create({
        name: 'Wintertraining 2026/2027',
        season: 'winter',
        trainingStartDate: new Date('2026-10-01'),
        trainingEndDate: new Date('2027-04-30'),
        registrationDeadline: new Date('2026-09-15'),
        status: 'open',
        currentPlanId: new mongoose.Types.ObjectId(),
        createdBy: adminUser._id
      });

      await AuditLog.create({
        action: 'CREATE',
        resource: 'RegistrationPeriod',
        resourceId: period._id.toString(),
        method: 'POST',
        endpoint: '/api/registration-periods',
        userId: adminUser._id,
        userEmail: adminUser.email,
        userRole: 'admin',
        status: 'SUCCESS',
        timestamp: new Date()
      });

      const res = await request(app)
        .get('/api/audit-logs')
        .query({ resource: 'RegistrationPeriod' })
        .expect(200);

      expect(res.body.logs).toHaveLength(1);
      const log = res.body.logs[0];
      expect(log.resourceName).toBe('Wintertraining 2026/2027');
      expect(log.description).toContain('Neue Trainingssaison angelegt: "Wintertraining 2026/2027"');
    });
  });

  describe('3. Schedule Entity Resolution & Summary', () => {
    it('should resolve Schedule period name and generate clear summaries for algorithm run and manual save', async () => {
      const period = await RegistrationPeriod.create({
        name: 'Sommertraining 2026',
        season: 'summer',
        trainingStartDate: new Date('2026-05-01'),
        trainingEndDate: new Date('2026-10-01'),
        registrationDeadline: new Date('2026-04-15'),
        status: 'open',
        currentPlanId: new mongoose.Types.ObjectId(),
        createdBy: adminUser._id
      });

      // Log 1: Algorithm run (endpoint: /api/schedule/generate triggers ALGORITHM_RUN description)
      await AuditLog.create({
        action: 'UPDATE',
        resource: 'Schedule',
        resourceId: period._id.toString(),
        method: 'POST',
        endpoint: '/api/schedule/generate',
        userId: adminUser._id,
        userEmail: adminUser.email,
        userRole: 'admin',
        status: 'SUCCESS',
        timestamp: new Date()
      });

      // Log 2: Schedule save
      await AuditLog.create({
        action: 'UPDATE',
        resource: 'Schedule',
        resourceId: period._id.toString(),
        method: 'PUT',
        endpoint: '/api/schedule',
        userId: adminUser._id,
        userEmail: adminUser.email,
        userRole: 'admin',
        status: 'SUCCESS',
        timestamp: new Date()
      });

      const res = await request(app)
        .get('/api/audit-logs')
        .query({ resource: 'Schedule' })
        .expect(200);

      expect(res.body.logs).toHaveLength(2);

      const algoLog = res.body.logs.find(l => l.endpoint.includes('generate'));
      const saveLog = res.body.logs.find(l => !l.endpoint.includes('generate'));

      expect(algoLog.resourceName).toBe('Saison Sommertraining 2026');
      expect(algoLog.description).toContain('Trainingsplan automatisch generiert ("Saison Sommertraining 2026")');

      expect(saveLog.resourceName).toBe('Saison Sommertraining 2026');
      expect(saveLog.description).toContain('Trainingsplan gespeichert ("Saison Sommertraining 2026")');
    });
  });

  describe('4. BroadcastEmail Summary Resolution', () => {
    it('should generate human summary using email subject from metadata', async () => {
      await AuditLog.create({
        action: 'CREATE',
        resource: 'BroadcastEmail',
        method: 'POST',
        endpoint: '/api/broadcast-email/send',
        metadata: { subject: 'Trainingsstart Winter 2026/27' },
        userId: adminUser._id,
        userEmail: adminUser.email,
        userRole: 'admin',
        status: 'SUCCESS',
        timestamp: new Date()
      });

      const res = await request(app)
        .get('/api/audit-logs')
        .query({ resource: 'BroadcastEmail' })
        .expect(200);

      expect(res.body.logs).toHaveLength(1);
      const log = res.body.logs[0];
      expect(log.description).toContain('Rundmail versendet: "Trainingsstart Winter 2026/27"');
    });
  });

  describe('5. Real Route Audit Log Emission Verification', () => {
    it('should record an audit log when DELETE /api/students/all is executed', async () => {
      const period = await RegistrationPeriod.create({
        name: 'Test Season',
        season: 'winter',
        trainingStartDate: new Date('2026-10-01'),
        trainingEndDate: new Date('2027-04-30'),
        registrationDeadline: new Date('2026-09-15'),
        status: 'open',
        currentPlanId: new mongoose.Types.ObjectId(),
        createdBy: adminUser._id
      });

      await Student.create({
        firstName: 'Test',
        lastName: 'Person',
        email: 'tp@test.com',
        periodId: period._id
      });

      // Execute DELETE /api/students/all
      await request(app)
        .delete('/api/students/all')
        .query({ periodId: period._id.toString() })
        .expect(200);

      // Brief pause to allow res.on('finish') async callback to persist AuditLog
      await new Promise(r => setTimeout(r, 100));

      // Verify that audit log was saved in DB
      const logs = await AuditLog.find({
        resource: 'Student',
        action: 'DELETE',
        endpoint: { $regex: /students\/all/ }
      });

      expect(logs).toHaveLength(1);
      const log = logs[0];
      expect(log.userEmail).toBe('nicole@mondo-tennis.de');
      expect(log.metadata.operation).toBe('DELETE_ALL');
      expect(log.metadata.critical).toBe(true);
    });
  });
});
