import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import StudentPortalUser from '../../models/StudentPortalUser.js';
import BroadcastEmail from '../../models/BroadcastEmail.js';
import User from '../../models/User.js';
import broadcastEmailRoutes from '../../routes/broadcastEmail.js';
import {
  connectTestDB,
  disconnectTestDB,
  clearTestDB,
  mockAuth,
  createTestPortalUser
} from '../../testHelpers.js';

const app = express();
app.use(express.json());
app.use(mockAuth());
app.use('/api/broadcast-email', broadcastEmailRoutes);

describe('Broadcast Email API Integration Tests', () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  describe('GET /api/broadcast-email/recipients-count', () => {
    it('returns correct count of active and verified portal users', async () => {
      // Create active verified users
      await StudentPortalUser.create(createTestPortalUser({ email: 'user1@test.com' }));
      await StudentPortalUser.create(createTestPortalUser({ email: 'user2@test.com' }));
      // Create unverified user (should not count)
      await StudentPortalUser.create(createTestPortalUser({ email: 'unverified@test.com', emailVerified: false }));

      const res = await request(app)
        .get('/api/broadcast-email/recipients-count?targetAudience=all')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.recipientCount).toBe(2);
    });

    it('filters correctly between adults and children', async () => {
      // Adult user (no children)
      await StudentPortalUser.create(createTestPortalUser({
        email: 'adult@test.com',
        familyMembers: []
      }));

      // Parent user with children
      await StudentPortalUser.create(createTestPortalUser({
        email: 'parent@test.com',
        familyMembers: [{
          firstName: 'Child',
          lastName: 'One',
          relationship: 'child',
          birthDate: new Date('2015-01-01')
        }]
      }));

      const resAdults = await request(app)
        .get('/api/broadcast-email/recipients-count?targetAudience=adults')
        .expect(200);
      expect(resAdults.body.recipientCount).toBe(1);

      const resChildren = await request(app)
        .get('/api/broadcast-email/recipients-count?targetAudience=children')
        .expect(200);
      expect(resChildren.body.recipientCount).toBe(1);
    });
  });

  describe('POST /api/broadcast-email/send-test', () => {
    it('validates subject and contentHtml', async () => {
      const res = await request(app)
        .post('/api/broadcast-email/send-test')
        .send({})
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Betreff und Inhalt sind erforderlich');
    });

    it('sends test email to admin user', async () => {
      const res = await request(app)
        .post('/api/broadcast-email/send-test')
        .send({
          subject: 'Test Betreff',
          contentHtml: '<p>Hallo {Vorname}, dies ist ein Test.</p>'
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('Test-E-Mail erfolgreich');
    });
  });

  describe('POST /api/broadcast-email/send', () => {
    it('validates subject and contentHtml', async () => {
      await request(app)
        .post('/api/broadcast-email/send')
        .send({ subject: '' })
        .expect(400);
    });

    it('starts broadcast dispatch and creates record with pending recipients', async () => {
      await StudentPortalUser.create(createTestPortalUser({ email: 'user1@test.com' }));
      await StudentPortalUser.create(createTestPortalUser({ email: 'user2@test.com' }));

      const res = await request(app)
        .post('/api/broadcast-email/send')
        .send({
          subject: 'Saisonstart 2026/2027',
          contentHtml: '<p>Hallo {Vorname}, die Anmeldung ist eröffnet!</p>',
          targetAudience: 'all'
        })
        .expect(202);

      expect(res.body.success).toBe(true);
      expect(res.body.broadcastId).toBeDefined();
      expect(res.body.recipientCount).toBe(2);

      // Allow background worker to finish
      await new Promise(resolve => setTimeout(resolve, 50));

      const broadcast = await BroadcastEmail.findById(res.body.broadcastId);
      expect(broadcast).toBeDefined();
      expect(broadcast.subject).toBe('Saisonstart 2026/2027');
      expect(broadcast.recipients.length).toBe(2);
    });
  });

  describe('GET /api/broadcast-email/status/:id & POST /cancel/:id', () => {
    it('returns status metrics and allows cancellation', async () => {
      const admin = await User.create({
        firstName: 'Admin',
        lastName: 'User',
        email: 'admin_status@test.com',
        password: 'password123',
        role: 'admin'
      });
      const broadcast = await BroadcastEmail.create({
        subject: 'Laufender Broadcast',
        contentHtml: '<p>Inhalt</p>',
        contentText: 'Inhalt',
        senderAdminId: admin._id,
        status: 'sending',
        recipientCount: 50,
        sentCount: 10,
        failedCount: 0
      });

      const resStatus = await request(app)
        .get(`/api/broadcast-email/status/${broadcast._id}`)
        .expect(200);

      expect(resStatus.body.status).toBe('sending');
      expect(resStatus.body.sentCount).toBe(10);
      expect(resStatus.body.recipientCount).toBe(50);

      const resCancel = await request(app)
        .post(`/api/broadcast-email/cancel/${broadcast._id}`)
        .expect(200);

      expect(resCancel.body.success).toBe(true);

      const updated = await BroadcastEmail.findById(broadcast._id);
      expect(updated.status).toBe('cancelled');
    });
  });

  describe('GET /api/broadcast-email/history', () => {
    it('returns paginated broadcast list', async () => {
      const admin = await User.create({
        firstName: 'Admin',
        lastName: 'User',
        email: 'admin_history@test.com',
        password: 'password123',
        role: 'admin'
      });
      await BroadcastEmail.create({
        subject: 'Alte Rundmail',
        contentHtml: '<p>Inhalt</p>',
        contentText: 'Inhalt',
        senderAdminId: admin._id,
        status: 'completed',
        recipientCount: 100,
        sentCount: 100
      });

      const res = await request(app)
        .get('/api/broadcast-email/history')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.broadcasts.length).toBe(1);
      expect(res.body.broadcasts[0].subject).toBe('Alte Rundmail');
    });
  });
});
