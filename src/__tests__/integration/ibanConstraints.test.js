/**
 * Integration Tests for IBAN Constraints
 *
 * Verifies IBAN handling across three surfaces:
 * 1. Seasonal registrations (portal) — kids + adults
 * 2. Camp registrations (portal)
 * 3. Profile update (portal)
 *
 * Key backend behaviors:
 * - IBAN is NEVER required by the backend for seasonal or camp registrations
 * - Seasonal reg: IBAN only validated when sepaMandate + accountHolder + iban all present
 * - Camp reg: IBAN validated whenever provided (even without sepaMandate)
 * - Profile update: IBAN validated whenever provided
 * - Invalid IBAN → 400
 * - Valid IBAN → encrypted and saved to StudentPortalUser.iban profile
 */

import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import RegistrationPeriod from '../../models/RegistrationPeriod.js';
import Camp from '../../models/Camp.js';
import CampRegistration from '../../models/CampRegistration.js';
import StudentPortalUser from '../../models/StudentPortalUser.js';
import User from '../../models/User.js';
import portalSeasonalRegistrationsRoutes from '../../routes/portalSeasonalRegistrations.js';
import portalCampsRoutes from '../../routes/portalCamps.js';
import portalScheduleRoutes from '../../routes/portalSchedule.js';
import {
  connectTestDB,
  disconnectTestDB,
  clearTestDB,
} from '../../testHelpers.js';

// ---------------------------------------------------------------------------
// App setup — single app mounting all portal routes under test
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use(cookieParser());

// Dynamic mock portal auth — reads testUserId cookie (same pattern as
// existing portalSeasonalRegistrations.test.js) or falls back to mockPortalUser.
let mockPortalUser = null;
app.use((req, res, next) => {
  const rawId = req.cookies && req.cookies.testUserId;
  if (rawId) {
    req.user = {
      id: new mongoose.Types.ObjectId(rawId),
      role: 'student',
    };
  } else if (mockPortalUser) {
    req.user = mockPortalUser;
  }
  next();
});

app.use('/api/portal/seasonal-registrations', portalSeasonalRegistrationsRoutes);
app.use('/api/portal/camps', portalCampsRoutes);
app.use('/api/portal', portalScheduleRoutes);

// ---------------------------------------------------------------------------
// Shared test data helpers
// ---------------------------------------------------------------------------

const VALID_IBAN = 'DE89370400440532013000';
const VALID_IBAN_WITH_SPACES = 'DE89 3704 0044 0532 0130 00';
const INVALID_IBAN = 'INVALID_IBAN_XYZ';
const INVALID_IBAN_SHORT = 'DE123'; // Too short

/**
 * Create an active registration period
 */
async function createActivePeriod(adminId) {
  return RegistrationPeriod.create({
    name: 'Wintertraining 2025/26',
    season: 'winter',
    trainingStartDate: new Date('2025-09-01'),
    trainingEndDate: new Date('2026-06-30'),
    registrationDeadline: new Date('2027-12-31'),
    status: 'open',
    currentPlanId: new mongoose.Types.ObjectId(),
    isActive: true,
    createdBy: adminId,
    kidsFormConfig: {
      enabledFields: ['mitgliedsstatus', 'trainingsart', 'trainingshäufigkeit'],
      requiredFields: ['mitgliedsstatus', 'trainingsart'],
    },
    adultsFormConfig: {
      enabledFields: ['spielstärke'],
      requiredFields: ['spielstärke'],
    },
  });
}

/**
 * Build the minimum valid kids registration payload.
 */
function buildKidsPayload(periodId, overrides = {}) {
  return {
    periodId: periodId.toString(),
    formType: 'kids',
    firstName: 'Max',
    lastName: 'Mustermann',
    birthdate: '2010-05-15',
    email: 'max@test.com',
    mitgliedsstatus: 'Mitglied',
    trainingsart: 'Jugend TEAM (Gelb)',
    trainingshäufigkeit: '2x pro Woche',
    availableTimesKids: [
      { day: 'Montag', hour: 14, venue: 'BTHV' },
      { day: 'Dienstag', hour: 15, venue: 'BTHV' },
      { day: 'Mittwoch', hour: 16, venue: 'Brüser Berg' },
    ],
    privacyConsent: true,
    ...overrides,
  };
}

/**
 * Build the minimum valid adults registration payload.
 */
function buildAdultsPayload(periodId, overrides = {}) {
  return {
    periodId: periodId.toString(),
    formType: 'adults',
    firstName: 'Sandra',
    lastName: 'Test',
    birthdate: '1980-03-20',
    email: 'sandra@test.com',
    spielstärke: 'Fortgeschrittene',
    availableTimesAdults: [
      { day: 'Montag', hour: '18:00', venue: 'BTHV' },
      { day: 'Dienstag', hour: '19:00', venue: 'BTHV' },
      { day: 'Mittwoch', hour: '18:00', venue: 'Brüser Berg' },
    ],
    privacyConsent: true,
    ...overrides,
  };
}

/**
 * Create an open camp that is within the registration window.
 */
async function createOpenCamp(adminId, overrides = {}) {
  const now = new Date();
  const regOpen = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const regClose = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const start = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + 16 * 24 * 60 * 60 * 1000);

  return Camp.create({
    title: 'Sommer Tennis Camp',
    description: 'Tolles Camp',
    campType: 'beginner-course',
    schedule: [{ day: 'Montag', startTime: '10:00', endTime: '13:00' }],
    startDate: start,
    endDate: end,
    registrationOpenDate: regOpen,
    registrationCloseDate: regClose,
    maxParticipants: 20,
    status: 'open',
    createdBy: adminId,
    ...overrides,
  });
}

/**
 * Build camp registration payload.
 */
function buildCampRegistrationPayload(overrides = {}) {
  return {
    firstName: 'Maria',
    lastName: 'Mustermann',
    birthdate: '1990-06-15',
    email: 'maria@test.com',
    skillLevel: 'beginner',
    team: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IBAN Constraints — Backend Validation Across All Surfaces', () => {
  let adminUser;
  let portalUser;
  let adminUserId;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    adminUser = await User.create({
      email: 'admin@test.com',
      password: 'password123',
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin',
      isActive: true,
    });
    adminUserId = adminUser._id;

    portalUser = await StudentPortalUser.create({
      email: 'portal@test.com',
      password: 'testpassword123',
      firstName: 'Test',
      lastName: 'User',
      birthdate: new Date('1990-01-01'),
      emailVerified: true,
      profileCompleted: true,
      sex: 'männlich',
      member: false,
    });

    mockPortalUser = {
      id: portalUser._id,
      role: 'student',
      email: 'portal@test.com',
    };
  });

  // =========================================================================
  // Section 1: Seasonal Registrations — Kids
  // =========================================================================

  describe('Seasonal Registration (kids) — IBAN constraints', () => {
    let period;

    beforeEach(async () => {
      period = await createActivePeriod(adminUserId);
    });

    it('kids reg without IBAN — accepted (IBAN is optional)', async () => {
      const payload = buildKidsPayload(period._id);
      // No iban field

      const response = await request(app)
        .post('/api/portal/seasonal-registrations')
        .send(payload)
        .set('Cookie', `testUserId=${portalUser._id}`)
        .expect(201);

      expect(response.body.registration).toBeDefined();
      expect(response.body.registration.formType).toBe('kids');

      // Profile IBAN should remain unset
      const updatedUser = await StudentPortalUser.findById(portalUser._id);
      expect(updatedUser.iban).toBeFalsy();
    });

    it('kids reg WITH valid IBAN + sepaMandate + accountHolder — accepted and IBAN saved to profile', async () => {
      const payload = buildKidsPayload(period._id, {
        sepaMandate: true,
        accountHolder: 'Max Mustermann',
        iban: VALID_IBAN,
      });

      const response = await request(app)
        .post('/api/portal/seasonal-registrations')
        .send(payload)
        .set('Cookie', `testUserId=${portalUser._id}`)
        .expect(201);

      expect(response.body.registration).toBeDefined();

      // IBAN removed from response for security
      expect(response.body.registration.iban).toBeUndefined();

      // IBAN encrypted and saved to portal user profile
      const updatedUser = await StudentPortalUser.findById(portalUser._id);
      expect(updatedUser.iban).not.toBeFalsy();
      expect(updatedUser.iban).toContain(':'); // AES-256-CBC format: "iv:encrypted"
    });

    it('kids reg WITH invalid IBAN + sepaMandate + accountHolder — rejected with 400', async () => {
      const payload = buildKidsPayload(period._id, {
        sepaMandate: true,
        accountHolder: 'Max Mustermann',
        iban: INVALID_IBAN,
      });

      const response = await request(app)
        .post('/api/portal/seasonal-registrations')
        .send(payload)
        .set('Cookie', `testUserId=${portalUser._id}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/iban/i);
    });

    it('kids reg WITH valid IBAN but NO sepaMandate — IBAN still saved to profile (backend saves valid IBANs independently)', async () => {
      // Behavior: sepaMandate check only gates the registration-level IBAN storage,
      // but the second check (line 517) saves valid IBANs to profile independently.
      const payload = buildKidsPayload(period._id, {
        iban: VALID_IBAN, // No sepaMandate, no accountHolder
      });

      const response = await request(app)
        .post('/api/portal/seasonal-registrations')
        .send(payload)
        .set('Cookie', `testUserId=${portalUser._id}`)
        .expect(201);

      expect(response.body.registration).toBeDefined();

      // IBAN should be saved to profile since it's valid
      const updatedUser = await StudentPortalUser.findById(portalUser._id);
      expect(updatedUser.iban).not.toBeFalsy();
    });
  });

  // =========================================================================
  // Section 2: Seasonal Registrations — Adults
  // =========================================================================

  describe('Seasonal Registration (adults) — IBAN constraints', () => {
    let period;

    beforeEach(async () => {
      period = await createActivePeriod(adminUserId);
    });

    it('adults reg without IBAN — accepted (IBAN is optional)', async () => {
      const payload = buildAdultsPayload(period._id);
      // No iban field

      const response = await request(app)
        .post('/api/portal/seasonal-registrations')
        .send(payload)
        .set('Cookie', `testUserId=${portalUser._id}`)
        .expect(201);

      expect(response.body.registration).toBeDefined();
      expect(response.body.registration.formType).toBe('adults');
    });

    it('adults reg WITH valid IBAN + sepaMandate + accountHolder — accepted', async () => {
      const payload = buildAdultsPayload(period._id, {
        sepaMandate: true,
        accountHolder: 'Sandra Test',
        iban: VALID_IBAN,
      });

      const response = await request(app)
        .post('/api/portal/seasonal-registrations')
        .send(payload)
        .set('Cookie', `testUserId=${portalUser._id}`)
        .expect(201);

      expect(response.body.registration).toBeDefined();

      // IBAN removed from response
      expect(response.body.registration.iban).toBeUndefined();
    });

    it('adults reg WITH IBAN with spaces (formatted) + sepaMandate — accepted (spaces stripped)', async () => {
      const payload = buildAdultsPayload(period._id, {
        sepaMandate: true,
        accountHolder: 'Sandra Test',
        iban: VALID_IBAN_WITH_SPACES, // Contains spaces
      });

      const response = await request(app)
        .post('/api/portal/seasonal-registrations')
        .send(payload)
        .set('Cookie', `testUserId=${portalUser._id}`)
        .expect(201);

      expect(response.body.registration).toBeDefined();
    });

    it('adults reg WITH invalid IBAN + sepaMandate — rejected with 400', async () => {
      const payload = buildAdultsPayload(period._id, {
        sepaMandate: true,
        accountHolder: 'Sandra Test',
        iban: INVALID_IBAN,
      });

      const response = await request(app)
        .post('/api/portal/seasonal-registrations')
        .send(payload)
        .set('Cookie', `testUserId=${portalUser._id}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/iban/i);
    });

    it('adults reg WITH too-short invalid IBAN + sepaMandate — rejected with 400', async () => {
      const payload = buildAdultsPayload(period._id, {
        sepaMandate: true,
        accountHolder: 'Sandra Test',
        iban: INVALID_IBAN_SHORT,
      });

      const response = await request(app)
        .post('/api/portal/seasonal-registrations')
        .send(payload)
        .set('Cookie', `testUserId=${portalUser._id}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/iban/i);
    });
  });

  // =========================================================================
  // Section 3: Camp Registrations — IBAN constraints
  // =========================================================================

  describe('Camp Registration — IBAN constraints', () => {
    let camp;

    beforeEach(async () => {
      camp = await createOpenCamp(adminUserId);
    });

    it('camp reg WITHOUT IBAN — accepted (IBAN is optional)', async () => {
      const payload = buildCampRegistrationPayload();
      // No iban field

      const response = await request(app)
        .post(`/api/portal/camps/${camp._id}/register`)
        .send(payload)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.registration.status).toBe('pending');

      // Profile IBAN unchanged
      const updatedUser = await StudentPortalUser.findById(portalUser._id);
      expect(updatedUser.iban).toBeFalsy();
    });

    it('camp reg WITH valid IBAN — accepted and IBAN encrypted + saved to profile', async () => {
      const payload = buildCampRegistrationPayload({ iban: VALID_IBAN });

      const response = await request(app)
        .post(`/api/portal/camps/${camp._id}/register`)
        .send(payload)
        .expect(201);

      expect(response.body.success).toBe(true);

      // IBAN should be encrypted and saved to user profile
      const updatedUser = await StudentPortalUser.findById(portalUser._id);
      expect(updatedUser.iban).not.toBeFalsy();
      expect(updatedUser.iban).toContain(':'); // AES-256-CBC format
    });

    it('camp reg WITH valid IBAN with spaces — accepted (spaces stripped)', async () => {
      const payload = buildCampRegistrationPayload({ iban: VALID_IBAN_WITH_SPACES });

      const response = await request(app)
        .post(`/api/portal/camps/${camp._id}/register`)
        .send(payload)
        .expect(201);

      expect(response.body.success).toBe(true);
    });

    it('camp reg WITH invalid IBAN format — rejected with 400', async () => {
      const payload = buildCampRegistrationPayload({ iban: INVALID_IBAN });

      const response = await request(app)
        .post(`/api/portal/camps/${camp._id}/register`)
        .send(payload)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/iban/i);
    });

    it('camp reg WITH too-short invalid IBAN — rejected with 400', async () => {
      const payload = buildCampRegistrationPayload({ iban: INVALID_IBAN_SHORT });

      const response = await request(app)
        .post(`/api/portal/camps/${camp._id}/register`)
        .send(payload)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('camp reg WITH empty string IBAN — treated as no IBAN (accepted)', async () => {
      const payload = buildCampRegistrationPayload({ iban: '' });

      const response = await request(app)
        .post(`/api/portal/camps/${camp._id}/register`)
        .send(payload)
        .expect(201);

      expect(response.body.success).toBe(true);
    });

    it('camp reg WITH whitespace-only IBAN — treated as no IBAN (accepted)', async () => {
      const payload = buildCampRegistrationPayload({ iban: '   ' });

      const response = await request(app)
        .post(`/api/portal/camps/${camp._id}/register`)
        .send(payload)
        .expect(201);

      expect(response.body.success).toBe(true);
    });
  });

  // =========================================================================
  // Section 4: Profile Update — IBAN constraints
  // =========================================================================

  describe('Profile Update (PUT /api/portal/profile) — IBAN constraints', () => {
    /**
     * Required fields for a successful profile update.
     */
    const requiredProfileFields = {
      firstName: 'Test',
      lastName: 'User',
      birthDate: '1990-01-01',
      sex: 'männlich',
    };

    it('profile update WITH valid IBAN — accepted and IBAN encrypted + saved', async () => {
      const response = await request(app)
        .put('/api/portal/profile')
        .send({ ...requiredProfileFields, iban: VALID_IBAN })
        .expect(200);

      // PUT /api/portal/profile returns the profile object directly (no success wrapper).
      // Response shape: { _id, firstName, lastName, birthDate, sex, ... ibanLast3, ... }
      expect(response.body._id).toBeDefined();
      expect(response.body.firstName).toBe('Test');
      // ibanLast3 returned (last 3 chars of the plain IBAN for display)
      expect(response.body.ibanLast3).toBe('000'); // Last 3 of DE89370400440532013000

      // IBAN saved encrypted to portal user profile
      const updatedUser = await StudentPortalUser.findById(portalUser._id);
      expect(updatedUser.iban).not.toBeFalsy();
      expect(updatedUser.iban).toContain(':'); // AES-256-CBC format: "iv:encrypted"
    });

    it('profile update WITH valid IBAN with spaces — accepted (spaces stripped)', async () => {
      const response = await request(app)
        .put('/api/portal/profile')
        .send({ ...requiredProfileFields, iban: VALID_IBAN_WITH_SPACES })
        .expect(200);

      // Response is the profile object
      expect(response.body._id).toBeDefined();
      expect(response.body.ibanLast3).toBe('000');
    });

    it('profile update WITH invalid IBAN — rejected with 400', async () => {
      const response = await request(app)
        .put('/api/portal/profile')
        .send({ ...requiredProfileFields, iban: INVALID_IBAN })
        .expect(400);

      expect(response.body.error).toMatch(/iban/i);
    });

    it('profile update WITH too-short invalid IBAN — rejected with 400', async () => {
      const response = await request(app)
        .put('/api/portal/profile')
        .send({ ...requiredProfileFields, iban: INVALID_IBAN_SHORT })
        .expect(400);

      expect(response.body.error).toMatch(/iban/i);
    });

    it('profile update WITHOUT IBAN — accepted (IBAN is optional)', async () => {
      const response = await request(app)
        .put('/api/portal/profile')
        .send(requiredProfileFields)
        .expect(200);

      // Response is profile object with profile fields
      expect(response.body._id).toBeDefined();
      expect(response.body.firstName).toBe('Test');
      // No IBAN set → ibanLast3 is null
      expect(response.body.ibanLast3).toBeNull();
    });

    it('profile update WITH empty string IBAN — treated as no IBAN (accepted)', async () => {
      const response = await request(app)
        .put('/api/portal/profile')
        .send({ ...requiredProfileFields, iban: '' })
        .expect(200);

      expect(response.body._id).toBeDefined();
    });

    it('IBAN is NOT returned in profile response (security)', async () => {
      const response = await request(app)
        .put('/api/portal/profile')
        .send(requiredProfileFields)
        .expect(200);

      // Full encrypted IBAN must NOT be in response
      expect(response.body.iban).toBeUndefined();

      // ibanLast3 (last 3 digits) IS acceptable and returned for display
      // This is the intentional design: show last 3 chars, not full IBAN
    });
  });
});
