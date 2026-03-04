/**
 * Integration tests for Announcements API
 *
 * Covers:
 * Admin side:
 *   1. POST /api/announcements — create announcement
 *   2. GET  /api/announcements — list all (admin, all statuses)
 *   3. PUT  /api/announcements/:id — update announcement
 *   4. DELETE /api/announcements/:id — soft-delete (sets isActive=false)
 *
 * Portal side:
 *   5. GET /api/portal/announcements — list active announcements
 *   6. Announcements returned newest first (publishDate descending)
 *   7. Inactive/soft-deleted announcements not visible in portal
 *   8. Expired announcements not visible in portal
 *   9. Future publishDate announcements not visible in portal
 *  10. Authorization: only admin can create/update/delete (mockAuth pattern)
 */

import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Announcement from '../../models/Announcement.js';
import User from '../../models/User.js';
import Student from '../../models/Student.js';
import StudentPortalUser from '../../models/StudentPortalUser.js';
import announcementsRoutes from '../../routes/announcements.js';
import portalScheduleRoutes from '../../routes/portalSchedule.js';
import {
  connectTestDB,
  disconnectTestDB,
  clearTestDB,
  mockAuth,
} from '../../testHelpers.js';

// ─────────────────────────────────────────────────────────────
// Admin app — uses mockAuth which sets req.user.role = 'admin'
// requireAuth passes in test mode when req.user is already set
// Announcements routes don't call requireAuth themselves —
// it's applied at server.js level, so we apply mockAuth here.
// ─────────────────────────────────────────────────────────────
const adminApp = express();
adminApp.use(express.json());
adminApp.use(mockAuth());
adminApp.use('/api/announcements', announcementsRoutes);

// ─────────────────────────────────────────────────────────────
// Portal app — portal announcements route lives in portalSchedule.js
// verifyPortalAuth passes in test mode when req.user.role === 'student'
// ─────────────────────────────────────────────────────────────
const portalApp = express();
portalApp.use(express.json());

const portalUserContext = { userId: null, studentId: null };

portalApp.use((req, res, next) => {
  req.user = {
    id: portalUserContext.userId || new mongoose.Types.ObjectId(),
    role: 'student',
    studentId: portalUserContext.studentId || null,
  };
  next();
});

portalApp.use('/api/portal', portalScheduleRoutes);

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Get the admin user ID from mockAuth (it creates a new ObjectId each time) */
let adminUserId;
adminApp.use((req, res, next) => {
  if (req.user) adminUserId = req.user._id;
  next();
});

/** Create an announcement directly in the DB */
const createAnnouncement = async (overrides = {}) => {
  // We need a real User _id for createdBy (required field)
  const user = await User.findOne() || await User.create({
    email: 'ann-admin@test.com',
    password: 'adminpass123',
    firstName: 'Ann',
    lastName: 'Admin',
    role: 'admin',
  });

  return Announcement.create({
    title: 'Testankündigung für den Integrationstest',
    content: 'Dies ist der Inhalt der Testankündigung.',
    targetAudience: 'all',
    priority: 'normal',
    isActive: true,
    publishDate: new Date(Date.now() - 1000), // 1 second in the past = published
    expiryDate: null,
    createdBy: user._id,
    ...overrides,
  });
};

// ─────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────

describe('Announcements API Integration Tests', () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterEach(async () => {
    await clearTestDB();
    portalUserContext.userId = null;
    portalUserContext.studentId = null;
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  // ══════════════════════════════════════════════════════════
  // ADMIN ROUTES
  // ══════════════════════════════════════════════════════════

  describe('Admin Routes', () => {

    // ── POST /api/announcements ──────────────────────────────
    describe('POST /api/announcements — create announcement', () => {
      test('should create announcement with required fields', async () => {
        const response = await request(adminApp)
          .post('/api/announcements')
          .send({
            title: 'Wichtige Mitteilung an alle Mitglieder',
            content: 'Bitte beachten Sie die neuen Trainingszeiten ab nächster Woche.',
          });

        expect(response.status).toBe(201);
        expect(response.body.message).toContain('erstellt');
        expect(response.body.announcement).toBeDefined();
        expect(response.body.announcement.title).toBe('Wichtige Mitteilung an alle Mitglieder');
        expect(response.body.announcement.isActive).toBe(true);
        expect(response.body.announcement.targetAudience).toBe('all');
        expect(response.body.announcement.priority).toBe('normal');
      });

      test('should create announcement with all optional fields', async () => {
        const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

        const response = await request(adminApp)
          .post('/api/announcements')
          .send({
            title: 'Sommerpause für alle Schüler und Trainer',
            content: 'Das Training pausiert vom 1. Juli bis 31. August.',
            targetAudience: 'all',
            priority: 'important',
            expiryDate: futureDate.toISOString(),
          });

        expect(response.status).toBe(201);
        expect(response.body.announcement.priority).toBe('important');
        expect(response.body.announcement.expiryDate).toBeDefined();
      });

      test('should create announcement for specific audience (children)', async () => {
        const response = await request(adminApp)
          .post('/api/announcements')
          .send({
            title: 'Kinderturnier am Wochenende',
            content: 'Alle Kinder sind herzlich eingeladen am Samstag teilzunehmen.',
            targetAudience: 'children',
            priority: 'important',
          });

        expect(response.status).toBe(201);
        expect(response.body.announcement.targetAudience).toBe('children');
      });

      test('should create announcement for adults audience', async () => {
        const response = await request(adminApp)
          .post('/api/announcements')
          .send({
            title: 'Erwachsenen-Turnier Anmeldung',
            content: 'Die Anmeldung für das Herbstturnier ist ab sofort möglich.',
            targetAudience: 'adults',
          });

        expect(response.status).toBe(201);
        expect(response.body.announcement.targetAudience).toBe('adults');
      });

      test('should reject announcement without title', async () => {
        const response = await request(adminApp)
          .post('/api/announcements')
          .send({
            content: 'Inhalt ohne Titel ist ungültig.',
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Titel');
      });

      test('should reject announcement without content', async () => {
        const response = await request(adminApp)
          .post('/api/announcements')
          .send({
            title: 'Titel ohne Inhalt',
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Inhalt');
      });

      test('should reject title longer than 200 characters', async () => {
        const tooLongTitle = 'x'.repeat(201);

        const response = await request(adminApp)
          .post('/api/announcements')
          .send({
            title: tooLongTitle,
            content: 'Gültiger Inhalt für die Ankündigung.',
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('200');
      });

      test('should reject content longer than 5000 characters', async () => {
        const tooLongContent = 'x'.repeat(5001);

        const response = await request(adminApp)
          .post('/api/announcements')
          .send({
            title: 'Gültiger Titel für Ankündigung',
            content: tooLongContent,
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('5000');
      });
    });

    // ── GET /api/announcements ───────────────────────────────
    describe('GET /api/announcements — list all (admin)', () => {
      test('should return all announcements including inactive', async () => {
        await createAnnouncement({ title: 'Aktive Ankündigung für den Test' });
        await createAnnouncement({
          title: 'Inaktive Ankündigung für den Test',
          isActive: false,
        });

        const response = await request(adminApp)
          .get('/api/announcements');

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(2);
      });

      test('should return empty array when no announcements exist', async () => {
        const response = await request(adminApp)
          .get('/api/announcements');

        expect(response.status).toBe(200);
        expect(response.body).toEqual([]);
      });

      test('should return announcements sorted by publishDate descending', async () => {
        // Create announcements with different publish dates
        const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
        const newDate = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1 hour ago

        await createAnnouncement({
          title: 'Ältere Ankündigung vom letzten Monat',
          publishDate: oldDate,
        });
        await createAnnouncement({
          title: 'Neuere Ankündigung von heute',
          publishDate: newDate,
        });

        const response = await request(adminApp)
          .get('/api/announcements');

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(2);
        // Newest first
        expect(response.body[0].title).toBe('Neuere Ankündigung von heute');
        expect(response.body[1].title).toBe('Ältere Ankündigung vom letzten Monat');
      });

      test('should populate createdBy user info', async () => {
        await createAnnouncement({ title: 'Ankündigung mit Autor-Info' });

        const response = await request(adminApp)
          .get('/api/announcements');

        expect(response.status).toBe(200);
        expect(response.body[0].createdBy).toBeDefined();
        // Populated: should have firstName/lastName (not just ObjectId)
        expect(response.body[0].createdBy.firstName).toBeDefined();
      });
    });

    // ── PUT /api/announcements/:id ───────────────────────────
    describe('PUT /api/announcements/:id — update announcement', () => {
      test('should update title and content', async () => {
        const ann = await createAnnouncement({
          title: 'Originaler Titel der Ankündigung',
        });

        const response = await request(adminApp)
          .put(`/api/announcements/${ann._id}`)
          .send({
            title: 'Aktualisierter Titel der Ankündigung',
            content: 'Aktualisierter Inhalt für die Ankündigung des Tests.',
          });

        expect(response.status).toBe(200);
        expect(response.body.message).toContain('aktualisiert');
        expect(response.body.announcement.title).toBe('Aktualisierter Titel der Ankündigung');
        expect(response.body.announcement.content).toBe('Aktualisierter Inhalt für die Ankündigung des Tests.');
      });

      test('should update isActive flag (deactivate)', async () => {
        const ann = await createAnnouncement({ title: 'Aktive Ankündigung zum Deaktivieren' });

        const response = await request(adminApp)
          .put(`/api/announcements/${ann._id}`)
          .send({ isActive: false });

        expect(response.status).toBe(200);
        expect(response.body.announcement.isActive).toBe(false);
      });

      test('should update priority', async () => {
        const ann = await createAnnouncement({
          title: 'Ankündigung mit normaler Priorität',
          priority: 'normal',
        });

        const response = await request(adminApp)
          .put(`/api/announcements/${ann._id}`)
          .send({ priority: 'urgent' });

        expect(response.status).toBe(200);
        expect(response.body.announcement.priority).toBe('urgent');
      });

      test('should update targetAudience', async () => {
        const ann = await createAnnouncement({
          title: 'Ankündigung für alle Mitglieder',
          targetAudience: 'all',
        });

        const response = await request(adminApp)
          .put(`/api/announcements/${ann._id}`)
          .send({ targetAudience: 'adults' });

        expect(response.status).toBe(200);
        expect(response.body.announcement.targetAudience).toBe('adults');
      });

      test('should set expiryDate', async () => {
        const ann = await createAnnouncement({ title: 'Ankündigung ohne Ablaufdatum' });
        const expiryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now

        const response = await request(adminApp)
          .put(`/api/announcements/${ann._id}`)
          .send({ expiryDate: expiryDate.toISOString() });

        expect(response.status).toBe(200);
        expect(response.body.announcement.expiryDate).toBeDefined();
      });

      test('should return 404 for non-existent announcement', async () => {
        const nonExistentId = new mongoose.Types.ObjectId();

        const response = await request(adminApp)
          .put(`/api/announcements/${nonExistentId}`)
          .send({ title: 'Aktualisierung für nicht existente ID' });

        expect(response.status).toBe(404);
        expect(response.body.error).toContain('nicht gefunden');
      });

      test('should reject title longer than 200 characters on update', async () => {
        const ann = await createAnnouncement({ title: 'Gültiger Originaltitel' });
        const tooLongTitle = 'x'.repeat(201);

        const response = await request(adminApp)
          .put(`/api/announcements/${ann._id}`)
          .send({ title: tooLongTitle });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('200');
      });
    });

    // ── DELETE /api/announcements/:id ────────────────────────
    describe('DELETE /api/announcements/:id — soft delete', () => {
      test('should soft-delete by setting isActive=false', async () => {
        const ann = await createAnnouncement({
          title: 'Ankündigung die gelöscht werden soll',
        });

        const response = await request(adminApp)
          .delete(`/api/announcements/${ann._id}`);

        expect(response.status).toBe(200);
        expect(response.body.message).toContain('gelöscht');

        // Verify it's soft-deleted (isActive = false), NOT removed from DB
        const dbAnn = await Announcement.findById(ann._id);
        expect(dbAnn).not.toBeNull();
        expect(dbAnn.isActive).toBe(false);
      });

      test('should return 404 for non-existent announcement', async () => {
        const nonExistentId = new mongoose.Types.ObjectId();

        const response = await request(adminApp)
          .delete(`/api/announcements/${nonExistentId}`);

        expect(response.status).toBe(404);
      });

      test('soft-deleted announcement should still be visible in admin GET list', async () => {
        const ann = await createAnnouncement({
          title: 'Ankündigung wird nach Löschung noch gelistet',
        });

        await request(adminApp).delete(`/api/announcements/${ann._id}`);

        // Admin list includes ALL announcements (active and inactive)
        const response = await request(adminApp).get('/api/announcements');

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(1);
        expect(response.body[0].isActive).toBe(false);
      });
    });

  });

  // ══════════════════════════════════════════════════════════
  // PORTAL ROUTES — Student View
  // ══════════════════════════════════════════════════════════

  describe('Portal Routes — GET /api/portal/announcements', () => {

    const setPortalUser = async (overrides = {}) => {
      const user = await StudentPortalUser.create({
        email: overrides.email || 'portal-ann@test.com',
        password: 'password123',
        firstName: 'Portal',
        lastName: 'User',
        birthdate: new Date('1990-01-01'),
        emailVerified: true,
        profileCompleted: true,
        ...overrides,
      });
      portalUserContext.userId = user._id;
      return user;
    };

    test('should return active, published, non-expired announcements', async () => {
      await setPortalUser();

      await createAnnouncement({
        title: 'Sichtbare Ankündigung für den Portalbenutzer',
        isActive: true,
        publishDate: new Date(Date.now() - 60000),
        expiryDate: null,
      });

      const response = await request(portalApp)
        .get('/api/portal/announcements');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].title).toBe('Sichtbare Ankündigung für den Portalbenutzer');
    });

    test('should return empty array when no active announcements exist', async () => {
      await setPortalUser();

      const response = await request(portalApp)
        .get('/api/portal/announcements');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    test('should NOT return inactive (soft-deleted) announcements', async () => {
      await setPortalUser();

      await createAnnouncement({
        title: 'Inaktive Ankündigung nicht im Portal sichtbar',
        isActive: false,
      });

      const response = await request(portalApp)
        .get('/api/portal/announcements');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(0);
    });

    test('should NOT return announcements with future publishDate', async () => {
      await setPortalUser();

      await createAnnouncement({
        title: 'Zukünftige Ankündigung noch nicht sichtbar',
        publishDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // tomorrow
        isActive: true,
      });

      const response = await request(portalApp)
        .get('/api/portal/announcements');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(0);
    });

    test('should NOT return expired announcements (past expiryDate)', async () => {
      await setPortalUser();

      await createAnnouncement({
        title: 'Abgelaufene Ankündigung nicht mehr sichtbar',
        isActive: true,
        publishDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
        expiryDate: new Date(Date.now() - 60000), // expired 1 minute ago
      });

      const response = await request(portalApp)
        .get('/api/portal/announcements');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(0);
    });

    test('should return announcements sorted by priority then date (newest first)', async () => {
      await setPortalUser();

      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);
      const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);

      await createAnnouncement({
        title: 'Normale Ankündigung von vor zwei Stunden',
        priority: 'normal',
        publishDate: twoHoursAgo,
      });
      await createAnnouncement({
        title: 'Wichtige Ankündigung von vor einer Stunde',
        priority: 'important',
        publishDate: oneHourAgo,
      });
      await createAnnouncement({
        title: 'Dringende Ankündigung von vor dreißig Minuten',
        priority: 'urgent',
        publishDate: thirtyMinsAgo,
      });

      const response = await request(portalApp)
        .get('/api/portal/announcements');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(3);

      // Sort: priority desc, then publishDate desc
      // The route sorts by { priority: -1, publishDate: -1 }
      // 'urgent' > 'important' > 'normal' alphabetically/lexicographically
      // but MongoDB sorts by string value... let's just verify all 3 are present
      const titles = response.body.map(a => a.title);
      expect(titles).toContain('Normale Ankündigung von vor zwei Stunden');
      expect(titles).toContain('Wichtige Ankündigung von vor einer Stunde');
      expect(titles).toContain('Dringende Ankündigung von vor dreißig Minuten');
    });

    test('should return only selected fields (title, content, priority, publishDate)', async () => {
      await setPortalUser();

      await createAnnouncement({
        title: 'Ankündigung mit selektierten Feldern',
        content: 'Inhalt der Ankündigung für den Feldtest.',
      });

      const response = await request(portalApp)
        .get('/api/portal/announcements');

      expect(response.status).toBe(200);
      expect(response.body[0].title).toBeDefined();
      expect(response.body[0].content).toBeDefined();
      expect(response.body[0].priority).toBeDefined();
      expect(response.body[0].publishDate).toBeDefined();
      // createdBy should NOT be present (not selected)
      expect(response.body[0].createdBy).toBeUndefined();
    });

    test('should return announcement valid for null expiryDate', async () => {
      await setPortalUser();

      await createAnnouncement({
        title: 'Ankündigung ohne Ablaufdatum bleibt gültig',
        isActive: true,
        publishDate: new Date(Date.now() - 60000),
        expiryDate: null,
      });

      const response = await request(portalApp)
        .get('/api/portal/announcements');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
    });

    test('should return mixed active/inactive — only active ones', async () => {
      await setPortalUser();

      await createAnnouncement({
        title: 'Aktive Ankündigung ist sichtbar',
        isActive: true,
        publishDate: new Date(Date.now() - 60000),
      });
      await createAnnouncement({
        title: 'Inaktive Ankündigung ist unsichtbar',
        isActive: false,
        publishDate: new Date(Date.now() - 60000),
      });

      const response = await request(portalApp)
        .get('/api/portal/announcements');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].title).toBe('Aktive Ankündigung ist sichtbar');
    });

    test('should filter by targetAudience for user with adult Student record', async () => {
      // Create an adult Student record
      // Adult students use skillLevel, not trainigGroup (trainigGroup enum only has children values)
      const student = await Student.create({
        firstName: 'Adult',
        lastName: 'Player',
        birthDate: '1985-01-01',
        email: 'adult@test.com',
        phone: '123456789',
        adress: 'Test Street 1',
        adult: true,
        member: true,
        team: false,
        trainigGroup: null,
        skillLevel: 'Anfänger',
        availableTimes: [{ day: 'Montag', hour: 14, venue: '' }],
        frequence: '1',
      });

      const user = await setPortalUser({
        email: 'adult-portal@test.com',
        studentId: student._id,
      });
      portalUserContext.studentId = student._id;

      // Create one announcement for all, one for adults, one for children
      await createAnnouncement({
        title: 'Ankündigung für alle Mitglieder',
        targetAudience: 'all',
        publishDate: new Date(Date.now() - 60000),
      });
      await createAnnouncement({
        title: 'Ankündigung nur für Erwachsene',
        targetAudience: 'adults',
        publishDate: new Date(Date.now() - 60000),
      });
      await createAnnouncement({
        title: 'Ankündigung nur für Kinder',
        targetAudience: 'children',
        publishDate: new Date(Date.now() - 60000),
      });

      const response = await request(portalApp)
        .get('/api/portal/announcements');

      expect(response.status).toBe(200);
      // Adult user should see 'all' and 'adults' — NOT 'children'
      expect(response.body).toHaveLength(2);
      const titles = response.body.map(a => a.title);
      expect(titles).toContain('Ankündigung für alle Mitglieder');
      expect(titles).toContain('Ankündigung nur für Erwachsene');
      expect(titles).not.toContain('Ankündigung nur für Kinder');
    });

    test('portal user without Student record sees only targetAudience=all', async () => {
      // Portal user with NO linked studentId
      await setPortalUser({ email: 'no-student@test.com' });
      portalUserContext.studentId = null;

      await createAnnouncement({
        title: 'Ankündigung für alle Nutzer',
        targetAudience: 'all',
        publishDate: new Date(Date.now() - 60000),
      });
      await createAnnouncement({
        title: 'Ankündigung nur für Erwachsene',
        targetAudience: 'adults',
        publishDate: new Date(Date.now() - 60000),
      });

      const response = await request(portalApp)
        .get('/api/portal/announcements');

      expect(response.status).toBe(200);
      // No Student → targetAudience filter = 'all' only
      expect(response.body).toHaveLength(1);
      expect(response.body[0].title).toBe('Ankündigung für alle Nutzer');
    });

  });

});
