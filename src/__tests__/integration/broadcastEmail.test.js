import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import StudentPortalUser from '../../models/StudentPortalUser.js';
import BroadcastEmail from '../../models/BroadcastEmail.js';
import User from '../../models/User.js';
import RegistrationPeriod from '../../models/RegistrationPeriod.js';
import SeasonalRegistration from '../../models/SeasonalRegistration.js';
import Announcement from '../../models/Announcement.js';
import Coach from '../../models/Coach.js';
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

    it('deduplicates parents with multiple children and aggregates names (Tim & Lisa)', async () => {
      const adminPeriodUser = await User.create({
        firstName: 'Admin',
        lastName: 'Season',
        email: 'admin_season@test.com',
        password: 'password123',
        role: 'admin'
      });

      const period = await RegistrationPeriod.create({
        name: 'Winter 2026/2027',
        season: 'winter',
        trainingStartDate: new Date('2026-10-01'),
        trainingEndDate: new Date('2027-04-30'),
        registrationDeadline: new Date('2026-09-30'),
        createdBy: adminPeriodUser._id,
        isActive: true
      });

      const parentUser = await StudentPortalUser.create(createTestPortalUser({
        email: 'eltern@test.com',
        firstName: 'Markus',
        lastName: 'Mueller'
      }));

      // Child 1 registration
      await SeasonalRegistration.create({
        periodId: period._id,
        studentPortalUserId: parentUser._id,
        familyMemberId: new mongoose.Types.ObjectId(),
        formType: 'kids',
        firstName: 'Tim',
        lastName: 'Mueller',
        email: 'eltern@test.com',
        birthdate: new Date('2018-05-10'),
        status: 'processed',
        privacyConsent: true
      });

      // Child 2 registration with same parent email
      await SeasonalRegistration.create({
        periodId: period._id,
        studentPortalUserId: parentUser._id,
        familyMemberId: new mongoose.Types.ObjectId(),
        formType: 'kids',
        firstName: 'Lisa',
        lastName: 'Mueller',
        email: 'eltern@test.com',
        birthdate: new Date('2016-08-20'),
        status: 'processed',
        privacyConsent: true
      });

      // Cancelled registration (should NOT be included!)
      await SeasonalRegistration.create({
        periodId: period._id,
        studentPortalUserId: parentUser._id,
        familyMemberId: new mongoose.Types.ObjectId(),
        formType: 'kids',
        firstName: 'StorniertesKind',
        lastName: 'Mueller',
        email: 'storno@test.com',
        birthdate: new Date('2017-01-01'),
        status: 'cancelled',
        privacyConsent: true
      });

      const res = await request(app)
        .post('/api/broadcast-email/send')
        .send({
          subject: 'Infos zum Wintertraining',
          contentHtml: '<p>Liebe Eltern von {Vorname}, hier sind alle Infos.</p>',
          targetingType: 'seasonal',
          targetCriteria: {
            periodId: period._id.toString(),
            formType: 'kids'
          },
          publishToNoticeboard: true
        })
        .expect(202);

      expect(res.body.success).toBe(true);
      expect(res.body.recipientCount).toBe(1); // Exactly 1 parent email, not 2
      expect(res.body.createdAnnouncementId).toBeDefined();

      const broadcast = await BroadcastEmail.findById(res.body.broadcastId);
      expect(broadcast.recipients.length).toBe(1);
      expect(broadcast.recipients[0].email).toBe('eltern@test.com');
      // Names must be aggregated
      expect(broadcast.recipients[0].name).toContain('Tim & Lisa');

      // Verify noticeboard announcement was created
      const announcement = await Announcement.findById(res.body.createdAnnouncementId);
      expect(announcement).toBeDefined();
      expect(announcement.title).toBe('Infos zum Wintertraining');
      expect(announcement.targetAudience).toBe('children');
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

  describe('GET /api/broadcast-email/target-options & /search-recipients', () => {
    it('returns target options with seasons, camps, venues, days and talentinos', async () => {
      const res = await request(app)
        .get('/api/broadcast-email/target-options')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.seasons)).toBe(true);
      expect(Array.isArray(res.body.camps)).toBe(true);
      expect(Array.isArray(res.body.venues)).toBe(true);
      expect(Array.isArray(res.body.days)).toBe(true);
      expect(Array.isArray(res.body.talentinos)).toBe(true);
      expect(res.body.days).toContain('Montag');
    });

    it('searches recipients by query string across portal users and students', async () => {
      await StudentPortalUser.create(createTestPortalUser({
        firstName: 'Alexander',
        lastName: 'Zverev',
        email: 'sascha@tennis.de'
      }));

      const res = await request(app)
        .get('/api/broadcast-email/search-recipients?q=zverev')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.results.length).toBe(1);
      expect(res.body.results[0].email).toBe('sascha@tennis.de');
      expect(res.body.results[0].name).toBe('Alexander Zverev');
    });

    it('finds recipients using multi-word search (first name + last name)', async () => {
      await StudentPortalUser.create(createTestPortalUser({
        firstName: 'Boris',
        lastName: 'Becker',
        email: 'boris.becker@tennis.de'
      }));

      // Search with both first and last name separated by whitespace
      const res = await request(app)
        .get('/api/broadcast-email/search-recipients?q=Boris%20Becker')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.results.length).toBe(1);
      expect(res.body.results[0].email).toBe('boris.becker@tennis.de');
      expect(res.body.results[0].name).toBe('Boris Becker');
    });

    it('includes coaches in recipient search and resolves them in recipient count', async () => {
      const coach = await Coach.create({
        firstName: 'Steffi',
        lastName: 'Graf',
        email: 'steffi.graf@trainer.local',
        phone: '0171-1234567'
      });

      // Search by partial/multi-word name
      const searchRes = await request(app)
        .get('/api/broadcast-email/search-recipients?q=Steffi%20Graf')
        .expect(200);

      expect(searchRes.body.success).toBe(true);
      expect(searchRes.body.results.length).toBeGreaterThanOrEqual(1);
      const coachResult = searchRes.body.results.find(r => r.email === 'steffi.graf@trainer.local');
      expect(coachResult).toBeDefined();
      expect(coachResult.type).toBe('coach');
      expect(coachResult.subtitle).toBe('🎾 Trainer (Coach)');
      expect(coachResult.name).toBe('Steffi Graf');

      // Verify coach resolution in recipient count for specific user IDs
      const countRes = await request(app)
        .get(`/api/broadcast-email/recipients-count?targetingType=custom&specificUserIds=${coach._id}`)
        .expect(200);

      expect(countRes.body.success).toBe(true);
      expect(countRes.body.recipientCount).toBe(1);
    });
  });

  describe('Drafts & Templates CRUD', () => {
    it('manages drafts lifecycle (save, list, delete)', async () => {
      const saveRes = await request(app)
        .post('/api/broadcast-email/draft')
        .send({
          subject: 'Mein Entwurf',
          contentHtml: '<p>Noch nicht fertig</p>'
        })
        .expect(200);

      expect(saveRes.body.success).toBe(true);
      const draftId = saveRes.body.draftId;
      expect(draftId).toBeDefined();

      const listRes = await request(app)
        .get('/api/broadcast-email/drafts')
        .expect(200);

      expect(listRes.body.success).toBe(true);
      expect(listRes.body.drafts.length).toBe(1);
      expect(listRes.body.drafts[0].subject).toBe('Mein Entwurf');

      await request(app)
        .delete(`/api/broadcast-email/draft/${draftId}`)
        .expect(200);

      const afterDel = await request(app)
        .get('/api/broadcast-email/drafts')
        .expect(200);
      expect(afterDel.body.drafts.length).toBe(0);
    });

    it('manages templates and serves system templates', async () => {
      const listRes = await request(app)
        .get('/api/broadcast-email/templates')
        .expect(200);

      expect(listRes.body.success).toBe(true);
      expect(listRes.body.systemTemplates.length).toBeGreaterThanOrEqual(4);

      const createRes = await request(app)
        .post('/api/broadcast-email/templates')
        .send({
          title: 'Meine Vereins-Vorlage',
          subject: 'Vorlage: Betreff',
          contentHtml: '<p>Vorlageninhalt</p>'
        })
        .expect(200);

      expect(createRes.body.success).toBe(true);
      const customId = createRes.body.template._id;

      const afterCreate = await request(app)
        .get('/api/broadcast-email/templates')
        .expect(200);
      expect(afterCreate.body.customTemplates.length).toBe(1);

      await request(app)
        .delete(`/api/broadcast-email/templates/${customId}`)
        .expect(200);
    });
  });

  describe('GET /api/broadcast-email/history', () => {
    it('returns paginated broadcast list and excludes drafts and templates', async () => {
      const admin = await User.create({
        firstName: 'Admin',
        lastName: 'User',
        email: 'admin_history@test.com',
        password: 'password123',
        role: 'admin'
      });
      // Regular sent broadcast
      await BroadcastEmail.create({
        subject: 'Alte Rundmail',
        contentHtml: '<p>Inhalt</p>',
        contentText: 'Inhalt',
        senderAdminId: admin._id,
        status: 'completed',
        recipientCount: 100,
        sentCount: 100
      });
      // Draft (should be excluded)
      await BroadcastEmail.create({
        subject: 'Ein Entwurf',
        contentHtml: '<p>Inhalt</p>',
        contentText: 'Inhalt',
        senderAdminId: admin._id,
        status: 'draft',
        isTemplate: false
      });
      // Template (should be excluded)
      await BroadcastEmail.create({
        subject: 'Ein Template',
        contentHtml: '<p>Inhalt</p>',
        contentText: 'Inhalt',
        senderAdminId: admin._id,
        status: 'completed',
        isTemplate: true
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
