/**
 * Portal Camps Routes (Student Portal)
 *
 * Student-facing API for browsing and registering for camps.
 *
 * Endpoints:
 * - GET    /api/portal/camps                   - Browse available camps (status=open only)
 * - GET    /api/portal/camps/:id               - Get camp details
 * - GET    /api/portal/camps/my-registrations  - My camp registrations
 * - POST   /api/portal/camps/:id/register      - Register for camp (atomic capacity check)
 * - DELETE /api/portal/camps/registrations/:id - Cancel my registration
 */

import express from 'express';
import Camp from '../models/Camp.js';
import CampRegistration from '../models/CampRegistration.js';
import verifyPortalAuth from '../middleware/verifyPortalAuth.js';
import mongoose from 'mongoose';
import { encryptIBAN, validateIBANFormat } from '../utils/encryption.js';

const router = express.Router();

// All routes require portal authentication (student portal users)
router.use(verifyPortalAuth);

/**
 * GET /api/portal/camps
 * Browse available camps (status=open only)
 *
 * Query params:
 * - targetAudience: filter by audience (all, adults, children)
 * - skillLevel: filter by skill level
 */
router.get('/', async (req, res) => {
  try {
    const { targetAudience, skillLevel } = req.query;

    // Build filter - only show open camps
    const filter = {
      status: 'open',
      deletedAt: null,
      registrationCloseDate: { $gte: new Date() } // Registration still open
    };

    if (targetAudience && targetAudience !== 'all') {
      filter.targetAudience = { $in: ['all', targetAudience] };
    }

    if (skillLevel) {
      filter.skillLevels = skillLevel;
    }

    const camps = await Camp.find(filter)
      .populate('trainerId', 'name')
      .sort({ startDate: 1 }); // Upcoming first

    res.json({
      success: true,
      count: camps.length,
      camps
    });
  } catch (error) {
    console.error('Error listing camps:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Laden der Camps'
    });
  }
});

/**
 * GET /api/portal/camps/my-registrations
 * Get my camp registrations (as student or parent)
 * IMPORTANT: Must be defined BEFORE /:id route to avoid route collision
 */
router.get('/my-registrations', async (req, res) => {
  try {
    // Find all registrations for this user (JWT uses 'id' not '_id')
    const registrations = await CampRegistration.find({
      studentPortalUserId: req.user.id,
      status: { $in: ['confirmed', 'waitlist'] } // Exclude cancelled
    })
    .populate('campId')
    .sort({ 'campId.startDate': 1 }); // Upcoming first

    // Filter out registrations for deleted camps
    const validRegistrations = registrations.filter(r => r.campId && !r.campId.deletedAt);

    res.json({
      success: true,
      count: validRegistrations.length,
      registrations: validRegistrations
    });
  } catch (error) {
    console.error('Error fetching my registrations:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Laden Ihrer Anmeldungen'
    });
  }
});

/**
 * GET /api/portal/camps/:id
 * Get camp details (any status - for viewing own registrations)
 */
router.get('/:id', async (req, res) => {
  try {
    // Try string ID first, then ObjectId
    let camp = await Camp.findById(req.params.id)
      .populate('trainerId', 'name');

    if (!camp) {
      const { ObjectId } = require('mongodb');
      camp = await Camp.findById(new ObjectId(req.params.id))
        .populate('trainerId', 'name');
    }

    if (!camp || camp.deletedAt) {
      return res.status(404).json({
        success: false,
        error: 'Camp nicht gefunden'
      });
    }

    res.json({
      success: true,
      camp
    });
  } catch (error) {
    console.error('Error fetching camp:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Laden des Camps'
    });
  }
});

/**
 * POST /api/portal/camps/:id/register
 * Register for camp (ATOMIC TRANSACTION for capacity enforcement)
 *
 * Body:
 * - familyMemberId: (optional) if parent registering child
 * - firstName, lastName, birthdate, email, phone
 * - skillLevel: required
 * - emergencyContactName, emergencyContactPhone: required for children
 * - medicalNotes: optional
 */
router.post('/:id/register', async (req, res) => {
  // Check if transactions are supported (replica set/mongos only)
  // Respect USE_TRANSACTIONS setting (false for standalone MongoDB)
  const useTransactions = process.env.USE_TRANSACTIONS === 'true';

  let session = null;
  if (useTransactions) {
    session = await mongoose.startSession();
    await session.startTransaction();
  }

  try {
    const {
      familyMemberId,
      firstName,
      lastName,
      birthdate,
      email,
      phone,
      skillLevel,
      iban,
      additionalEmergencyContactName,
      additionalEmergencyContactPhone,
      medicalNotes
    } = req.body;

    // Validation
    if (!firstName || !lastName || !birthdate || !email || !skillLevel) {
      if (session) await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: 'Vorname, Nachname, Geburtsdatum, Email und Skill Level sind erforderlich'
      });
    }

    // Validate and encrypt IBAN if provided
    let encryptedIBAN = null;
    if (iban && iban.trim() !== '') {
      const cleanIBAN = iban.replace(/\s/g, ''); // Remove spaces
      if (!validateIBANFormat(cleanIBAN)) {
        if (session) await session.abortTransaction();
        return res.status(400).json({
          success: false,
          error: 'Ungültige IBAN'
        });
      }
      encryptedIBAN = encryptIBAN(cleanIBAN);
    }

    if (!['beginner', 'intermediate', 'advanced'].includes(skillLevel)) {
      if (session) await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: 'Ungültiger Skill Level'
      });
    }

    // 1. Lock camp document
    let campId = req.params.id;
    let camp = await Camp.findById(campId);
    if (!camp) {
      const { ObjectId } = require('mongodb');
      campId = new ObjectId(req.params.id);
      camp = await Camp.findById(campId);
    }

    if (!camp || camp.deletedAt) {
      if (session) await session.abortTransaction();
      return res.status(404).json({
        success: false,
        error: 'Camp nicht gefunden'
      });
    }

    // Check if registration is open
    const now = new Date();
    if (camp.status !== 'open' && camp.status !== 'full') {
      if (session) await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: 'Die Anmeldung für dieses Camp ist nicht geöffnet'
      });
    }

    if (camp.registrationCloseDate < now) {
      if (session) await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: 'Die Anmeldefrist ist abgelaufen'
      });
    }

    // Calculate age from birthdate
    const birthDate = new Date(birthdate);
    const age = Math.floor((now - birthDate) / (365.25 * 24 * 60 * 60 * 1000));

    // Force parent's info as primary emergency contact for children
    let emergencyContactName = '';
    let emergencyContactPhone = '';

    if (familyMemberId && age < 18) {
      // Get parent's info
      const StudentPortalUser = (await import('../models/StudentPortalUser.js')).default;
      const parent = await StudentPortalUser.findById(req.user.id);

      if (!parent || !parent.phone) {
        if (session) await session.abortTransaction();
        return res.status(400).json({
          success: false,
          error: 'Bitte fügen Sie zuerst eine Telefonnummer zu Ihrem Profil hinzu. Bei Minderjährigen ist eine Notfallkontaktnummer erforderlich.'
        });
      }

      // Force parent's info as primary emergency contact
      emergencyContactName = `${parent.firstName} ${parent.lastName}`;
      emergencyContactPhone = parent.phone;
    }

    // Check age requirements
    if (camp.minAge && age < camp.minAge) {
      if (session) await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: `Mindestalter: ${camp.minAge} Jahre`
      });
    }

    if (camp.maxAge && age > camp.maxAge) {
      if (session) await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: `Höchstalter: ${camp.maxAge} Jahre`
      });
    }

    // 2. Check duplicate registration (JWT uses 'id' not '_id')
    const existing = await CampRegistration.findOne({
      campId: campId,
      studentPortalUserId: req.user.id,
      familyMemberId: familyMemberId || null,
      status: { $in: ['confirmed', 'waitlist'] }
    });

    if (existing) {
      if (session) await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: 'Sie sind bereits für dieses Camp angemeldet'
      });
    }

    // Clean up any cancelled registration (to avoid unique index conflict)
    const cancelled = await CampRegistration.findOne({
      campId: campId,
      studentPortalUserId: req.user.id,
      familyMemberId: familyMemberId || null,
      status: 'cancelled'
    });

    if (cancelled) {
      await CampRegistration.deleteOne({ _id: cancelled._id });
    }

    // 3. Check capacity
    let status = 'confirmed';
    if (camp.currentParticipants >= camp.maxParticipants) {
      if (!camp.waitlistEnabled) {
        if (session) await session.abortTransaction();
        return res.status(400).json({
          success: false,
          error: 'Das Camp ist ausgebucht'
        });
      }

      // Check waitlist capacity
      if (camp.maxWaitlist > 0) {
        const waitlistCount = await CampRegistration.countDocuments({
          campId: campId,
          status: 'waitlist'
        });

        if (waitlistCount >= camp.maxWaitlist) {
          if (session) await session.abortTransaction();
          return res.status(400).json({
            success: false,
            error: 'Die Warteliste ist voll'
          });
        }
      }

      status = 'waitlist';
    }

    // 4. Create registration
    const registration = new CampRegistration({
      campId: campId,
      studentPortalUserId: req.user.id,
      familyMemberId: familyMemberId || null,
      firstName,
      lastName,
      birthdate,
      email,
      phone: phone || '',
      skillLevel,
      emergencyContactName: emergencyContactName || '',
      emergencyContactPhone: emergencyContactPhone || '',
      additionalEmergencyContactName: additionalEmergencyContactName || '',
      additionalEmergencyContactPhone: additionalEmergencyContactPhone || '',
      medicalNotes: medicalNotes || '',
      status: status,
      registeredAt: new Date()
    });

    await registration.save(session ? { session } : {});

    // 5. Increment counter (only if confirmed)
    if (status === 'confirmed') {
      camp.currentParticipants += 1;
      await camp.save(session ? { session } : {});
    }

    // 6. Save IBAN to portal user profile if provided
    if (encryptedIBAN) {
      const StudentPortalUser = (await import('../models/StudentPortalUser.js')).default;
      await StudentPortalUser.findByIdAndUpdate(
        req.user.id,
        { iban: encryptedIBAN },
        session ? { session } : {}
      );
    }

    // 7. Commit transaction
    if (session) await session.commitTransaction();

    res.status(201).json({
      success: true,
      message: status === 'confirmed'
        ? 'Anmeldung erfolgreich!'
        : 'Sie wurden auf die Warteliste gesetzt',
      registration: {
        _id: registration._id,
        status: registration.status
      }
    });
  } catch (error) {
    if (session) await session.abortTransaction();
    console.error('Error registering for camp:', error);

    if (error.message.includes('Notfallkontakt')) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: 'Fehler beim Anmelden für das Camp'
    });
  } finally {
    if (session) session.endSession();
  }
});

/**
 * DELETE /api/portal/camps/registrations/:id
 * Cancel my registration (with waitlist auto-promotion)
 */
router.delete('/registrations/:id', async (req, res) => {
  // Check if transactions are supported (replica set/mongos only)
  // Respect USE_TRANSACTIONS setting (false for standalone MongoDB)
  const useTransactions = process.env.USE_TRANSACTIONS === 'true';

  let session = null;
  if (useTransactions) {
    session = await mongoose.startSession();
    await session.startTransaction();
  }

  try {
    // Find registration
    let regId = req.params.id;
    let registration = await CampRegistration.findById(regId);
    if (!registration) {
      const { ObjectId } = require('mongodb');
      regId = new ObjectId(req.params.id);
      registration = await CampRegistration.findById(regId);
    }

    if (!registration) {
      if (session) await session.abortTransaction();
      return res.status(404).json({
        success: false,
        error: 'Anmeldung nicht gefunden'
      });
    }

    // Verify ownership (JWT uses 'id' not '_id')
    if (registration.studentPortalUserId.toString() !== req.user.id.toString()) {
      if (session) await session.abortTransaction();
      return res.status(403).json({
        success: false,
        error: 'Sie dürfen nur Ihre eigenen Anmeldungen stornieren'
      });
    }

    // Check if already cancelled
    if (registration.status === 'cancelled') {
      if (session) await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: 'Diese Anmeldung wurde bereits storniert'
      });
    }

    // Get camp
    const camp = await Camp.findById(registration.campId);
    if (!camp) {
      if (session) await session.abortTransaction();
      return res.status(404).json({
        success: false,
        error: 'Camp nicht gefunden'
      });
    }

    // Check cancellation deadline (7 days before start)
    const daysUntilStart = Math.ceil((new Date(camp.startDate) - new Date()) / (1000 * 60 * 60 * 24));
    if (daysUntilStart < 7) {
      if (session) await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: 'Stornierung ist nur bis 7 Tage vor Beginn möglich'
      });
    }

    const wasConfirmed = registration.status === 'confirmed';

    // 1. Cancel registration
    registration.status = 'cancelled';
    registration.cancelledAt = new Date();
    await registration.save(session ? { session } : {});

    // 2. Decrement counter (only if was confirmed)
    if (wasConfirmed) {
      camp.currentParticipants = Math.max(0, camp.currentParticipants - 1);
      await camp.save(session ? { session } : {});

      // 3. Find first waitlist participant (FIFO)
      const waitlistRegistration = await CampRegistration.findOne({
        campId: camp._id,
        status: 'waitlist'
      })
      .sort({ registeredAt: 1 }) // Oldest first
      ;

      if (waitlistRegistration) {
        // 4. Promote to confirmed
        waitlistRegistration.status = 'confirmed';
        await waitlistRegistration.save(session ? { session } : {});

        // 5. Increment counter again
        camp.currentParticipants += 1;
        await camp.save(session ? { session } : {});

        // TODO: Send email notification to promoted user
        console.log(`Auto-promoted waitlist registration ${waitlistRegistration._id} to confirmed`);
      }
    }

    if (session) await session.commitTransaction();

    res.json({
      success: true,
      message: 'Anmeldung erfolgreich storniert'
    });
  } catch (error) {
    if (session) await session.abortTransaction();
    console.error('Error cancelling registration:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Stornieren der Anmeldung'
    });
  } finally {
    if (session) session.endSession();
  }
});

export default router;
