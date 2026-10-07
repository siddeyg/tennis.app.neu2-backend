/**
 * Seasonal Training Billing Rules & Sibling Registration Handling Integration Tests
 *
 * Verifies:
 * 1. Kids SEPA enforcement when required by period config (mandatory IBAN, accountHolder, sepaMandate)
 * 2. Kids IBAN encryption & response redaction
 * 3. Adults Pure Invoice flow (success without SEPA / without IBAN / without accountHolder)
 * 4. Adults Club Membership restriction (rejection of non-members when required)
 * 5. Sibling multi-child portal submission flow (two children under same parent account create separate Students)
 * 6. Admin single approval (POST /:id/process) sibling protection (distinct Students despite shared email)
 */

import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import RegistrationPeriod from '../../models/RegistrationPeriod.js';
import SeasonalRegistration from '../../models/SeasonalRegistration.js';
import StudentPortalUser from '../../models/StudentPortalUser.js';
import Student from '../../models/Student.js';
import User from '../../models/User.js';
import portalSeasonalRegistrationsRoutes from '../../routes/portalSeasonalRegistrations.js';
import seasonalRegistrationsRoutes from '../../routes/seasonalRegistrations.js';
import {
  connectTestDB,
  disconnectTestDB,
  clearTestDB
} from '../../testHelpers.js';

const app = express();
app.use(express.json());
app.use(cookieParser());

// Mock auth middleware: handles both portal student users and admin users
let activeAuth = null;
app.use((req, res, next) => {
  if (activeAuth) {
    req.user = activeAuth;
  }
  next();
});

app.use('/api/portal/seasonal-registrations', portalSeasonalRegistrationsRoutes);
app.use('/api/seasonal-registrations', seasonalRegistrationsRoutes);

describe('Seasonal Billing Rules & Sibling Registration Tests', () => {
  let adminUser;
  let testPeriod;
  let portalUserWithSiblings;

  const VALID_IBAN = 'DE89370400440532013000';
  const VALID_IBAN_SPACES = 'DE89 3704 0044 0532 0130 00';

  beforeAll(async () => {
    await connectTestDB();
  });

  afterEach(async () => {
    await clearTestDB();
    activeAuth = null;
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  const setupBaseData = async (overrides = {}) => {
    adminUser = await User.create({
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@mondo-tennis.de',
      password: 'hashedpassword',
      role: 'admin'
    });

    testPeriod = await RegistrationPeriod.create({
      name: 'Wintertraining 2026/27',
      season: 'winter',
      trainingStartDate: new Date('2026-10-01'),
      trainingEndDate: new Date('2027-04-30'),
      registrationDeadline: new Date('2026-09-15'),
      status: 'open',
      isActive: true,
      currentPlanId: new mongoose.Types.ObjectId(),
      createdBy: adminUser._id,
      kidsFormConfig: {
        enabledFields: ['mitgliedsstatus', 'trainingsart', 'trainingshäufigkeit', 'availableTimesKids', 'sepaMandate'],
        requiredFields: ['mitgliedsstatus', 'trainingsart', 'availableTimesKids', ...(overrides.kidsSepaRequired ? ['sepaMandate'] : [])]
      },
      adultsFormConfig: {
        enabledFields: ['mitgliedsstatus', 'spielstärke', 'availableTimesAdults'],
        requiredFields: ['mitgliedsstatus', 'spielstärke', 'availableTimesAdults']
      }
    });

    // Parent with two sibling children: Julian (10) and Mia (7)
    portalUserWithSiblings = await StudentPortalUser.create({
      firstName: 'Claudia',
      lastName: 'Schneider',
      email: 'claudia.schneider@family.de',
      password: 'password123',
      birthdate: new Date('1982-04-12'),
      emailVerified: true,
      profileCompleted: true,
      sex: 'weiblich',
      member: true,
      familyMembers: [
        {
          firstName: 'Julian',
          lastName: 'Schneider',
          birthdate: new Date('2014-06-15'),
          relationship: 'child',
          sex: 'männlich',
          member: true
        },
        {
          firstName: 'Mia',
          lastName: 'Schneider',
          birthdate: new Date('2017-09-20'),
          relationship: 'child',
          sex: 'weiblich',
          member: true
        }
      ]
    });

    return { adminUser, testPeriod, portalUserWithSiblings };
  };

  describe('1. Kids Billing Rules (SEPA Pflicht bei Jugend/Kindertraining)', () => {
    it('should reject kids registration when sepaMandate is required by period and bank details are missing', async () => {
      const { testPeriod, portalUserWithSiblings } = await setupBaseData({ kidsSepaRequired: true });
      const julianId = portalUserWithSiblings.familyMembers[0]._id;

      activeAuth = { id: portalUserWithSiblings._id, role: 'student' };

      const res = await request(app)
        .post('/api/portal/seasonal-registrations')
        .send({
          periodId: testPeriod._id.toString(),
          familyMemberId: julianId.toString(),
          formType: 'kids',
          firstName: 'Julian',
          lastName: 'Schneider',
          birthdate: '2014-06-15',
          email: 'claudia.schneider@family.de',
          mitgliedsstatus: 'Mitglied',
          trainingsart: 'KIDS-ORANGE (ca. 8-10 Jahre)',
          trainingshäufigkeit: '1x pro Woche',
          availableTimesKids: [
            { day: 'Montag', hour: 15, venue: 'BTHV' },
            { day: 'Mittwoch', hour: 15, venue: 'BTHV' }
          ],
          privacyConsent: true
          // Missing: sepaMandate, iban, accountHolder
        })
        .expect(400);

      expect(res.body.error).toContain('SEPA-Mandat zwingend erforderlich');
    });

    it('should successfully submit kids registration with valid SEPA, encrypt IBAN, and redact it from response', async () => {
      const { testPeriod, portalUserWithSiblings } = await setupBaseData({ kidsSepaRequired: true });
      const julianId = portalUserWithSiblings.familyMembers[0]._id;

      activeAuth = { id: portalUserWithSiblings._id, role: 'student' };

      const res = await request(app)
        .post('/api/portal/seasonal-registrations')
        .send({
          periodId: testPeriod._id.toString(),
          familyMemberId: julianId.toString(),
          formType: 'kids',
          firstName: 'Julian',
          lastName: 'Schneider',
          birthdate: '2014-06-15',
          email: 'claudia.schneider@family.de',
          mitgliedsstatus: 'Mitglied',
          trainingsart: 'KIDS-ORANGE (ca. 8-10 Jahre)',
          trainingshäufigkeit: '1x pro Woche',
          availableTimesKids: [
            { day: 'Montag', hour: 15, venue: 'BTHV' },
            { day: 'Mittwoch', hour: 15, venue: 'BTHV' }
          ],
          privacyConsent: true,
          sepaMandate: true,
          accountHolder: 'Claudia Schneider',
          iban: VALID_IBAN_SPACES
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.registration).toBeDefined();

      // IBAN must be removed from API response for security
      expect(res.body.registration.iban).toBeUndefined();

      // IBAN in DB must be encrypted (iv:ciphertext)
      const savedReg = await SeasonalRegistration.findById(res.body.registration._id);
      expect(savedReg.iban).toBeDefined();
      expect(savedReg.iban).toContain(':');
      expect(savedReg.iban).not.toBe(VALID_IBAN);
      expect(savedReg.sepaMandate).toBe(true);
      expect(savedReg.accountHolder).toBe('Claudia Schneider');

      // IBAN must also be securely saved to parent's profile
      const updatedParent = await StudentPortalUser.findById(portalUserWithSiblings._id);
      expect(updatedParent.iban).toBeDefined();
      expect(updatedParent.iban).toBe(savedReg.iban);
    });
  });

  describe('2. Adults Billing Rules (Rechnung / Kein Bankeinzug)', () => {
    it('should succeed completely WITHOUT sepaMandate, WITHOUT iban, and WITHOUT accountHolder', async () => {
      const { testPeriod, portalUserWithSiblings } = await setupBaseData();

      // Parent registers herself for adult training
      activeAuth = { id: portalUserWithSiblings._id, role: 'student' };

      const res = await request(app)
        .post('/api/portal/seasonal-registrations')
        .send({
          periodId: testPeriod._id.toString(),
          formType: 'adults',
          firstName: 'Claudia',
          lastName: 'Schneider',
          birthdate: '1982-04-12',
          email: 'claudia.schneider@family.de',
          mitgliedsstatus: 'Mitglied',
          spielstärke: 'Fortgeschrittene',
          availableTimesAdults: [
            { day: 'Montag', hour: '18:00', venue: 'BTHV' },
            { day: 'Dienstag', hour: '19:00', venue: 'BTHV' }
          ],
          privacyConsent: true
          // Completely omitted: sepaMandate, iban, accountHolder
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.registration.formType).toBe('adults');
      expect(res.body.registration.sepaMandate).toBeFalsy();

      const savedReg = await SeasonalRegistration.findById(res.body.registration._id);
      expect(savedReg.sepaMandate).toBeFalsy();
      expect(savedReg.iban).toBeFalsy();
    });

    it('should enforce TC GW Kreuzberg e.V. membership for adults winter training when required', async () => {
      const { testPeriod, portalUserWithSiblings } = await setupBaseData();

      activeAuth = { id: portalUserWithSiblings._id, role: 'student' };

      const res = await request(app)
        .post('/api/portal/seasonal-registrations')
        .send({
          periodId: testPeriod._id.toString(),
          formType: 'adults',
          firstName: 'Claudia',
          lastName: 'Schneider',
          birthdate: '1982-04-12',
          email: 'claudia.schneider@family.de',
          mitgliedsstatus: 'Nicht-Mitglied', // Invalid for adults winter training
          spielstärke: 'Fortgeschrittene',
          availableTimesAdults: [
            { day: 'Montag', hour: '18:00', venue: 'BTHV' },
            { day: 'Dienstag', hour: '19:00', venue: 'BTHV' }
          ],
          privacyConsent: true
        })
        .expect(400);

      expect(res.body.error).toContain('ausschließlich Mitglieder');
    });
  });

  describe('3. Sibling Portal Multi-Child Registration Flow', () => {
    it('should auto-create two distinct Student records and link each child independently', async () => {
      const { testPeriod, portalUserWithSiblings } = await setupBaseData();
      const julianMember = portalUserWithSiblings.familyMembers[0];
      const miaMember = portalUserWithSiblings.familyMembers[1];

      activeAuth = { id: portalUserWithSiblings._id, role: 'student' };

      // 1. Register Julian
      const resJulian = await request(app)
        .post('/api/portal/seasonal-registrations')
        .send({
          periodId: testPeriod._id.toString(),
          familyMemberId: julianMember._id.toString(),
          formType: 'kids',
          firstName: 'Julian',
          lastName: 'Schneider',
          birthdate: '2014-06-15',
          email: 'claudia.schneider@family.de',
          mitgliedsstatus: 'Mitglied',
          trainingsart: 'KIDS-ORANGE (ca. 8-10 Jahre)',
          trainingshäufigkeit: '1x pro Woche',
          availableTimesKids: [
            { day: 'Montag', hour: 15, venue: 'BTHV' },
            { day: 'Mittwoch', hour: 15, venue: 'BTHV' }
          ],
          privacyConsent: true
        })
        .expect(201);

      // 2. Register Mia (sibling with same parent email & portal user)
      const resMia = await request(app)
        .post('/api/portal/seasonal-registrations')
        .send({
          periodId: testPeriod._id.toString(),
          familyMemberId: miaMember._id.toString(),
          formType: 'kids',
          firstName: 'Mia',
          lastName: 'Schneider',
          birthdate: '2017-09-20',
          email: 'claudia.schneider@family.de',
          mitgliedsstatus: 'Mitglied',
          trainingsart: 'KIDS-ROT (ca. 6-8 Jahre)',
          trainingshäufigkeit: '1x pro Woche',
          availableTimesKids: [
            { day: 'Dienstag', hour: 14, venue: 'BTHV' },
            { day: 'Donnerstag', hour: 14, venue: 'BTHV' }
          ],
          privacyConsent: true
        })
        .expect(201);

      expect(resJulian.body.success).toBe(true);
      expect(resMia.body.success).toBe(true);

      // Verify that TWO distinct Student records exist in the database
      const students = await Student.find({ periodId: testPeriod._id });
      expect(students).toHaveLength(2);

      const julianStudent = students.find(s => s.firstName === 'Julian');
      const miaStudent = students.find(s => s.firstName === 'Mia');

      expect(julianStudent).toBeDefined();
      expect(miaStudent).toBeDefined();
      expect(julianStudent._id.toString()).not.toBe(miaStudent._id.toString());

      // Sibling fields must be cleanly separated
      expect(julianStudent.trainigGroup).toBe('Orange');
      expect(julianStudent.familyMemberId.toString()).toBe(julianMember._id.toString());
      expect(julianStudent.studentPortalUserId.toString()).toBe(portalUserWithSiblings._id.toString());

      expect(miaStudent.trainigGroup).toBe('Rot');
      expect(miaStudent.familyMemberId.toString()).toBe(miaMember._id.toString());
      expect(miaStudent.studentPortalUserId.toString()).toBe(portalUserWithSiblings._id.toString());

      // Parent user's familyMembers array must point to their respective studentId
      const reloadedParent = await StudentPortalUser.findById(portalUserWithSiblings._id);
      expect(reloadedParent.familyMembers.id(julianMember._id).studentId.toString()).toBe(julianStudent._id.toString());
      expect(reloadedParent.familyMembers.id(miaMember._id).studentId.toString()).toBe(miaStudent._id.toString());
    });
  });

  describe('4. Admin Single Approval Sibling Protection (POST /api/seasonal-registrations/:id/process)', () => {
    it('should create separate Students for siblings when approved sequentially by admin', async () => {
      const { adminUser, testPeriod, portalUserWithSiblings } = await setupBaseData();
      const julianMember = portalUserWithSiblings.familyMembers[0];
      const miaMember = portalUserWithSiblings.familyMembers[1];

      // Create 2 pending registrations directly
      const regJulian = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: portalUserWithSiblings._id,
        familyMemberId: julianMember._id,
        formType: 'kids',
        firstName: 'Julian',
        lastName: 'Schneider',
        birthdate: new Date('2014-06-15'),
        email: 'claudia.schneider@family.de',
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'KIDS-ORANGE (ca. 8-10 Jahre)',
        trainingshäufigkeit: '1x pro Woche',
        availableTimesKids: [
          { day: 'Montag', hour: 15, venue: 'BTHV' },
          { day: 'Mittwoch', hour: 15, venue: 'BTHV' }
        ],
        privacyConsent: true,
        status: 'pending'
      });

      const regMia = await SeasonalRegistration.create({
        periodId: testPeriod._id,
        studentPortalUserId: portalUserWithSiblings._id,
        familyMemberId: miaMember._id,
        formType: 'kids',
        firstName: 'Mia',
        lastName: 'Schneider',
        birthdate: new Date('2017-09-20'),
        email: 'claudia.schneider@family.de',
        mitgliedsstatus: 'Mitglied',
        trainingsart: 'KIDS-ROT (ca. 6-8 Jahre)',
        trainingshäufigkeit: '1x pro Woche',
        availableTimesKids: [
          { day: 'Dienstag', hour: 14, venue: 'BTHV' },
          { day: 'Donnerstag', hour: 14, venue: 'BTHV' }
        ],
        privacyConsent: true,
        status: 'pending'
      });

      // Admin auth
      activeAuth = { id: adminUser._id, _id: adminUser._id, role: 'admin', email: adminUser.email };

      // Process Julian
      await request(app)
        .post(`/api/seasonal-registrations/${regJulian._id}/process`)
        .expect(200);

      // Process Mia (sharing same email)
      await request(app)
        .post(`/api/seasonal-registrations/${regMia._id}/process`)
        .expect(200);

      // Verify two distinct Student records exist
      const students = await Student.find({ periodId: testPeriod._id });
      expect(students).toHaveLength(2);

      const julianStudent = students.find(s => s.firstName === 'Julian');
      const miaStudent = students.find(s => s.firstName === 'Mia');

      expect(julianStudent).toBeDefined();
      expect(miaStudent).toBeDefined();
      expect(julianStudent._id.toString()).not.toBe(miaStudent._id.toString());
      expect(julianStudent.trainigGroup).toBe('Orange');
      expect(miaStudent.trainigGroup).toBe('Rot');
    });
  });
});
