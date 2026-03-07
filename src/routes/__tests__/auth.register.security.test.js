/**
 * Security Test: POST /api/auth/register — Privilege Escalation via Unauthenticated Registration
 *
 * This test proves (or disproves) finding C1 from docs/todo/GO_LIVE_BLOCKERS_AND_PRE_DEPLOY_CHECKLIST_2026-03-07.md
 *
 * The route is mounted in server.js WITHOUT any auth guard:
 *   app.use("/api/auth", authRoutes);   // no requireAuth, no requireRole
 *
 * The register handler takes `role` directly from req.body:
 *   role: role || "student"
 *
 * The passport local strategy does NOT check isEmailVerified.
 *
 * EXPECTED (secure) behavior: 401 — must be logged in as admin to register users
 * FIXED 2026-03-07: requireAuth + requireRole(["admin"]) added to the route in auth.js
 */

import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import cookieParser from 'cookie-parser';
import passport, { configurePassport } from '../../config/passport.js';
import authRoutes from '../auth.js';

// ---------------------------------------------------------------------------
// App setup — mirrors exactly what server.js does for /api/auth:
//   configurePassport()
//   app.use(passport.initialize())
//   app.use("/api/auth", authRoutes)   ← NO requireAuth, NO requireRole
// ---------------------------------------------------------------------------
configurePassport();

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(passport.initialize());
app.use('/api/auth', authRoutes);   // <-- mounted exactly as in server.js

// ---------------------------------------------------------------------------
// DB lifecycle
// ---------------------------------------------------------------------------
let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
}, 30000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ATTACKER_CREDENTIALS = {
  email: 'attacker@evil-example.com',
  password: 'Attack3r!',
  firstName: 'Evil',
  lastName: 'Attacker',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('C1 Security: Unauthenticated registration endpoint', () => {

  // ─── Part 1: Can the endpoint be reached without a token? ─────────────────

  describe('Unauthenticated POST /api/auth/register is now blocked (FIXED)', () => {

    test('no token → 401', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        // No cookie, no token — completely unauthenticated
        .send({ ...ATTACKER_CREDENTIALS, role: 'admin' });

      expect(res.status).toBe(401);
      expect(res.body.user).toBeUndefined();
    });

    test('"supermod" role cannot be created without auth', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ ...ATTACKER_CREDENTIALS, email: 'attacker2@evil-example.com', role: 'supermod' });

      expect(res.status).toBe(401);
    });

    test('"trainer" role cannot be created without auth', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ ...ATTACKER_CREDENTIALS, email: 'attacker3@evil-example.com', role: 'trainer' });

      expect(res.status).toBe(401);
    });

  });

  // ─── Part 3: Sanity checks — things that DO work correctly ────────────────

  describe('Sanity: auth guard fires before any validation', () => {

    // After the fix, auth runs first — so even malformed requests get 401, not 400.
    // This is correct: the server doesn't even look at the body for unauthenticated callers.

    test('weak password + no token → 401 (auth before validation)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ ...ATTACKER_CREDENTIALS, password: 'weak', role: 'admin' });

      expect(res.status).toBe(401);
    });

    test('missing fields + no token → 401 (auth before validation)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'x@example.com', password: 'Abc123!x' });

      expect(res.status).toBe(401);
    });

  });

  // ─── Part 4: What the fix should look like ────────────────────────────────
  // After fixing C1 (add requireAuth + requireRole(["admin"]) in server.js),
  // the following test should pass instead of the ones above.
  // Currently this test is SKIPPED. Un-skip it after applying the fix.

  describe('Non-admin authenticated user cannot register accounts either', () => {

    test('student portal token (wrong audience) → 401', async () => {
      // A logged-in student cannot create admin accounts
      const res = await request(app)
        .post('/api/auth/register')
        .set('Cookie', ['portalAccessToken=fake-student-token'])
        .send({ ...ATTACKER_CREDENTIALS, role: 'admin' });

      expect(res.status).toBe(401);
    });

  });

});
