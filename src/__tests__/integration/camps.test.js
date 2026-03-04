/**
 * Integration Tests for Camps API
 *
 * Covers admin camp management endpoints and portal camp registration.
 *
 * Admin routes (requireAuth + requireAdminOrSupermod):
 * - POST   /api/camps                              - Create camp
 * - GET    /api/camps                              - List camps (filter by status)
 * - PUT    /api/camps/:id                          - Update camp
 * - POST   /api/camps/:id/open                     - Open camp (draft → open)
 * - POST   /api/camps/:id/close                    - Close camp (open → closed)
 * - POST   /api/camps/:id/open (reopen)            - Reopen camp (closed → open)
 * - DELETE /api/camps/:id                          - Soft delete (with participant guards)
 * - GET    /api/camps/:id/registrations            - List registrations
 * - PUT    /api/camps/:id/registrations/:regId/status  - Confirm/reject registration
 *
 * Portal routes (verifyPortalAuth):
 * - POST   /api/portal/camps/:id/register          - Register for camp (IBAN optional)
 * - DELETE /api/portal/camps/registrations/:regId  - Cancel registration
 */

import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import Camp from '../../models/Camp.js';
import CampRegistration from '../../models/CampRegistration.js';
import User from '../../models/User.js';
import StudentPortalUser from '../../models/StudentPortalUser.js';
import campsRoutes from '../../routes/camps.js';
import portalCampsRoutes from '../../routes/portalCamps.js';
import {
  connectTestDB,
  disconnectTestDB,
  clearTestDB,
} from '../../testHelpers.js';

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use(cookieParser());

// Mock admin auth — NODE_ENV=test + req.user set → requireAuth and
// requireAdminOrSupermod bypass JWT and just check role.
let mockAdminUser = null;
app.use((req, res, next) => {
  if (mockAdminUser) req.user = mockAdminUser;
  next();
});

// Mock portal auth — NODE_ENV=test + req.user.role='student' → verifyPortalAuth bypass.
let mockPortalUser = null;
app.use((req, res, next) => {
  if (mockPortalUser && !req.user) req.user = mockPortalUser;
  next();
});

app.use('/api/camps', campsRoutes);
app.use('/api/portal/camps', portalCampsRoutes);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a valid camp payload.
 * registrationOpenDate is in the past so POST /open works immediately.
 * Date constraints: registrationCloseDate < startDate, endDate >= startDate.
 */
function buildCampData(overrides = {}) {
  const now = new Date();
  const regOpen = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);   // 7 days ago
  const regClose = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);  // 3 days from now
  const start = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);    // 14 days from now
  const end = new Date(now.getTime() + 16 * 24 * 60 * 60 * 1000);      // 16 days from now

  return {
    title: 'Sommer Tennis Camp',
    description: 'Ein großartiges Tenniscamp für alle Altersgruppen.',
    campType: 'beginner-course',
    schedule: [{ day: 'Montag', startTime: '10:00', endTime: '13:00' }],
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    registrationOpenDate: regOpen.toISOString(),
    registrationCloseDate: regClose.toISOString(),
    maxParticipants: 10,
    ...overrides,
  };
}

/**
 * Create a camp directly in the DB with status='draft' by default.
 */
async function createCamp(adminUserId, overrides = {}) {
  const data = buildCampData(overrides);
  return Camp.create({
    ...data,
    status: overrides.status || 'draft',
    createdBy: adminUserId,
  });
}

/**
 * Build a valid adult camp registration payload (IBAN optional).
 */
function buildRegistrationPayload(overrides = {}) {
  return {
    firstName: 'Maria',
    lastName: 'Mustermann',
    birthdate: '1990-06-15',
    email: 'maria@test.com',
    phone: '0151 12345678',
    skillLevel: 'beginner',
    team: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Camps API — Admin + Portal Integration Tests', () => {
  let adminUser;
  let portalUser;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    // Create admin user
    adminUser = await User.create({
      email: 'admin@test.com',
      password: 'password123',
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin',
      isActive: true,
    });

    // Create portal user (for camp registration)
    portalUser = await StudentPortalUser.create({
      email: 'student@test.com',
      password: 'password123',
      firstName: 'Student',
      lastName: 'Portal',
      birthdate: new Date('1990-01-01'),
      emailVerified: true,
      profileCompleted: true,
    });

    // Set mock users
    mockAdminUser = {
      _id: adminUser._id,
      id: adminUser._id,
      role: 'admin',
      email: 'admin@test.com',
      firstName: 'Admin',
      lastName: 'User',
    };
    mockPortalUser = null; // Default: use admin for admin routes
  });

  // =========================================================================
  // POST /api/camps — Create camp
  // =========================================================================

  describe('POST /api/camps — Create camp', () => {
    it('should create a camp with valid data', async () => {
      const payload = buildCampData();

      const response = await request(app)
        .post('/api/camps')
        .send(payload)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.camp).toBeDefined();
      expect(response.body.camp.title).toBe('Sommer Tennis Camp');
      expect(response.body.camp.status).toBe('draft');
      expect(response.body.camp.createdBy).toBeDefined();
    });

    it('should reject camp without required fields (title)', async () => {
      const payload = buildCampData({ title: undefined });
      delete payload.title;

      const response = await request(app)
        .post('/api/camps')
        .send(payload)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });

    it('should reject camp without schedule', async () => {
      const payload = buildCampData({ schedule: [] });

      const response = await request(app)
        .post('/api/camps')
        .send(payload)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should reject camp without dates', async () => {
      const payload = buildCampData();
      delete payload.startDate;

      const response = await request(app)
        .post('/api/camps')
        .send(payload)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should reject camp with maxParticipants < 1', async () => {
      const payload = buildCampData({ maxParticipants: 0 });

      const response = await request(app)
        .post('/api/camps')
        .send(payload)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should require admin/supermod role (trainer gets 403)', async () => {
      // Use trainer role: bypasses requireAuth (in test mode) but fails
      // requireAdminOrSupermod (only admin/supermod allowed on camp admin routes).
      mockAdminUser = {
        _id: new mongoose.Types.ObjectId(),
        id: new mongoose.Types.ObjectId(),
        role: 'trainer',
        email: 'trainer@test.com',
      };

      const response = await request(app)
        .post('/api/camps')
        .send(buildCampData())
        .expect(403);

      expect(response.body.error).toBeDefined();
    });
  });

  // =========================================================================
  // GET /api/camps — List camps
  // =========================================================================

  describe('GET /api/camps — List camps', () => {
    beforeEach(async () => {
      // Create camps with different statuses
      await createCamp(adminUser._id, { status: 'draft' });
      await createCamp(adminUser._id, { status: 'open' });
      await createCamp(adminUser._id, { status: 'closed' });
    });

    it('should list all non-deleted camps', async () => {
      const response = await request(app)
        .get('/api/camps')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.camps).toHaveLength(3);
      expect(response.body.count).toBe(3);
    });

    it('should filter camps by status', async () => {
      const response = await request(app)
        .get('/api/camps?status=draft')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.camps).toHaveLength(1);
      expect(response.body.camps[0].status).toBe('draft');
    });

    it('should filter open camps by status=open', async () => {
      const response = await request(app)
        .get('/api/camps?status=open')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.camps).toHaveLength(1);
      expect(response.body.camps[0].status).toBe('open');
    });

    it('should not include soft-deleted camps', async () => {
      // Soft-delete the open camp
      const openCamp = await Camp.findOne({ status: 'open' });
      openCamp.deletedAt = new Date();
      await openCamp.save();

      const response = await request(app)
        .get('/api/camps')
        .expect(200);

      expect(response.body.camps).toHaveLength(2); // Only draft + closed
    });
  });

  // =========================================================================
  // PUT /api/camps/:id — Update camp
  // =========================================================================

  describe('PUT /api/camps/:id — Update camp', () => {
    let camp;

    beforeEach(async () => {
      camp = await createCamp(adminUser._id);
    });

    it('should update allowed fields', async () => {
      const response = await request(app)
        .put(`/api/camps/${camp._id}`)
        .send({ title: 'Updated Camp Title', maxParticipants: 20 })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.camp.title).toBe('Updated Camp Title');
      expect(response.body.camp.maxParticipants).toBe(20);
    });

    it('should return 404 for non-existent camp', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .put(`/api/camps/${fakeId}`)
        .send({ title: 'Updated' })
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('should not update status via PUT (status field not in allowedFields)', async () => {
      // Status changes go through /open and /close endpoints
      const response = await request(app)
        .put(`/api/camps/${camp._id}`)
        .send({ status: 'open' })
        .expect(200); // Returns 200 but ignores status field

      // Status should remain draft (status is not in allowedFields)
      const updatedCamp = await Camp.findById(camp._id);
      expect(updatedCamp.status).toBe('draft');
    });
  });

  // =========================================================================
  // POST /api/camps/:id/open — Open camp (draft → open)
  // =========================================================================

  describe('POST /api/camps/:id/open — Open camp', () => {
    it('should open a draft camp', async () => {
      const camp = await createCamp(adminUser._id, { status: 'draft' });

      const response = await request(app)
        .post(`/api/camps/${camp._id}/open`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.camp.status).toBe('open');
    });

    it('should reject opening an already-open camp', async () => {
      const camp = await createCamp(adminUser._id, { status: 'open' });

      const response = await request(app)
        .post(`/api/camps/${camp._id}/open`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/entwurf|geschlossen/i);
    });

    it('should reject opening a camp whose registrationOpenDate is in the future', async () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
      const startDate = new Date(futureDate.getTime() + 60 * 24 * 60 * 60 * 1000);
      const endDate = new Date(startDate.getTime() + 2 * 24 * 60 * 60 * 1000);
      const regClose = new Date(startDate.getTime() - 7 * 24 * 60 * 60 * 1000);

      const camp = await Camp.create({
        title: 'Future Camp',
        description: 'Opens in the future',
        schedule: [{ day: 'Montag', startTime: '10:00', endTime: '13:00' }],
        startDate,
        endDate,
        registrationOpenDate: futureDate,
        registrationCloseDate: regClose,
        maxParticipants: 10,
        status: 'draft',
        createdBy: adminUser._id,
      });

      const response = await request(app)
        .post(`/api/camps/${camp._id}/open`)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should return 404 for non-existent camp', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .post(`/api/camps/${fakeId}/open`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  // =========================================================================
  // POST /api/camps/:id/close — Close camp (open → closed)
  // =========================================================================

  describe('POST /api/camps/:id/close — Close camp', () => {
    it('should close an open camp', async () => {
      const camp = await createCamp(adminUser._id, { status: 'open' });

      const response = await request(app)
        .post(`/api/camps/${camp._id}/close`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.camp.status).toBe('closed');
    });

    it('should close a full camp', async () => {
      const camp = await createCamp(adminUser._id, { status: 'full' });

      const response = await request(app)
        .post(`/api/camps/${camp._id}/close`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.camp.status).toBe('closed');
    });

    it('should reject closing an already-closed camp', async () => {
      const camp = await createCamp(adminUser._id, { status: 'closed' });

      const response = await request(app)
        .post(`/api/camps/${camp._id}/close`)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should reject closing a draft camp', async () => {
      const camp = await createCamp(adminUser._id, { status: 'draft' });

      const response = await request(app)
        .post(`/api/camps/${camp._id}/close`)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  // =========================================================================
  // POST /api/camps/:id/open (REOPEN) — Reopen closed camp
  // =========================================================================

  describe('POST /api/camps/:id/open — REOPEN closed camp', () => {
    it('should reopen a closed camp (closed → open)', async () => {
      const camp = await createCamp(adminUser._id, { status: 'closed' });

      const response = await request(app)
        .post(`/api/camps/${camp._id}/open`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.camp.status).toBe('open');
    });

    it('should allow open → close → reopen cycle', async () => {
      const camp = await createCamp(adminUser._id, { status: 'draft' });

      // Open
      await request(app).post(`/api/camps/${camp._id}/open`).expect(200);

      // Close
      await request(app).post(`/api/camps/${camp._id}/close`).expect(200);

      // Reopen
      const reopenResponse = await request(app)
        .post(`/api/camps/${camp._id}/open`)
        .expect(200);

      expect(reopenResponse.body.camp.status).toBe('open');
    });
  });

  // =========================================================================
  // DELETE /api/camps/:id — Soft delete camp
  // =========================================================================

  describe('DELETE /api/camps/:id — Soft delete camp', () => {
    it('should soft-delete a camp without active registrations', async () => {
      const camp = await createCamp(adminUser._id);

      const response = await request(app)
        .delete(`/api/camps/${camp._id}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Camp should still exist but with deletedAt set
      const deletedCamp = await Camp.findById(camp._id);
      expect(deletedCamp).not.toBeNull();
      expect(deletedCamp.deletedAt).not.toBeNull();
    });

    it('should reject deleting a camp with active registrations', async () => {
      const camp = await createCamp(adminUser._id, { status: 'open' });

      // Create a pending registration
      await CampRegistration.create({
        campId: camp._id,
        studentPortalUserId: portalUser._id,
        firstName: 'Test',
        lastName: 'User',
        birthdate: new Date('2000-01-01'),
        email: 'test@test.com',
        skillLevel: 'beginner',
        team: false,
        status: 'pending',
      });

      const response = await request(app)
        .delete(`/api/camps/${camp._id}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/aktive anmeldungen/i);
    });

    it('should return 404 for non-existent camp', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .delete(`/api/camps/${fakeId}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('should allow deleting camp that only has cancelled registrations', async () => {
      const camp = await createCamp(adminUser._id, { status: 'open' });

      // Create a cancelled registration (cancelled/rejected do NOT block deletion)
      await CampRegistration.create({
        campId: camp._id,
        studentPortalUserId: portalUser._id,
        firstName: 'Test',
        lastName: 'User',
        birthdate: new Date('2000-01-01'),
        email: 'test@test.com',
        skillLevel: 'beginner',
        team: false,
        status: 'cancelled',
      });

      const response = await request(app)
        .delete(`/api/camps/${camp._id}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  // =========================================================================
  // GET /api/camps/:id/registrations — List registrations
  // =========================================================================

  describe('GET /api/camps/:id/registrations — List registrations', () => {
    let camp;

    beforeEach(async () => {
      camp = await createCamp(adminUser._id, { status: 'open' });

      // Create registrations with different statuses
      await CampRegistration.create([
        {
          campId: camp._id,
          studentPortalUserId: portalUser._id,
          firstName: 'Pending',
          lastName: 'User',
          birthdate: new Date('2000-01-01'),
          email: 'pending@test.com',
          skillLevel: 'beginner',
          team: false,
          status: 'pending',
        },
        {
          campId: camp._id,
          studentPortalUserId: new mongoose.Types.ObjectId(),
          familyMemberId: new mongoose.Types.ObjectId(), // Different user to avoid unique index conflict
          firstName: 'Confirmed',
          lastName: 'User',
          birthdate: new Date('2001-01-01'),
          email: 'confirmed@test.com',
          skillLevel: 'intermediate',
          team: true,
          status: 'confirmed',
        },
      ]);
    });

    it('should list all active registrations grouped by status', async () => {
      const response = await request(app)
        .get(`/api/camps/${camp._id}/registrations`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.registrations.pending).toHaveLength(1);
      expect(response.body.registrations.confirmed).toHaveLength(1);
      expect(response.body.registrations.waitlist).toHaveLength(0);
      expect(response.body.registrations.total).toBe(2);
    });

    it('should return 404 for non-existent camp', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .get(`/api/camps/${fakeId}/registrations`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('should include camp info in response', async () => {
      const response = await request(app)
        .get(`/api/camps/${camp._id}/registrations`)
        .expect(200);

      expect(response.body.camp).toBeDefined();
      expect(response.body.camp._id).toBe(camp._id.toString());
      expect(response.body.camp.title).toBe('Sommer Tennis Camp');
    });
  });

  // =========================================================================
  // PUT /api/camps/:id/registrations/:regId/status — Confirm/reject registration
  // =========================================================================

  describe('PUT /api/camps/:id/registrations/:regId/status — Confirm/reject', () => {
    let camp;
    let registration;

    beforeEach(async () => {
      camp = await createCamp(adminUser._id, {
        status: 'open',
        currentParticipants: 1,
      });

      registration = await CampRegistration.create({
        campId: camp._id,
        studentPortalUserId: portalUser._id,
        firstName: 'Test',
        lastName: 'User',
        birthdate: new Date('2000-01-01'),
        email: 'test@test.com',
        skillLevel: 'beginner',
        team: false,
        status: 'pending',
      });
    });

    it('should confirm a pending registration', async () => {
      const response = await request(app)
        .put(`/api/camps/${camp._id}/registrations/${registration._id}/status`)
        .send({ status: 'confirmed' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.registration.status).toBe('confirmed');

      // Verify in DB
      const confirmed = await CampRegistration.findById(registration._id);
      expect(confirmed.status).toBe('confirmed');
      expect(confirmed.approvedBy.toString()).toBe(adminUser._id.toString());
    });

    it('should reject a pending registration with optional reason', async () => {
      const response = await request(app)
        .put(`/api/camps/${camp._id}/registrations/${registration._id}/status`)
        .send({ status: 'rejected', rejectionReason: 'Camp ist ausgebucht' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.registration.status).toBe('rejected');
      expect(response.body.registration.rejectionReason).toBe('Camp ist ausgebucht');
    });

    it('should reject invalid status value', async () => {
      const response = await request(app)
        .put(`/api/camps/${camp._id}/registrations/${registration._id}/status`)
        .send({ status: 'invalid_status' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should not allow processing an already-confirmed registration', async () => {
      // First confirm it
      await CampRegistration.findByIdAndUpdate(registration._id, { status: 'confirmed' });

      const response = await request(app)
        .put(`/api/camps/${camp._id}/registrations/${registration._id}/status`)
        .send({ status: 'confirmed' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/ausstehend/i);
    });

    it('should return 404 for non-existent registration', async () => {
      const fakeRegId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .put(`/api/camps/${camp._id}/registrations/${fakeRegId}/status`)
        .send({ status: 'confirmed' })
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('should auto-promote first waitlist participant when registration is rejected', async () => {
      // Add a waitlist registration
      const waitlistReg = await CampRegistration.create({
        campId: camp._id,
        studentPortalUserId: new mongoose.Types.ObjectId(),
        familyMemberId: new mongoose.Types.ObjectId(),
        firstName: 'Waitlist',
        lastName: 'User',
        birthdate: new Date('2000-01-01'),
        email: 'waitlist@test.com',
        skillLevel: 'beginner',
        team: false,
        status: 'waitlist',
        registeredAt: new Date(Date.now() - 60000), // 1 minute ago (oldest)
      });

      await request(app)
        .put(`/api/camps/${camp._id}/registrations/${registration._id}/status`)
        .send({ status: 'rejected' })
        .expect(200);

      // Waitlist should be promoted to pending
      const promoted = await CampRegistration.findById(waitlistReg._id);
      expect(promoted.status).toBe('pending');
    });
  });

  // =========================================================================
  // POST /api/portal/camps/:id/register — Portal: Register for camp
  // =========================================================================

  describe('POST /api/portal/camps/:id/register — Portal registration', () => {
    let camp;

    beforeEach(async () => {
      // Switch to portal user auth
      mockAdminUser = null;
      mockPortalUser = {
        id: portalUser._id,
        role: 'student',
        email: 'student@test.com',
      };

      camp = await createCamp(adminUser._id, { status: 'open' });
    });

    it('should register for camp WITHOUT IBAN (IBAN is optional)', async () => {
      const payload = buildRegistrationPayload(); // No iban field

      const response = await request(app)
        .post(`/api/portal/camps/${camp._id}/register`)
        .send(payload)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.registration).toBeDefined();
      expect(response.body.registration.status).toBe('pending');
    });

    it('should register for camp WITH valid IBAN — IBAN saved to profile', async () => {
      const payload = buildRegistrationPayload({ iban: 'DE89 3704 0044 0532 0130 00' });

      const response = await request(app)
        .post(`/api/portal/camps/${camp._id}/register`)
        .send(payload)
        .expect(201);

      expect(response.body.success).toBe(true);

      // IBAN should be saved encrypted to portal user profile
      const updatedUser = await StudentPortalUser.findById(portalUser._id);
      expect(updatedUser.iban).not.toBeNull();
      expect(updatedUser.iban).toContain(':'); // AES-256-CBC format: "iv:encrypted"
    });

    it('should reject registration with invalid IBAN format', async () => {
      const payload = buildRegistrationPayload({ iban: 'INVALID_IBAN_XYZ' });

      const response = await request(app)
        .post(`/api/portal/camps/${camp._id}/register`)
        .send(payload)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/iban/i);
    });

    it('should reject registration without required participant fields', async () => {
      const response = await request(app)
        .post(`/api/portal/camps/${camp._id}/register`)
        .send({ skillLevel: 'beginner', team: false }) // Missing firstName etc.
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should reject registration without skillLevel', async () => {
      const payload = buildRegistrationPayload({ skillLevel: undefined });
      delete payload.skillLevel;

      const response = await request(app)
        .post(`/api/portal/camps/${camp._id}/register`)
        .send(payload)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should reject registration for a closed camp', async () => {
      const closedCamp = await createCamp(adminUser._id, { status: 'closed' });

      const response = await request(app)
        .post(`/api/portal/camps/${closedCamp._id}/register`)
        .send(buildRegistrationPayload())
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/nicht geöffnet/i);
    });

    it('should reject registration for a draft camp', async () => {
      const draftCamp = await createCamp(adminUser._id, { status: 'draft' });

      const response = await request(app)
        .post(`/api/portal/camps/${draftCamp._id}/register`)
        .send(buildRegistrationPayload())
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should prevent duplicate registration for same camp', async () => {
      // First registration
      await request(app)
        .post(`/api/portal/camps/${camp._id}/register`)
        .send(buildRegistrationPayload())
        .expect(201);

      // Second attempt
      const response = await request(app)
        .post(`/api/portal/camps/${camp._id}/register`)
        .send(buildRegistrationPayload())
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/bereits/i);
    });

    it('should place registration on waitlist when camp is full and waitlist enabled', async () => {
      // Create a camp with 1 max participant + waitlist enabled
      const tinyOpenCamp = await createCamp(adminUser._id, {
        status: 'open',
        maxParticipants: 1,
        currentParticipants: 1, // Already at capacity
        waitlistEnabled: true,
      });

      const response = await request(app)
        .post(`/api/portal/camps/${tinyOpenCamp._id}/register`)
        .send(buildRegistrationPayload())
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.registration.status).toBe('waitlist');
    });

    it('should reject registration when camp is full and waitlist disabled', async () => {
      const fullCamp = await createCamp(adminUser._id, {
        status: 'open',
        maxParticipants: 1,
        currentParticipants: 1,
        waitlistEnabled: false,
      });

      const response = await request(app)
        .post(`/api/portal/camps/${fullCamp._id}/register`)
        .send(buildRegistrationPayload())
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/ausgebucht/i);
    });

    it('should return 404 for non-existent camp', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .post(`/api/portal/camps/${fakeId}/register`)
        .send(buildRegistrationPayload())
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  // =========================================================================
  // DELETE /api/portal/camps/registrations/:regId — Cancel registration
  // =========================================================================

  describe('DELETE /api/portal/camps/registrations/:regId — Cancel registration', () => {
    let camp;
    let registration;

    beforeEach(async () => {
      // Switch to portal user auth
      mockAdminUser = null;
      mockPortalUser = {
        id: portalUser._id,
        role: 'student',
        email: 'student@test.com',
      };

      // Camp starts far in the future (> 7 days) so cancellation is allowed
      camp = await createCamp(adminUser._id, {
        status: 'open',
        currentParticipants: 1,
      });

      registration = await CampRegistration.create({
        campId: camp._id,
        studentPortalUserId: portalUser._id,
        firstName: 'Test',
        lastName: 'User',
        birthdate: new Date('2000-01-01'),
        email: 'test@test.com',
        skillLevel: 'beginner',
        team: false,
        status: 'pending',
      });
    });

    it('should cancel a pending registration', async () => {
      const response = await request(app)
        .delete(`/api/portal/camps/registrations/${registration._id}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Registration should be marked cancelled, not deleted
      const cancelled = await CampRegistration.findById(registration._id);
      expect(cancelled.status).toBe('cancelled');
    });

    it('should reject cancellation of another user registration (403)', async () => {
      // Create a different portal user's registration
      const otherUser = await StudentPortalUser.create({
        email: 'other@test.com',
        password: 'password123',
        firstName: 'Other',
        lastName: 'User',
        birthdate: new Date('1990-01-01'),
        emailVerified: true,
      });

      const otherReg = await CampRegistration.create({
        campId: camp._id,
        studentPortalUserId: otherUser._id,
        familyMemberId: new mongoose.Types.ObjectId(),
        firstName: 'Other',
        lastName: 'User',
        birthdate: new Date('2000-01-01'),
        email: 'other@test.com',
        skillLevel: 'beginner',
        team: false,
        status: 'pending',
      });

      // mockPortalUser is still portalUser (not otherUser)
      const response = await request(app)
        .delete(`/api/portal/camps/registrations/${otherReg._id}`)
        .expect(403);

      expect(response.body.success).toBe(false);
    });

    it('should reject cancellation of already-cancelled registration', async () => {
      await CampRegistration.findByIdAndUpdate(registration._id, { status: 'cancelled' });

      const response = await request(app)
        .delete(`/api/portal/camps/registrations/${registration._id}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/bereits storniert/i);
    });

    it('should return 404 for non-existent registration', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .delete(`/api/portal/camps/registrations/${fakeId}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('should auto-promote first waitlist participant after cancellation', async () => {
      // Add a waitlist registration from a different user
      const waitlistReg = await CampRegistration.create({
        campId: camp._id,
        studentPortalUserId: new mongoose.Types.ObjectId(),
        familyMemberId: new mongoose.Types.ObjectId(),
        firstName: 'Waitlist',
        lastName: 'Person',
        birthdate: new Date('2000-01-01'),
        email: 'waitlist@test.com',
        skillLevel: 'beginner',
        team: false,
        status: 'waitlist',
        registeredAt: new Date(Date.now() - 60000),
      });

      await request(app)
        .delete(`/api/portal/camps/registrations/${registration._id}`)
        .expect(200);

      // Waitlist should be promoted to pending
      const promoted = await CampRegistration.findById(waitlistReg._id);
      expect(promoted.status).toBe('pending');
    });

    it('should reject cancellation of confirmed registration within 7 days of camp start', async () => {
      // Create a camp starting in 3 days (< 7 day cancellation window)
      const now = new Date();
      const soonRegOpen = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const soonRegClose = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // yesterday
      const soonStart = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);   // 3 days from now
      const soonEnd = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);

      const soonCamp = await Camp.create({
        title: 'Soon Camp',
        description: 'Camp starting very soon',
        schedule: [{ day: 'Montag', startTime: '10:00', endTime: '13:00' }],
        startDate: soonStart,
        endDate: soonEnd,
        registrationOpenDate: soonRegOpen,
        registrationCloseDate: soonRegClose,
        maxParticipants: 10,
        currentParticipants: 1,
        status: 'closed', // Closed since reg close date is in the past
        createdBy: adminUser._id,
      });

      const confirmedReg = await CampRegistration.create({
        campId: soonCamp._id,
        studentPortalUserId: portalUser._id,
        firstName: 'Test',
        lastName: 'User',
        birthdate: new Date('2000-01-01'),
        email: 'test@test.com',
        skillLevel: 'beginner',
        team: false,
        status: 'confirmed', // Confirmed — 7-day rule applies
      });

      const response = await request(app)
        .delete(`/api/portal/camps/registrations/${confirmedReg._id}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/7 tage/i);
    });
  });
});
