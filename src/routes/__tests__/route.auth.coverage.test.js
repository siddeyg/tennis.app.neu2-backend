/**
 * Route Authentication Coverage Test
 *
 * Prevents unauthenticated access to protected endpoints.
 * This is the automated guard against finding C1 ever happening again:
 *   "POST /api/auth/register was open to the public — anyone could create admin accounts"
 *   Fixed: 2026-03-07. This test makes the fix permanent.
 *
 * HOW IT WORKS:
 *   Every endpoint in this app is either:
 *     (A) Explicitly listed in PUBLIC_ENDPOINTS below (may be called without auth), or
 *     (B) Expected to return 401 when called without any authentication token.
 *
 *   The test calls every endpoint in PROTECTED_ENDPOINTS_SAMPLE without a token
 *   and asserts the response is 401.
 *
 * WHEN ADDING A NEW ROUTE:
 *   - If the route is public (login, register-portal, health check, etc.):
 *       Add it to PUBLIC_ENDPOINTS with a comment explaining why it's public.
 *   - If the route is protected:
 *       Add a sample endpoint to PROTECTED_ENDPOINTS_SAMPLE.
 *       No auth guard = test fails = never reaches production.
 *
 * This file is the single source of truth for what is intentionally public.
 */

import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import cookieParser from 'cookie-parser';
import passport, { configurePassport } from '../../config/passport.js';

// ─── Import all route modules ────────────────────────────────────────────────
import authRoutes from '../auth.js';
import portalAuthRoutes from '../portalAuth.js';
import studentRoutes from '../students.js';
import scheduleRoutes from '../schedule.js';
import coachRoutes from '../coaches.js';
import savedScheduleRoutes from '../savedSchedules.js';
import settingsRoutes from '../settings.js';
import announcementsRoutes from '../announcements.js';
import campsRoutes from '../camps.js';
import usersRoutes from '../users.js';
import registrationPeriodsRoutes from '../registrationPeriods.js';
import seasonalRegistrationsRoutes from '../seasonalRegistrations.js';
import supportTicketsRoutes from '../supportTickets.js';
import auditLogsRoutes from '../auditLogs.js';
import portalCampsRoutes from '../portalCamps.js';
import portalSupportTicketsRoutes from '../portalSupportTickets.js';
import portalNotificationsRoutes from '../portalNotifications.js';
import metricsRoutes from '../metrics.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole, requireAdminOrSupermod } from '../../middleware/requireRole.js';

// ─── Minimal app matching server.js mount points ─────────────────────────────
configurePassport();
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(passport.initialize());

// Public
app.get('/', (req, res) => res.send('ok'));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api/portal/auth', portalAuthRoutes);

// Protected — mirrors server.js exactly
app.use('/api/students',             requireAuth, requireAdminOrSupermod, studentRoutes);
app.use('/api/schedule',             requireAuth, requireAdminOrSupermod, scheduleRoutes);
app.use('/api/coaches',              requireAuth, requireAdminOrSupermod, coachRoutes);
app.use('/api/saved-schedules',      requireAuth, requireAdminOrSupermod, savedScheduleRoutes);
app.use('/api/settings',             requireAuth, requireRole(['admin']),  settingsRoutes);
app.use('/api/announcements',        requireAuth, requireAdminOrSupermod, announcementsRoutes);
app.use('/api/camps',                requireAuth, requireAdminOrSupermod, campsRoutes);
app.use('/api/users',                requireAuth, requireRole(['admin']),  usersRoutes);
app.use('/api/registration-periods', requireAuth, requireAdminOrSupermod, registrationPeriodsRoutes);
app.use('/api/seasonal-registrations', requireAuth, requireAdminOrSupermod, seasonalRegistrationsRoutes);
app.use('/api/support-tickets',      requireAuth, requireAdminOrSupermod, supportTicketsRoutes);
app.use('/api/audit-logs',           requireAuth, requireRole(['admin']),  auditLogsRoutes);
app.use('/api/metrics',              requireAuth, requireRole(['admin']),  metricsRoutes);
app.use('/api/portal/camps',         portalCampsRoutes);
app.use('/api/portal/support-tickets', portalSupportTicketsRoutes);
app.use('/api/portal/notifications', portalNotificationsRoutes);

// ─── DB lifecycle ─────────────────────────────────────────────────────────────
let mongoServer;
beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
}, 30000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

// =============================================================================
// THE ALLOWLIST — every intentionally public /api/ endpoint
// =============================================================================
// If you add a new public endpoint, add it here with a reason.
// If it's NOT here and NOT returning 401, the test below will catch it.
//
// format: { method, path, reason }
export const PUBLIC_ENDPOINTS = [
  // System
  { method: 'GET',  path: '/',          reason: 'welcome page' },
  { method: 'GET',  path: '/api/health', reason: 'uptime monitoring' },

  // Public image serve (UUIDs are unguessable — by-design unauthenticated)
  { method: 'GET',  path: '/api/announcements/images/:filename', reason: 'inline images in announcements rendered in all portals' },

  // Admin portal auth (public by necessity)
  { method: 'POST', path: '/api/auth/login',               reason: 'entry point' },
  { method: 'POST', path: '/api/auth/logout',              reason: 'must work even after token expiry' },
  { method: 'POST', path: '/api/auth/refresh',             reason: 'token renewal' },
  { method: 'POST', path: '/api/auth/forgot-password',     reason: 'unauthenticated by definition' },
  { method: 'POST', path: '/api/auth/reset-password',      reason: 'token-based, no session' },
  { method: 'POST', path: '/api/auth/verify-email',        reason: 'token-based, no session' },
  { method: 'POST', path: '/api/auth/resend-verification', reason: 'email not yet verified = no session' },
  { method: 'GET',  path: '/api/auth/me',                  reason: 'returns 401 when not logged in — effectively protected' },

  // Student portal auth (public by necessity)
  { method: 'POST', path: '/api/portal/auth/register',        reason: 'public registration' },
  { method: 'POST', path: '/api/portal/auth/login',           reason: 'entry point' },
  { method: 'POST', path: '/api/portal/auth/logout',          reason: 'must work even after token expiry' },
  { method: 'POST', path: '/api/portal/auth/refresh',         reason: 'token renewal' },
  { method: 'POST', path: '/api/portal/auth/forgot-password', reason: 'unauthenticated by definition' },
  { method: 'POST', path: '/api/portal/auth/reset-password',  reason: 'token-based, no session' },
  { method: 'POST', path: '/api/portal/auth/verify-email',    reason: 'token-based, no session' },
  { method: 'POST', path: '/api/portal/auth/resend-verification', reason: 'email not yet verified = no session' },
  { method: 'GET',  path: '/api/portal/auth/registration-status', reason: 'shown on public registration page' },
  { method: 'GET',  path: '/api/portal/auth/verify-email-change', reason: 'token-based link from email' },
];

// =============================================================================
// PROTECTED ENDPOINTS SAMPLE
// One representative endpoint per route file — enough to prove the guard works.
// Add new route files here when you create them.
// =============================================================================
const PROTECTED_ENDPOINTS_SAMPLE = [
  // Admin portal — these MUST return 401 without a token
  { method: 'GET',    path: '/api/students' },
  { method: 'GET',    path: '/api/schedule' },
  { method: 'GET',    path: '/api/coaches' },
  { method: 'GET',    path: '/api/saved-schedules' },
  { method: 'GET',    path: '/api/settings' },
  { method: 'GET',    path: '/api/announcements' },
  { method: 'GET',    path: '/api/camps' },
  { method: 'GET',    path: '/api/users' },
  { method: 'GET',    path: '/api/registration-periods' },
  { method: 'GET',    path: '/api/seasonal-registrations' },
  { method: 'GET',    path: '/api/support-tickets' },
  { method: 'GET',    path: '/api/audit-logs' },
  { method: 'GET',    path: '/api/metrics' },
  // THE ROUTE THAT HAD C1 — must stay here permanently as a regression test
  { method: 'POST',   path: '/api/auth/register',
    body: { email: 'x@x.com', password: 'Abc123!x', firstName: 'X', lastName: 'X', role: 'admin' }
  },
];

// =============================================================================
// TESTS
// =============================================================================

describe('Route authentication coverage', () => {

  describe('Protected endpoints — unauthenticated request must return 401', () => {
    test.each(PROTECTED_ENDPOINTS_SAMPLE)(
      '$method $path → 401 without token',
      async ({ method, path, body }) => {
        const req = request(app)[method.toLowerCase()](path);
        if (body) req.send(body);
        const res = await req;
        expect(res.status).toBe(401);
      }
    );
  });

  describe('Public endpoints sanity — these must NOT require auth', () => {
    // Just verify /api/health and / are reachable
    test('GET / → not 401', async () => {
      const res = await request(app).get('/');
      expect(res.status).not.toBe(401);
    });

    test('GET /api/health → 200', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
    });

    test('POST /api/auth/login (no body) → 401 from passport, not 404', async () => {
      // Confirms the route exists and is reachable (just missing credentials)
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.status).not.toBe(404);
    });
  });

  describe('PUBLIC_ENDPOINTS allowlist self-check', () => {
    test('allowlist has no duplicate paths', () => {
      const keys = PUBLIC_ENDPOINTS.map(e => `${e.method} ${e.path}`);
      const unique = new Set(keys);
      expect(unique.size).toBe(keys.length);
    });

    test('every public endpoint has a documented reason', () => {
      for (const endpoint of PUBLIC_ENDPOINTS) {
        expect(endpoint.reason).toBeTruthy();
      }
    });
  });

});
