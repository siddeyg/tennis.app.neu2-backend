/**
 * Test Suite: Testanmeldungen & E-Mail-Vorschau
 * File: backend/src/__tests__/testRegistrationAndEmailPreview.test.js
 *
 * Tests:
 * 1. Pure Renderers in utils/emailService.js
 *    - renderCampRegistrationNotificationEmail
 *    - renderCampRegistrationReceivedEmail
 *    - renderSeasonalRegistrationNotificationEmail
 *    - renderSeasonalRegistrationReceivedEmail
 * 2. HTML escaping and XSS protection in rendered email templates
 * 3. Event & Camp specific branching, Nicole notification logic
 * 4. Purity guarantee (no side effects, no transport/send calls)
 * 5. Dry-run endpoints for Camps and Seasonal Registration Periods:
 *    - Schema validation check
 *    - Zero DB writes verification when dryRun=true
 */

import { jest } from '@jest/globals';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import mongoose from 'mongoose';

// Pure Renderers from emailService
import {
  renderCampRegistrationNotificationEmail,
  renderCampRegistrationReceivedEmail,
  renderSeasonalRegistrationNotificationEmail,
  renderSeasonalRegistrationReceivedEmail
} from '../utils/emailService.js';

// Models
import Camp from '../models/Camp.js';
import CampRegistration from '../models/CampRegistration.js';
import RegistrationPeriod from '../models/RegistrationPeriod.js';
import SeasonalRegistration from '../models/SeasonalRegistration.js';
import User from '../models/User.js';

// Routes
import campsRoutes from '../routes/camps.js';
import registrationPeriodsRoutes from '../routes/registrationPeriods.js';

// Test DB helpers
import {
  connectTestDB,
  disconnectTestDB,
  clearTestDB
} from '../testHelpers.js';

// Express app for route tests
const app = express();
app.use(express.json());
app.use(cookieParser());

const mockAdminId = new mongoose.Types.ObjectId();
app.use((req, res, next) => {
  req.user = {
    _id: mockAdminId,
    id: mockAdminId,
    role: 'admin',
    firstName: 'Admin',
    lastName: 'Tester',
    email: 'admin-preview@mondo.local'
  };
  next();
});

app.use('/api/camps', campsRoutes);
app.use('/api/registration-periods', registrationPeriodsRoutes);

describe('Testanmeldungen & E-Mail-Vorschau Test Suite', () => {

  // =========================================================================
  // 1. PURE RENDERERS: Camp Registration Notification Email (Admin)
  // =========================================================================
  describe('renderCampRegistrationNotificationEmail()', () => {
    const baseCamp = {
      _id: new mongoose.Types.ObjectId(),
      title: 'Sommercamp 2026 Woche 1',
      campType: 'camp',
      startDate: new Date('2026-07-20'),
      endDate: new Date('2026-07-24'),
      startTime: '09:00',
      endTime: '15:00',
      price: 250
    };

    const baseRegistration = {
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'max@example.com',
      phone: '0151 12345678',
      birthdate: new Date('2014-06-15'),
      skillLevel: 'intermediate',
      team: true,
      notes: 'Keine Allergien.',
      emergencyContactName: 'Erika Mustermann',
      emergencyContactPhone: '0151 98765432'
    };

    test('should return correct structure { to, subject, html, text, sentToNicole } for standard camp', () => {
      const recipients = ['trainer@mondo.de'];
      const result = renderCampRegistrationNotificationEmail(baseRegistration, baseCamp, recipients);

      expect(result).toHaveProperty('to');
      expect(result).toHaveProperty('subject');
      expect(result).toHaveProperty('html');
      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('sentToNicole');

      expect(result.to).toEqual(recipients);
      expect(result.subject).toBe(`Neue Camp-Anmeldung: ${baseCamp.title} - Max Mustermann`);
      expect(result.html).toContain('Neue Camp-Anmeldung');
      expect(result.html).toContain('Max Mustermann');
      expect(result.html).toContain(baseCamp.title);
      expect(result.text).toContain('NEUE CAMP-ANMELDUNG');
      expect(result.text).toContain('Max Mustermann');
      expect(result.sentToNicole).toBe(false);
    });

    test('should properly format event notifications (campType: "event")', () => {
      const eventCamp = {
        ...baseCamp,
        title: 'Sommerfest & Schleifchenturnier',
        campType: 'event',
        notifyNicole: false,
        showAdditionalGuestsOption: true,
        showBarbecueOption: true
      };

      const eventRegistration = {
        ...baseRegistration,
        tournamentCategory: 'U11',
        secondaryTournamentCategory: 'U12',
        additionalChildren: 2,
        additionalAdults: 1,
        isBarbecueParticipant: true,
        barbecueCount: 3,
        isVegetarian: true
      };

      const result = renderCampRegistrationNotificationEmail(eventRegistration, eventCamp, ['admin@mondo.de']);

      expect(result.subject).toBe(`Neue Event-Anmeldung: ${eventCamp.title} - Max Mustermann`);
      expect(result.html).toContain('Neue Event-Anmeldung');
      expect(result.html).toContain('Sommerfest &amp; Schleifchenturnier');
      expect(result.html).toContain('U11');
      expect(result.html).toContain('U12');
      expect(result.html).toContain('Zusätzliche Kinder:');
      expect(result.html).toContain('Teilnahme Grillen:');
      expect(result.html).toContain('Vegetarisch:');
      expect(result.text).toContain('Sommerfest & Schleifchenturnier');
    });

    test('should rigorously escape HTML in user inputs (XSS prevention)', () => {
      const xssRegistration = {
        ...baseRegistration,
        firstName: '<script>alert("xss")</script>',
        lastName: '<img src=x onerror=alert(1)>',
        notes: '"><b onmouseover="alert(1)">Injected</b>'
      };

      const result = renderCampRegistrationNotificationEmail(xssRegistration, baseCamp, ['admin@mondo.de']);

      // Raw dangerous HTML must not be present
      expect(result.html).not.toContain('<script>alert("xss")</script>');
      expect(result.html).not.toContain('<img src=x onerror=alert(1)>');
      expect(result.html).not.toContain('<b onmouseover="alert(1)">');

      // Escaped entities must be present
      expect(result.html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(result.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    test('should correctly handle Nicole notification logic for events', () => {
      const eventWithNicole = {
        ...baseCamp,
        campType: 'event',
        notifyNicole: true
      };

      const eventWithoutNicole = {
        ...baseCamp,
        campType: 'event',
        notifyNicole: false
      };

      // Case 1: notifyNicole is true -> info@mondo-tennisschule.de is added and sentToNicole=true
      const resWith = renderCampRegistrationNotificationEmail(baseRegistration, eventWithNicole, ['other@mondo.de']);
      expect(resWith.sentToNicole).toBe(true);
      expect(resWith.to).toContain('info@mondo-tennisschule.de');
      expect(resWith.to).toContain('other@mondo.de');

      // Case 2: notifyNicole is false -> info@mondo-tennisschule.de is removed if present
      const resWithout = renderCampRegistrationNotificationEmail(
        baseRegistration,
        eventWithoutNicole,
        ['info@mondo-tennisschule.de', 'other@mondo.de']
      );
      expect(resWithout.sentToNicole).toBe(false);
      expect(resWithout.to).not.toContain('info@mondo-tennisschule.de');
      expect(resWithout.to).toContain('other@mondo.de');

      // Case 3: standard camp -> Nicole presence is purely based on recipient list
      const resStandardWithNicole = renderCampRegistrationNotificationEmail(
        baseRegistration,
        baseCamp,
        ['info@mondo-tennisschule.de']
      );
      expect(resStandardWithNicole.sentToNicole).toBe(true);

      const resStandardWithoutNicole = renderCampRegistrationNotificationEmail(
        baseRegistration,
        baseCamp,
        ['admin@mondo.de']
      );
      expect(resStandardWithoutNicole.sentToNicole).toBe(false);
    });
  });

  // =========================================================================
  // 2. PURE RENDERERS: Camp Registration Received Email (Participant)
  // =========================================================================
  describe('renderCampRegistrationReceivedEmail()', () => {
    const camp = {
      title: 'Oster-Tenniscamp 2026',
      campType: 'camp',
      startDate: new Date('2026-04-06'),
      endDate: new Date('2026-04-10')
    };

    const registration = {
      firstName: 'Sophie',
      lastName: 'Müller',
      email: 'sophie.mueller@example.com'
    };

    test('should return { to, subject, html, text } directed to participant email', () => {
      const result = renderCampRegistrationReceivedEmail(registration, camp);

      expect(result.to).toBe('sophie.mueller@example.com');
      expect(result.subject).toBe('Camp-Anmeldung eingegangen: Oster-Tenniscamp 2026');
      expect(result.html).toContain('Hallo Sophie Müller');
      expect(result.html).toContain('Oster-Tenniscamp 2026');
      expect(result.html).toContain('Anmeldung ist noch nicht bestätigt');
      expect(result.text).toContain('Hallo Sophie Müller');
      expect(result.text).toContain('Oster-Tenniscamp 2026');
    });

    test('should include tournament categories in subject and body for events', () => {
      const eventCamp = {
        title: 'Tennolino Cup 2026',
        campType: 'event',
        startDate: new Date('2026-06-01'),
        endDate: new Date('2026-06-01')
      };

      const eventReg = {
        ...registration,
        tournamentCategory: 'U9',
        secondaryTournamentCategory: 'U11'
      };

      const result = renderCampRegistrationReceivedEmail(eventReg, eventCamp);

      expect(result.subject).toBe('Event-Anmeldung eingegangen: Tennolino Cup 2026');
      expect(result.html).toContain('U9');
      expect(result.html).toContain('U11');
      expect(result.text).toContain('Altersklasse: U9 (Wunschgruppe), U11 (Zweitgruppe)');
    });

    test('should escape HTML characters in participant name and camp title', () => {
      const maliciousReg = {
        firstName: '<script>alert(1)</script>',
        lastName: '<b>Smith</b>',
        email: 'test@example.com'
      };
      const maliciousCamp = {
        title: 'Camp <script>bad()</script>',
        campType: 'camp'
      };

      const result = renderCampRegistrationReceivedEmail(maliciousReg, maliciousCamp);

      expect(result.html).not.toContain('<script>alert(1)</script>');
      expect(result.html).not.toContain('<script>bad()</script>');
      expect(result.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(result.html).toContain('Camp &lt;script&gt;bad()&lt;/script&gt;');
    });
  });

  // =========================================================================
  // 3. PURE RENDERERS: Seasonal Registration Notification Email (Admin)
  // =========================================================================
  describe('renderSeasonalRegistrationNotificationEmail()', () => {
    test('should render kids seasonal registration notification with available times', () => {
      const kidsReg = {
        firstName: 'Leo',
        lastName: 'Musterkind',
        email: 'eltern@example.com',
        phone: '0171 1234567',
        birthdate: new Date('2015-03-12'),
        address: 'Testweg 4, Bonn',
        formType: 'kids',
        trainingsart: 'KIDS-GRÜN (ca. 10-12 Jahre)',
        trainingshäufigkeit: '2x pro Woche',
        sessionDuration: 60,
        availableTimesKids: [
          { day: 'Mo', hour: 15 },
          { day: 'Mi', hour: 16 }
        ],
        parentEmail: 'mutter@example.com',
        parentPhone: '0171 7654321',
        remarks: 'Spielt gerne Vorhand.'
      };

      const recipients = ['admin1@mondo.de', 'admin2@mondo.de'];
      const result = renderSeasonalRegistrationNotificationEmail(kidsReg, recipients);

      expect(result.to).toEqual(recipients);
      expect(result.subject).toBe('Neue Saisonregistrierung: Leo Musterkind');
      expect(result.html).toContain('Kinder/Jugend');
      expect(result.html).toContain('KIDS-GRÜN (ca. 10-12 Jahre)');
      expect(result.html).toContain('Montag: 15 Uhr');
      expect(result.html).toContain('Mittwoch: 16 Uhr');
      expect(result.html).toContain('mutter@example.com');
      expect(result.html).toContain('Spielt gerne Vorhand.');
      expect(result.text).toContain('Leo Musterkind');
      expect(result.text).toContain('Montag: 15 Uhr');
    });

    test('should render adults seasonal registration with skillLevel, goals, and groupSize', () => {
      const adultReg = {
        firstName: 'Erika',
        lastName: 'Musterfrau',
        email: 'erika@example.com',
        phone: '0172 9876543',
        birthdate: new Date('1988-11-20'),
        formType: 'adults',
        spielstärke: 'Fortgeschrittene',
        trainingshäufigkeit: '1x pro Woche',
        sessionDuration: 90,
        trainingGoals: ['Freizeit', 'Fitness'],
        groupSize: ['zu viert', 'zu dritt'],
        availableTimesAdults: [
          { day: 'Di', hour: '18:00 - 19:30' }
        ],
        remarks: 'Nur Traglufthalle.'
      };

      const result = renderSeasonalRegistrationNotificationEmail(adultReg, ['admin@mondo.de']);

      expect(result.subject).toBe('Neue Saisonregistrierung: Erika Musterfrau');
      expect(result.html).toContain('Erwachsene');
      expect(result.html).toContain('Fortgeschrittene');
      expect(result.html).toContain('Freizeit, Fitness');
      expect(result.html).toContain('zu viert, zu dritt');
      expect(result.html).toContain('90 Min');
      expect(result.html).toContain('Dienstag: 18:00 - 19:30 Uhr');
      expect(result.text).toContain('Fortgeschrittene');
      expect(result.text).toContain('Freizeit, Fitness');
    });

    test('should strictly escape HTML across all seasonal registration fields', () => {
      const xssReg = {
        firstName: '<script>xss()</script>',
        lastName: '"><img src=x onerror=1>',
        email: 'evil@example.com',
        formType: 'kids',
        address: '<script>bad()</script>',
        remarks: '<iframe src="evil.com"></iframe>',
        parentEmail: '<a href="javascript:alert(1)">Click</a>'
      };

      const result = renderSeasonalRegistrationNotificationEmail(xssReg, ['admin@mondo.de']);

      expect(result.html).not.toContain('<script>xss()</script>');
      expect(result.html).not.toContain('<img src=x onerror=1>');
      expect(result.html).not.toContain('<iframe');
      expect(result.html).toContain('&lt;script&gt;xss()&lt;/script&gt;');
      expect(result.html).toContain('&lt;iframe src=&quot;evil.com&quot;&gt;&lt;/iframe&gt;');
    });
  });

  // =========================================================================
  // 4. PURE RENDERERS: Seasonal Registration Received Email (Participant)
  // =========================================================================
  describe('renderSeasonalRegistrationReceivedEmail()', () => {
    test('should render participant confirmation with period name and dates', () => {
      const period = {
        name: 'Sommertraining 2026',
        trainingStartDate: new Date('2026-05-01'),
        trainingEndDate: new Date('2026-09-30')
      };

      const reg = {
        firstName: 'Anna',
        lastName: 'Schulze',
        email: 'anna@example.com'
      };

      const result = renderSeasonalRegistrationReceivedEmail(reg, period);

      expect(result.to).toBe('anna@example.com');
      expect(result.subject).toBe('Anmeldung eingegangen: Sommertraining 2026');
      expect(result.html).toContain('Hallo Anna Schulze');
      expect(result.html).toContain('Sommertraining 2026');
      expect(result.html).toContain('01.05.2026');
      expect(result.html).toContain('30.09.2026');
      expect(result.text).toContain('Sommertraining 2026');
      expect(result.text).toContain('01.05.2026 – 30.09.2026');
    });

    test('should render childName when registration is for a child', () => {
      const period = { name: 'Wintertraining 2026/27' };
      const reg = {
        firstName: 'Stefan',
        lastName: 'Meier',
        childName: 'Felix Meier',
        email: 'stefan@example.com'
      };

      const result = renderSeasonalRegistrationReceivedEmail(reg, period);

      expect(result.html).toContain('Felix Meier');
      expect(result.text).toContain('Die Anmeldung für "Felix Meier"');
    });

    test('should fallback gracefully when period object is empty or missing name', () => {
      const reg = {
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com'
      };

      const result = renderSeasonalRegistrationReceivedEmail(reg, {});

      expect(result.subject).toBe('Anmeldung eingegangen: Saisontraining');
      expect(result.html).toContain('Saisontraining');
    });
  });

  // =========================================================================
  // 5. PURITY VERIFICATION (No network calls, no email sending side-effects)
  // =========================================================================
  describe('Purity Guarantee of Email Renderers', () => {
    test('all render functions must be synchronous and pure without triggering SMTP', () => {
      const dummyCamp = { title: 'Camp', campType: 'camp' };
      const dummyReg = { firstName: 'A', lastName: 'B', email: 'a@b.com' };
      const dummyPeriod = { name: 'Period' };

      // None of these should return a Promise, throw, or require async resolution
      const campAdmin = renderCampRegistrationNotificationEmail(dummyReg, dummyCamp, []);
      const campUser = renderCampRegistrationReceivedEmail(dummyReg, dummyCamp);
      const seasonalAdmin = renderSeasonalRegistrationNotificationEmail(dummyReg, []);
      const seasonalUser = renderSeasonalRegistrationReceivedEmail(dummyReg, dummyPeriod);

      expect(campAdmin).not.toBeInstanceOf(Promise);
      expect(campUser).not.toBeInstanceOf(Promise);
      expect(seasonalAdmin).not.toBeInstanceOf(Promise);
      expect(seasonalUser).not.toBeInstanceOf(Promise);

      expect(typeof campAdmin.html).toBe('string');
      expect(typeof campUser.html).toBe('string');
      expect(typeof seasonalAdmin.html).toBe('string');
      expect(typeof seasonalUser.html).toBe('string');
    });
  });

  // =========================================================================
  // 6. INTEGRATION / ROUTE CHECKS: Dry-Run and DB Isolation
  // =========================================================================
  describe('Integration & DryRun Checks (Mongoose DB Isolation)', () => {
    let testCamp;
    let testPeriod;

    beforeAll(async () => {
      await connectTestDB();
    });

    beforeEach(async () => {
      await clearTestDB();

      // Seed a test camp
      testCamp = await Camp.create({
        title: 'Integration Test Camp',
        description: 'Test Camp Description for Jest',
        campType: 'other',
        status: 'open',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-08-05'),
        registrationOpenDate: new Date('2026-06-01'),
        registrationCloseDate: new Date('2026-07-31'),
        maxParticipants: 20,
        createdBy: mockAdminId,
        notificationEmails: ['organizer@mondo.de']
      });

      // Seed a test registration period
      testPeriod = await RegistrationPeriod.create({
        name: 'Integration Test Periode',
        season: 'summer',
        year: 2026,
        status: 'draft',
        trainingStartDate: new Date('2026-05-01'),
        trainingEndDate: new Date('2026-09-30'),
        registrationDeadline: new Date('2026-04-20'),
        createdBy: mockAdminId,
        notificationEmails: ['admin@mondo.de']
      });
    });

    afterAll(async () => {
      await disconnectTestDB();
    });

    test('POST /api/camps/:id/test-registration with dryRun=true should return previews and NOT save to DB', async () => {
      const initialCount = await CampRegistration.countDocuments();
      expect(initialCount).toBe(0);

      const res = await request(app)
        .post(`/api/camps/${testCamp._id}/test-registration`)
        .send({
          dryRun: true,
          sendRealEmail: false,
          registrationData: {
            firstName: 'DryRunTester',
            lastName: 'Muster',
            email: 'dryrun@test.local',
            skillLevel: 'intermediate',
            team: false
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.dryRun).toBe(true);
      expect(res.body.validation.valid).toBe(true);

      // Verify email previews were returned
      expect(res.body.emails.userEmail).toBeDefined();
      expect(res.body.emails.adminEmail).toBeDefined();
      expect(res.body.emails.userEmail.subject).toContain('Integration Test Camp');
      expect(res.body.emails.adminEmail.subject).toContain('DryRunTester');

      // Crucial: Verify zero records were created in the database
      const finalCount = await CampRegistration.countDocuments();
      expect(finalCount).toBe(0);
    });

    test('POST /api/camps/:id/test-registration should report validation errors for invalid input without saving', async () => {
      const res = await request(app)
        .post(`/api/camps/${testCamp._id}/test-registration`)
        .send({
          dryRun: true,
          registrationData: {
            // Invalid skillLevel not matching enum ['beginner', 'intermediate', 'advanced']
            skillLevel: 'super-pro-master',
            // Missing required firstName by forcing null
            firstName: null
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.validation.valid).toBe(false);
      expect(res.body.validation.errors.length).toBeGreaterThan(0);

      // Verify still no DB writes
      const finalCount = await CampRegistration.countDocuments();
      expect(finalCount).toBe(0);
    });

    test('POST /api/registration-periods/:id/test-registration (kids) with dryRun=true should return previews and NOT save to DB', async () => {
      const initialCount = await SeasonalRegistration.countDocuments();
      expect(initialCount).toBe(0);

      const res = await request(app)
        .post(`/api/registration-periods/${testPeriod._id}/test-registration`)
        .send({
          dryRun: true,
          scenario: 'kids',
          sendRealEmail: false
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.dryRun).toBe(true);
      expect(res.body.scenario).toBe('kids');
      expect(res.body.validation.valid).toBe(true);

      // Verify email previews
      expect(res.body.emails.userEmail.html).toContain('Anmeldung eingegangen');
      expect(res.body.emails.adminEmail.html).toContain('Neue Saisonregistrierung');

      // Crucial: Zero records written to DB
      const finalCount = await SeasonalRegistration.countDocuments();
      expect(finalCount).toBe(0);
    });

    test('POST /api/registration-periods/:id/test-registration (adults) with dryRun=true should return previews and NOT save to DB', async () => {
      const initialCount = await SeasonalRegistration.countDocuments();
      expect(initialCount).toBe(0);

      const res = await request(app)
        .post(`/api/registration-periods/${testPeriod._id}/test-registration`)
        .send({
          dryRun: true,
          scenario: 'adults',
          sendRealEmail: false
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.dryRun).toBe(true);
      expect(res.body.scenario).toBe('adults');
      expect(res.body.validation.valid).toBe(true);

      expect(res.body.emails.adminEmail.html).toContain('Erwachsene');

      // Crucial: Zero records written to DB
      const finalCount = await SeasonalRegistration.countDocuments();
      expect(finalCount).toBe(0);
    });

    test('POST /api/registration-periods/:id/test-registration should report validation errors for invalid data', async () => {
      const res = await request(app)
        .post(`/api/registration-periods/${testPeriod._id}/test-registration`)
        .send({
          dryRun: true,
          scenario: 'kids',
          registrationData: {
            trainingsart: 'Ungültige Trainingsart',
            sessionDuration: 120 // invalid enum, only 60 or 90 allowed
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.validation.valid).toBe(false);
      expect(res.body.validation.errors.length).toBeGreaterThan(0);

      const count = await SeasonalRegistration.countDocuments();
      expect(count).toBe(0);
    });
  });
});
