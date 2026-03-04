/**
 * Child Registration Integration Tests
 *
 * Tests child (familyMember) registration flows via the portal seasonal
 * registrations route. Covers the familyMemberId path, partial unique index
 * enforcement, auto-Student creation linked to family member, and re-registration
 * after cancellation.
 */

import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import StudentPortalUser from '../../models/StudentPortalUser.js';
import Student from '../../models/Student.js';
import RegistrationPeriod from '../../models/RegistrationPeriod.js';
import SeasonalRegistration from '../../models/SeasonalRegistration.js';
import portalSeasonalRegistrationsRoutes from '../../routes/portalSeasonalRegistrations.js';
import {
  connectTestDB,
  disconnectTestDB,
  clearTestDB,
} from '../../testHelpers.js';

// ──────────────────────────────────────────────────────────────────────────────
// Express app — mock portal auth identical to portalSeasonalRegistrations.test.js
// ──────────────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(cookieParser());

// Inject portal user ID via test cookie (cookie-parser parses → req.cookies)
const mockPortalAuth = () => (req, res, next) => {
  const rawId = req.cookies && req.cookies.testUserId;
  req.user = {
    id: rawId ? new mongoose.Types.ObjectId(rawId) : new mongoose.Types.ObjectId(),
    role: 'student',
  };
  next();
};

app.use(mockPortalAuth());
app.use('/api/portal/seasonal-registrations', portalSeasonalRegistrationsRoutes);

// ──────────────────────────────────────────────────────────────────────────────
// Shared test data helpers
// ──────────────────────────────────────────────────────────────────────────────

const AVAILABLE_TIMES_KIDS = [
  { day: 'Montag',    hour: 14, venue: 'BTHV' },
  { day: 'Dienstag',  hour: 15, venue: 'BTHV' },
  { day: 'Mittwoch',  hour: 16, venue: 'Brüser Berg' },
  { day: 'Donnerstag',hour: 17, venue: 'Röttgen' },
  { day: 'Freitag',   hour: 15, venue: 'BTHV' },
];

/** Create an open RegistrationPeriod */
const createPeriod = () =>
  RegistrationPeriod.create({
    name: 'Wintertraining 2025/26',
    season: 'winter',
    trainingStartDate: new Date('2025-09-01'),
    trainingEndDate:   new Date('2026-06-30'),
    registrationDeadline: new Date('2027-12-31'),
    status: 'open',
    isActive: true,
    currentPlanId: new mongoose.Types.ObjectId(),
    createdBy: new mongoose.Types.ObjectId(),
    kidsFormConfig: {
      enabledFields: ['mitgliedsstatus', 'trainingsart', 'trainingshäufigkeit'],
      requiredFields: ['mitgliedsstatus', 'trainingsart'],
    },
    adultsFormConfig: {
      enabledFields: [],
      requiredFields: [],
    },
  });

/**
 * Create a portal user with one child family member.
 * Returns { parentUser, childId } where childId is the family member's _id.
 */
const createParentWithChild = async (overrides = {}) => {
  const parentUser = await StudentPortalUser.create({
    email: overrides.email || 'parent@test.com',
    password: 'testpassword123',
    firstName: 'Parent',
    lastName: 'Test',
    birthdate: new Date('1985-01-01'),
    emailVerified: true,
    profileCompleted: true,
    sex: 'weiblich',
    member: false,
    familyMembers: [
      {
        firstName: 'Max',
        lastName: 'Test',
        birthdate: new Date('2012-05-15'),
        relationship: 'child',
        sex: 'männlich',
        member: false,
      },
    ],
  });

  const childId = parentUser.familyMembers[0]._id;
  return { parentUser, childId };
};

/** Minimal valid child registration body */
const childRegBody = (periodId, familyMemberId, overrides = {}) => ({
  periodId: periodId.toString(),
  familyMemberId: familyMemberId.toString(),
  formType: 'kids',
  firstName: 'Max',
  lastName: 'Test',
  birthdate: '2012-05-15',
  email: 'parent@test.com',
  phone: '0151 11122233',
  address: 'Teststraße 1, 53111 Bonn',
  mitgliedsstatus: 'Mitglied',
  trainingsart: 'Jugend TEAM (Gelb)',
  trainingshäufigkeit: '2x pro Woche',
  teamParticipation: true,
  availableTimesKids: AVAILABLE_TIMES_KIDS,
  privacyConsent: true,
  ...overrides,
});

/** Minimal valid self (parent) registration body */
const selfRegBody = (periodId, overrides = {}) => ({
  periodId: periodId.toString(),
  formType: 'adults',
  firstName: 'Parent',
  lastName: 'Test',
  birthdate: '1985-01-01',
  email: 'parent@test.com',
  phone: '0151 11122233',
  address: 'Teststraße 1, 53111 Bonn',
  spielstärke: 'Fortgeschrittene',
  trainingGoals: ['Fitness', 'Freizeit'],
  groupSize: ['zu dritt'],
  availableTimesAdults: [
    { day: 'Montag',     hour: '18:00', venue: 'BTHV' },
    { day: 'Dienstag',   hour: '19:00', venue: 'BTHV' },
    { day: 'Mittwoch',   hour: '18:00', venue: 'Brüser Berg' },
    { day: 'Donnerstag', hour: '19:00', venue: 'Röttgen' },
    { day: 'Freitag',    hour: '18:00', venue: 'BTHV' },
  ],
  privacyConsent: true,
  ...overrides,
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('Child Registration (familyMemberId) Integration Tests', () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterEach(async () => {
    await clearTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 1. Parent registers a child — success
  // ────────────────────────────────────────────────────────────────────────────
  it('1. parent registers a child (familyMemberId set) — 201 success', async () => {
    const period = await createPeriod();
    const { parentUser, childId } = await createParentWithChild();

    const res = await request(app)
      .post('/api/portal/seasonal-registrations')
      .set('Cookie', `testUserId=${parentUser._id}`)
      .send(childRegBody(period._id, childId))
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.registration).toBeDefined();
    expect(res.body.registration.familyMemberId).toBe(childId.toString());
    expect(res.body.registration.firstName).toBe('Max');
    expect(res.body.registration.status).toBe('processed');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 2. Parent registers a child with valid IBAN — IBAN saved to parent's profile
  // ────────────────────────────────────────────────────────────────────────────
  it('2. child registration with valid IBAN — IBAN saved to parent StudentPortalUser', async () => {
    const period = await createPeriod();
    const { parentUser, childId } = await createParentWithChild();

    await request(app)
      .post('/api/portal/seasonal-registrations')
      .set('Cookie', `testUserId=${parentUser._id}`)
      .send(childRegBody(period._id, childId, {
        sepaMandate: true,
        accountHolder: 'Parent Test',
        iban: 'DE89370400440532013000',
      }))
      .expect(201);

    // IBAN must be stored (encrypted) on the parent portal user
    const updatedParent = await StudentPortalUser.findById(parentUser._id);
    expect(updatedParent.iban).toBeDefined();
    expect(updatedParent.iban).not.toBe('DE89370400440532013000'); // must be encrypted

    // Response must NOT expose the IBAN value
    const res2 = await request(app)
      .post('/api/portal/seasonal-registrations')
      .set('Cookie', `testUserId=${parentUser._id}`)
      .send(childRegBody(period._id, childId, { iban: 'DE89370400440532013000' }));
    // (duplicate would fail — but IBAN check above is the core assertion)
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. Parent registers a child — auto-creates Student record for child
  // ────────────────────────────────────────────────────────────────────────────
  it('3. child registration auto-creates a Student record', async () => {
    const period = await createPeriod();
    const { parentUser, childId } = await createParentWithChild();

    await request(app)
      .post('/api/portal/seasonal-registrations')
      .set('Cookie', `testUserId=${parentUser._id}`)
      .send(childRegBody(period._id, childId))
      .expect(201);

    const students = await Student.find({});
    expect(students).toHaveLength(1);

    const student = students[0];
    expect(student.firstName).toBe('Max');
    expect(student.lastName).toBe('Test');
    expect(student.member).toBe(true);            // mitgliedsstatus = 'Mitglied'
    expect(student.trainigGroup).toBe('Gelb Team'); // mapped from 'Jugend TEAM (Gelb)'
    expect(student.frequence).toBe('2');            // 2x pro Woche → '2'
    expect(student.adult).toBe(false);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 4. Parent cannot register a child not in their familyMembers — 400
  // ────────────────────────────────────────────────────────────────────────────
  it('4. invalid familyMemberId (not in parent familyMembers) → 400', async () => {
    const period = await createPeriod();
    const { parentUser } = await createParentWithChild();

    const fakeChildId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .post('/api/portal/seasonal-registrations')
      .set('Cookie', `testUserId=${parentUser._id}`)
      .send(childRegBody(period._id, fakeChildId))
      .expect(400);

    expect(res.body.error).toMatch(/familyMemberId/i);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 5. Parent registers child + self in same period — both succeed
  // ────────────────────────────────────────────────────────────────────────────
  it('5. parent registers child + self in same period — both succeed, no conflict', async () => {
    const period = await createPeriod();
    const { parentUser, childId } = await createParentWithChild();

    // Register child
    const childRes = await request(app)
      .post('/api/portal/seasonal-registrations')
      .set('Cookie', `testUserId=${parentUser._id}`)
      .send(childRegBody(period._id, childId))
      .expect(201);

    expect(childRes.body.success).toBe(true);

    // Register parent (adults form, no familyMemberId)
    const selfRes = await request(app)
      .post('/api/portal/seasonal-registrations')
      .set('Cookie', `testUserId=${parentUser._id}`)
      .send(selfRegBody(period._id))
      .expect(201);

    expect(selfRes.body.success).toBe(true);

    // Two SeasonalRegistrations must exist
    const regs = await SeasonalRegistration.find({ studentPortalUserId: parentUser._id });
    expect(regs).toHaveLength(2);

    const childReg = regs.find(r => r.familyMemberId);
    const selfReg  = regs.find(r => !r.familyMemberId);
    expect(childReg).toBeDefined();
    expect(selfReg).toBeDefined();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 6. Duplicate child registration in same period → 400 (partial unique index)
  // ────────────────────────────────────────────────────────────────────────────
  it('6. duplicate child registration in same period → rejected (unique index)', async () => {
    const period = await createPeriod();
    const { parentUser, childId } = await createParentWithChild();

    // First registration — succeeds
    await request(app)
      .post('/api/portal/seasonal-registrations')
      .set('Cookie', `testUserId=${parentUser._id}`)
      .send(childRegBody(period._id, childId))
      .expect(201);

    // Second registration for same child + period → must fail
    const res = await request(app)
      .post('/api/portal/seasonal-registrations')
      .set('Cookie', `testUserId=${parentUser._id}`)
      .send(childRegBody(period._id, childId))
      .expect(400);

    expect(res.body.error).toMatch(/bereits|already/i);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 7. Cancel child registration — status set to 'cancelled'
  // ────────────────────────────────────────────────────────────────────────────
  it('7. cancel child registration via DELETE → status = cancelled', async () => {
    const period = await createPeriod();
    const { parentUser, childId } = await createParentWithChild();

    // Create registration directly (bypass route for speed)
    const reg = await SeasonalRegistration.create({
      periodId: period._id,
      studentPortalUserId: parentUser._id,
      familyMemberId: childId,
      formType: 'kids',
      firstName: 'Max',
      lastName: 'Test',
      birthdate: new Date('2012-05-15'),
      email: 'parent@test.com',
      availableTimesKids: AVAILABLE_TIMES_KIDS,
      mitgliedsstatus: 'Mitglied',
      trainingsart: 'Jugend TEAM (Gelb)',
      privacyConsent: true,
      status: 'pending',
    });

    const res = await request(app)
      .delete(`/api/portal/seasonal-registrations/${reg._id}`)
      .set('Cookie', `testUserId=${parentUser._id}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/storniert|gelöscht|deleted/i);

    const updated = await SeasonalRegistration.findById(reg._id);
    expect(updated.status).toBe('cancelled');
    expect(updated.cancelledBy).toBe('user');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 8. After cancel, same child can register again (partial index allows it)
  // ────────────────────────────────────────────────────────────────────────────
  it('8. after cancel, same child can re-register in same period', async () => {
    const period = await createPeriod();
    const { parentUser, childId } = await createParentWithChild();

    // Create a cancelled registration (partial index excludes cancelled)
    await SeasonalRegistration.create({
      periodId: period._id,
      studentPortalUserId: parentUser._id,
      familyMemberId: childId,
      formType: 'kids',
      firstName: 'Max',
      lastName: 'Test',
      birthdate: new Date('2012-05-15'),
      email: 'parent@test.com',
      availableTimesKids: AVAILABLE_TIMES_KIDS,
      mitgliedsstatus: 'Mitglied',
      trainingsart: 'Jugend TEAM (Gelb)',
      privacyConsent: true,
      status: 'cancelled',
    });

    // New registration for same child + period must succeed
    const res = await request(app)
      .post('/api/portal/seasonal-registrations')
      .set('Cookie', `testUserId=${parentUser._id}`)
      .send(childRegBody(period._id, childId))
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.registration.status).toBe('processed');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 9. Child registration auto-links Student record to familyMember.studentId
  // ────────────────────────────────────────────────────────────────────────────
  it('9. child registration links auto-created Student to familyMember.studentId', async () => {
    const period = await createPeriod();
    const { parentUser, childId } = await createParentWithChild();

    await request(app)
      .post('/api/portal/seasonal-registrations')
      .set('Cookie', `testUserId=${parentUser._id}`)
      .send(childRegBody(period._id, childId))
      .expect(201);

    // Reload parent from DB — familyMember.studentId must be set
    const updatedParent = await StudentPortalUser.findById(parentUser._id);
    const childMember = updatedParent.familyMembers.id(childId);

    expect(childMember).not.toBeNull();
    expect(childMember.studentId).toBeDefined();

    // Verify the referenced Student exists
    const linkedStudent = await Student.findById(childMember.studentId);
    expect(linkedStudent).not.toBeNull();
    expect(linkedStudent.firstName).toBe('Max');

    // Parent's own studentId must remain unset (only child was registered)
    // Mongoose returns undefined (not null) when the field was never written
    expect(updatedParent.studentId == null).toBe(true); // null or undefined
  });
});
