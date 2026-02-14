/**
 * Integration Tests: Student Assignment Routes
 *
 * Tests the Phase 1+2 fix routes in backend/src/routes/students.js:
 *
 *   A. POST   /:id/assignments          — Add assignment
 *   B. DELETE /:id/assignments          — Remove specific assignment
 *   C. PUT    /:id/assignments/replace  — Atomic replace (Phase 1 fix)
 *   D. DELETE /:id                      — Cascade delete (Phase 1 fix)
 *   E. PUT    /:id                      — No accidental assignment clearing (Phase 1 fix)
 *
 * Infrastructure: MongoMemoryServer + Supertest (all in devDependencies)
 * ESM: Uses import syntax (package.json "type": "module")
 */

import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Student from '../../models/Student.js';
import StudentPortalUser from '../../models/StudentPortalUser.js';
import SeasonalRegistration from '../../models/SeasonalRegistration.js';
import studentRoutes from '../students.js';
import {
  clearTestDB,
  createTestStudent,
  mockAuth,
} from '../../testHelpers.js';

// ---------------------------------------------------------------------------
// App setup (mirrors pattern from students.test.js)
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(mockAuth());
app.use('/api/students', studentRoutes);

// ---------------------------------------------------------------------------
// Lifecycle
// Use MongoMemoryReplSet (single-node replica set) so that Mongoose
// multi-document transactions (used in PUT /:id/assignments/replace) work.
// ---------------------------------------------------------------------------
let replSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  await mongoose.connect(uri);
}, 30000);

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (replSet) {
    await replSet.stop();
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * availableTimes object format required by current Student schema.
 * createTestStudent from testHelpers uses the legacy string format ('Montag 14'),
 * which no longer matches the schema — override it here.
 */
const VALID_AVAILABLE_TIMES = [
  { day: 'Montag', hour: 14, venue: '' },
  { day: 'Mittwoch', hour: 14, venue: '' },
];

/** Create and persist a student with one assignment pre-seeded */
const seedStudentWithAssignment = async (assignment = { day: 'Montag', hour: 14, coach: null }) => {
  return Student.create(
    createTestStudent({
      availableTimes: VALID_AVAILABLE_TIMES,
      assignments: [assignment],
    })
  );
};

/** Create a minimal StudentPortalUser linked to the given studentId */
const seedPortalUser = async (studentId, overrides = {}) => {
  return StudentPortalUser.create({
    email: `portaluser_${Date.now()}@test.com`,
    password: 'TestPassword1!',
    firstName: 'Portal',
    lastName: 'User',
    birthdate: new Date('2005-06-15'),
    studentId,
    ...overrides,
  });
};

/** Create a minimal SeasonalRegistration linked to the given studentId.
 *  periodId and studentPortalUserId are required — we create throw-away ObjectIds. */
const seedSeasonalRegistration = async (studentId) => {
  return SeasonalRegistration.create({
    periodId: new mongoose.Types.ObjectId(),
    studentPortalUserId: new mongoose.Types.ObjectId(),
    studentId,
    formType: 'kids',
    firstName: 'Test',
    lastName: 'Student',
    birthdate: new Date('2015-01-01'),
    email: 'reg@test.com',
    privacyConsent: true,
    status: 'processed',
  });
};

// ===========================================================================
// A. POST /api/students/:id/assignments — Add assignment
// ===========================================================================
describe('A. POST /api/students/:id/assignments', () => {
  test('A1: successfully adds an assignment to a student', async () => {
    const student = await Student.create(createTestStudent({ availableTimes: VALID_AVAILABLE_TIMES, assignments: [] }));

    const res = await request(app)
      .post(`/api/students/${student._id}/assignments`)
      .send({ day: 'Dienstag', hour: 15, coach: null });

    expect(res.status).toBe(200);
    expect(res.body.assignments).toHaveLength(1);
    expect(res.body.assignments[0].day).toBe('Dienstag');
    expect(res.body.assignments[0].hour).toBe(15);

    // Verify persisted in DB
    const fromDb = await Student.findById(student._id).lean();
    expect(fromDb.assignments).toHaveLength(1);
    expect(fromDb.assignments[0].day).toBe('Dienstag');
  });

  test('A2: appends to existing assignments without overwriting them', async () => {
    const student = await seedStudentWithAssignment({ day: 'Montag', hour: 14, coach: null });

    const res = await request(app)
      .post(`/api/students/${student._id}/assignments`)
      .send({ day: 'Mittwoch', hour: 16, coach: null });

    expect(res.status).toBe(200);
    expect(res.body.assignments).toHaveLength(2);
    const days = res.body.assignments.map((a) => a.day);
    expect(days).toContain('Montag');
    expect(days).toContain('Mittwoch');
  });

  test('A3: returns 400 when day is missing', async () => {
    const student = await Student.create(createTestStudent({ availableTimes: VALID_AVAILABLE_TIMES, assignments: [] }));

    const res = await request(app)
      .post(`/api/students/${student._id}/assignments`)
      .send({ hour: 14 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Tag|Stunde/i);
  });

  test('A4: returns 400 when hour is missing', async () => {
    const student = await Student.create(createTestStudent({ availableTimes: VALID_AVAILABLE_TIMES, assignments: [] }));

    const res = await request(app)
      .post(`/api/students/${student._id}/assignments`)
      .send({ day: 'Montag' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Tag|Stunde/i);
  });

  test('A5: hour is coerced to Number — string "14" is stored as number 14', async () => {
    const student = await Student.create(createTestStudent({ availableTimes: VALID_AVAILABLE_TIMES, assignments: [] }));

    const res = await request(app)
      .post(`/api/students/${student._id}/assignments`)
      .send({ day: 'Freitag', hour: '14' }); // string input

    expect(res.status).toBe(200);
    expect(typeof res.body.assignments[0].hour).toBe('number');
    expect(res.body.assignments[0].hour).toBe(14);
  });

  test('A6: returns 404 when student does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .post(`/api/students/${fakeId}/assignments`)
      .send({ day: 'Montag', hour: 14 });

    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// B. DELETE /api/students/:id/assignments — Remove specific assignment
// ===========================================================================
describe('B. DELETE /api/students/:id/assignments', () => {
  test('B1: removes the matching assignment from a student', async () => {
    const student = await seedStudentWithAssignment({ day: 'Montag', hour: 14, coach: null });

    const res = await request(app)
      .delete(`/api/students/${student._id}/assignments`)
      .send({ day: 'Montag', hour: 14 });

    expect(res.status).toBe(200);
    expect(res.body.assignments).toHaveLength(0);
  });

  test('B2: returns updated student with assignment removed, others intact', async () => {
    const student = await Student.create(
      createTestStudent({
        availableTimes: VALID_AVAILABLE_TIMES,
        assignments: [
          { day: 'Montag', hour: 14, coach: null },
          { day: 'Mittwoch', hour: 16, coach: null },
        ],
      })
    );

    const res = await request(app)
      .delete(`/api/students/${student._id}/assignments`)
      .send({ day: 'Montag', hour: 14 });

    expect(res.status).toBe(200);
    expect(res.body.assignments).toHaveLength(1);
    expect(res.body.assignments[0].day).toBe('Mittwoch');
    expect(res.body.assignments[0].hour).toBe(16);
  });

  test('B3: hour coercion — string "14" removes assignment stored as number 14', async () => {
    // Seed with numeric hour (as stored in DB)
    const student = await seedStudentWithAssignment({ day: 'Montag', hour: 14, coach: null });

    // Send hour as string (as might come from frontend form data)
    const res = await request(app)
      .delete(`/api/students/${student._id}/assignments`)
      .send({ day: 'Montag', hour: '14' }); // string

    expect(res.status).toBe(200);
    expect(res.body.assignments).toHaveLength(0);

    // Verify removal persisted in DB
    const fromDb = await Student.findById(student._id).lean();
    expect(fromDb.assignments).toHaveLength(0);
  });

  test('B4: does nothing (no error) if assignment does not match — returns student unchanged', async () => {
    const student = await seedStudentWithAssignment({ day: 'Montag', hour: 14, coach: null });

    const res = await request(app)
      .delete(`/api/students/${student._id}/assignments`)
      .send({ day: 'Freitag', hour: 18 }); // non-existent slot

    expect(res.status).toBe(200);
    // Assignment still present — $pull on no-match is a no-op
    expect(res.body.assignments).toHaveLength(1);
  });

  test('B5: returns 400 when day is missing', async () => {
    const student = await seedStudentWithAssignment();

    const res = await request(app)
      .delete(`/api/students/${student._id}/assignments`)
      .send({ hour: 14 });

    expect(res.status).toBe(400);
  });

  test('B6: returns 400 when hour is missing', async () => {
    const student = await seedStudentWithAssignment();

    const res = await request(app)
      .delete(`/api/students/${student._id}/assignments`)
      .send({ day: 'Montag' });

    expect(res.status).toBe(400);
  });

  test('B7: returns 404 when student does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .delete(`/api/students/${fakeId}/assignments`)
      .send({ day: 'Montag', hour: 14 });

    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// C. PUT /api/students/:id/assignments/replace — Atomic replace
// ===========================================================================
describe('C. PUT /api/students/:id/assignments/replace', () => {
  test('C1: replaces specific assignment (fromDay/fromHour → day/hour)', async () => {
    const student = await seedStudentWithAssignment({ day: 'Montag', hour: 14, coach: null });

    const res = await request(app)
      .put(`/api/students/${student._id}/assignments/replace`)
      .send({ fromDay: 'Montag', fromHour: 14, day: 'Dienstag', hour: 15 });

    expect(res.status).toBe(200);
    expect(res.body.assignments).toHaveLength(1);
    expect(res.body.assignments[0].day).toBe('Dienstag');
    expect(res.body.assignments[0].hour).toBe(15);
  });

  test('C2: old assignment removed, new assignment present in result', async () => {
    const student = await Student.create(
      createTestStudent({
        availableTimes: VALID_AVAILABLE_TIMES,
        assignments: [
          { day: 'Montag', hour: 14, coach: null },
          { day: 'Freitag', hour: 18, coach: null },
        ],
      })
    );

    const res = await request(app)
      .put(`/api/students/${student._id}/assignments/replace`)
      .send({ fromDay: 'Montag', fromHour: 14, day: 'Mittwoch', hour: 16 });

    expect(res.status).toBe(200);
    expect(res.body.assignments).toHaveLength(2);
    const days = res.body.assignments.map((a) => a.day);
    expect(days).not.toContain('Montag');   // old removed
    expect(days).toContain('Mittwoch');     // new present
    expect(days).toContain('Freitag');      // untouched sibling preserved
  });

  test('C3: clears all assignments when day=null, hour=null', async () => {
    const student = await Student.create(
      createTestStudent({
        availableTimes: VALID_AVAILABLE_TIMES,
        assignments: [
          { day: 'Montag', hour: 14, coach: null },
          { day: 'Mittwoch', hour: 16, coach: null },
        ],
      })
    );

    const res = await request(app)
      .put(`/api/students/${student._id}/assignments/replace`)
      .send({ day: null, hour: null });

    expect(res.status).toBe(200);
    expect(res.body.assignments).toHaveLength(0);

    const fromDb = await Student.findById(student._id).lean();
    expect(fromDb.assignments).toHaveLength(0);
  });

  test('C4: atomicity — if fromDay/fromHour match, splice+push occurs as unit', async () => {
    // We verify the net result: original gone, new present
    // (True multi-step failure simulation requires mocking mongoose internals;
    //  this test verifies the replace is complete and consistent.)
    const student = await seedStudentWithAssignment({ day: 'Montag', hour: 14, coach: null });

    const res = await request(app)
      .put(`/api/students/${student._id}/assignments/replace`)
      .send({ fromDay: 'Montag', fromHour: 14, day: 'Donnerstag', hour: 17 });

    expect(res.status).toBe(200);
    const fromDb = await Student.findById(student._id).lean();
    // Exactly one assignment: the new one
    expect(fromDb.assignments).toHaveLength(1);
    expect(fromDb.assignments[0].day).toBe('Donnerstag');
    expect(fromDb.assignments[0].hour).toBe(17);
    // No trace of the old assignment
    const oldFound = fromDb.assignments.find(
      (a) => a.day === 'Montag' && a.hour === 14
    );
    expect(oldFound).toBeUndefined();
  });

  test('C5: hour values coerced to Number in stored result', async () => {
    const student = await seedStudentWithAssignment({ day: 'Montag', hour: 14, coach: null });

    const res = await request(app)
      .put(`/api/students/${student._id}/assignments/replace`)
      .send({ fromDay: 'Montag', fromHour: '14', day: 'Dienstag', hour: '15' }); // strings

    expect(res.status).toBe(200);
    // Retrieve from DB to check stored type
    const fromDb = await Student.findById(student._id).lean();
    expect(typeof fromDb.assignments[0].hour).toBe('number');
    expect(fromDb.assignments[0].hour).toBe(15);
  });

  test('C6: returns 400 when day is provided but hour is missing', async () => {
    const student = await seedStudentWithAssignment();

    const res = await request(app)
      .put(`/api/students/${student._id}/assignments/replace`)
      .send({ day: 'Montag' });

    expect(res.status).toBe(400);
  });

  test('C7: returns 404 when student does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .put(`/api/students/${fakeId}/assignments/replace`)
      .send({ fromDay: 'Montag', fromHour: 14, day: 'Dienstag', hour: 15 });

    expect(res.status).toBe(404);
  });

  test('C8: legacy replace-all (no fromDay/fromHour) replaces assignments with single new one', async () => {
    const student = await Student.create(
      createTestStudent({
        availableTimes: VALID_AVAILABLE_TIMES,
        assignments: [
          { day: 'Montag', hour: 14, coach: null },
          { day: 'Freitag', hour: 18, coach: null },
        ],
      })
    );

    const res = await request(app)
      .put(`/api/students/${student._id}/assignments/replace`)
      .send({ day: 'Samstag', hour: 10 }); // no fromDay/fromHour

    expect(res.status).toBe(200);
    expect(res.body.assignments).toHaveLength(1);
    expect(res.body.assignments[0].day).toBe('Samstag');
    expect(res.body.assignments[0].hour).toBe(10);
  });
});

// ===========================================================================
// D. DELETE /api/students/:id — Cascade delete (Phase 1 fix)
// ===========================================================================
describe('D. DELETE /api/students/:id — Cascade delete', () => {
  test('D1: deletes the student record', async () => {
    const student = await Student.create(createTestStudent({ availableTimes: VALID_AVAILABLE_TIMES, assignments: [] }));

    const res = await request(app).delete(`/api/students/${student._id}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('deleted');

    const fromDb = await Student.findById(student._id);
    expect(fromDb).toBeNull();
  });

  test('D2: nullifies StudentPortalUser.studentId that referenced deleted student', async () => {
    const student = await Student.create(createTestStudent({ availableTimes: VALID_AVAILABLE_TIMES, assignments: [] }));
    const portalUser = await seedPortalUser(student._id);

    // Verify link before deletion
    expect(portalUser.studentId.toString()).toBe(student._id.toString());

    const res = await request(app).delete(`/api/students/${student._id}`);
    expect(res.status).toBe(200);
    expect(res.body.portalUsersUnlinked).toBe(1);

    // studentId should be unset on portal user
    const updatedPortalUser = await StudentPortalUser.findById(portalUser._id).lean();
    expect(updatedPortalUser.studentId).toBeUndefined();
  });

  test('D3: nullifies familyMembers[].studentId that referenced deleted student', async () => {
    const student = await Student.create(createTestStudent({ availableTimes: VALID_AVAILABLE_TIMES, assignments: [] }));

    // Portal user with a family member linked to this student
    const portalUser = await StudentPortalUser.create({
      email: `family_${Date.now()}@test.com`,
      password: 'TestPassword1!',
      firstName: 'Parent',
      lastName: 'User',
      birthdate: new Date('1985-03-10'),
      familyMembers: [
        {
          studentId: student._id,
          relationship: 'child',
          firstName: 'Child',
          lastName: 'User',
          birthdate: new Date('2015-05-20'),
        },
      ],
    });

    const res = await request(app).delete(`/api/students/${student._id}`);
    expect(res.status).toBe(200);
    expect(res.body.familyMembersUnlinked).toBe(1);

    const updatedPortalUser = await StudentPortalUser.findById(portalUser._id).lean();
    const member = updatedPortalUser.familyMembers[0];
    expect(member.studentId).toBeNull();
  });

  test('D4: resets linked SeasonalRegistration status to pending and unsets studentId', async () => {
    const student = await Student.create(createTestStudent({ availableTimes: VALID_AVAILABLE_TIMES, assignments: [] }));
    const reg = await seedSeasonalRegistration(student._id);

    // Verify initial state
    expect(reg.status).toBe('processed');
    expect(reg.studentId.toString()).toBe(student._id.toString());

    const res = await request(app).delete(`/api/students/${student._id}`);
    expect(res.status).toBe(200);
    expect(res.body.resetRegistrations).toBe(1);

    const updatedReg = await SeasonalRegistration.findById(reg._id).lean();
    expect(updatedReg.status).toBe('pending');
    expect(updatedReg.studentId).toBeUndefined();
  });

  test('D5: handles student with no portal users, no registrations — clean delete', async () => {
    const student = await Student.create(createTestStudent({ availableTimes: VALID_AVAILABLE_TIMES, assignments: [] }));

    const res = await request(app).delete(`/api/students/${student._id}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Student deleted');
    expect(res.body.resetRegistrations).toBe(0);
    expect(res.body.portalUsersUnlinked).toBe(0);
    expect(res.body.familyMembersUnlinked).toBe(0);
  });

  test('D6: returns 404 when student does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app).delete(`/api/students/${fakeId}`);
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// E. PUT /api/students/:id — No accidental assignment clearing (Phase 1 fix)
// ===========================================================================
describe('E. PUT /api/students/:id — Assignment preservation on update', () => {
  test('E1: updating firstName only does NOT clear existing assignments', async () => {
    const student = await seedStudentWithAssignment({ day: 'Montag', hour: 14, coach: null });

    const res = await request(app)
      .put(`/api/students/${student._id}`)
      .send({ firstName: 'UpdatedName' }); // no assignments field

    expect(res.status).toBe(200);
    expect(res.body.firstName).toBe('UpdatedName');

    // Assignments must be intact
    const fromDb = await Student.findById(student._id).lean();
    expect(fromDb.assignments).toHaveLength(1);
    expect(fromDb.assignments[0].day).toBe('Montag');
    expect(fromDb.assignments[0].hour).toBe(14);
  });

  test('E2: updating multiple profile fields without assignments field preserves all assignments', async () => {
    const student = await Student.create(
      createTestStudent({
        availableTimes: VALID_AVAILABLE_TIMES,
        assignments: [
          { day: 'Montag', hour: 14, coach: null },
          { day: 'Freitag', hour: 18, coach: null },
        ],
      })
    );

    const res = await request(app)
      .put(`/api/students/${student._id}`)
      .send({
        firstName: 'NewName',
        lastName: 'NewLast',
        phone: '999000111',
        // no assignments key
      });

    expect(res.status).toBe(200);

    const fromDb = await Student.findById(student._id).lean();
    expect(fromDb.assignments).toHaveLength(2);
  });

  test('E3: explicitly sending assignments:[] DOES clear assignments', async () => {
    const student = await seedStudentWithAssignment({ day: 'Montag', hour: 14, coach: null });

    const res = await request(app)
      .put(`/api/students/${student._id}`)
      .send({ firstName: 'ClearTest', assignments: [] });

    expect(res.status).toBe(200);

    const fromDb = await Student.findById(student._id).lean();
    expect(fromDb.assignments).toHaveLength(0);
  });

  test('E4: explicitly sending assignments with new values replaces assignments', async () => {
    const student = await seedStudentWithAssignment({ day: 'Montag', hour: 14, coach: null });

    const newAssignments = [
      { day: 'Donnerstag', hour: 17, coach: null },
    ];

    const res = await request(app)
      .put(`/api/students/${student._id}`)
      .send({ assignments: newAssignments });

    expect(res.status).toBe(200);

    const fromDb = await Student.findById(student._id).lean();
    expect(fromDb.assignments).toHaveLength(1);
    expect(fromDb.assignments[0].day).toBe('Donnerstag');
    expect(fromDb.assignments[0].hour).toBe(17);
  });

  test('E5: returns 404 when student does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .put(`/api/students/${fakeId}`)
      .send({ firstName: 'Nobody' });

    expect(res.status).toBe(404);
  });
});
