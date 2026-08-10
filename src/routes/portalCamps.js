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
import Settings from '../models/Settings.js';
import verifyPortalAuth from '../middleware/verifyPortalAuth.js';
import mongoose from 'mongoose';
import logger from '../utils/logger.js';
import { encryptIBAN, validateIBANFormat } from '../utils/encryption.js';
import auditLogMiddleware from '../middleware/auditLog.js';
import { sendCampRegistrationNotification, sendCampRegistrationReceivedEmail, sendCampCancellationEmail, sendCampCancellationAdminEmail, sendCampConfirmationEmail } from '../utils/emailService.js';
import { createNotification } from '../utils/notificationHelpers.js';

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

    // Build filter - show open camps + full camps with waitlist
    const filter = {
      $or: [
        { status: 'open' },
        { status: 'full', waitlistEnabled: true }
      ],
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
      .populate('trainerId', 'firstName lastName')
      .sort({ startDate: 1 }); // Upcoming first

    res.json({
      success: true,
      count: camps.length,
      camps
    });
  } catch (error) {
    logger.error("Error listing camps", { error: error.message, stack: error.stack });
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
      status: { $in: ['pending', 'confirmed', 'waitlist', 'rejected', 'cancelled'] }
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
    logger.error("Error fetching my registrations", { error: error.message, stack: error.stack });
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
    const camp = await Camp.findById(req.params.id)
      .populate('trainerId', 'firstName lastName');

    if (!camp || camp.deletedAt) {
      return res.status(404).json({
        success: false,
        error: `${camp?.campType === 'event' ? 'Event' : 'Camp'} nicht gefunden`
      });
    }

    res.json({
      success: true,
      camp
    });
  } catch (error) {
    logger.error("Error fetching camp", { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: 'Fehler beim Laden'
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
router.post('/:id/register', auditLogMiddleware({ action: 'CREATE', resource: 'CampRegistration' }), async (req, res) => {
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
      team,
      additionalChildren,
      additionalAdults,
      isBarbecueParticipant,
      barbecueCount,
      isVegetarian,
      privacyConsent,
      additionalEmergencyContactName,
      additionalEmergencyContactPhone,
      medicalNotes,
      iban
    } = req.body;

    // 1. Lock camp document
    const campId = req.params.id;
    const camp = await Camp.findById(campId);

    const isEvent = camp?.campType === 'event';

    if (!camp || camp.deletedAt) {
      if (session) await session.abortTransaction();
      return res.status(404).json({
        success: false,
        error: `${isEvent ? 'Event' : 'Camp'} nicht gefunden`
      });
    }

    // Validation
    if (!firstName || !lastName || !birthdate || !email) {
      if (session) await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: 'Vorname, Nachname, Geburtsdatum und Email sind erforderlich'
      });
    }

    // IBAN Validation
    if (iban && iban.trim()) {
      const cleanIban = iban.replace(/\s/g, '');
      if (!validateIBANFormat(cleanIban)) {
        if (session) await session.abortTransaction();
        return res.status(400).json({
          success: false,
          error: 'Ungültiges IBAN-Format'
        });
      }
    }

    // Conditional validation based on camp type
    if (isEvent && !privacyConsent) {
      if (session) await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: 'Die Zustimmung zur Datenweitergabe ist erforderlich'
      });
    }

    if (!isEvent) {
      if (!skillLevel) {
        if (session) await session.abortTransaction();
        return res.status(400).json({
          success: false,
          error: `Skill Level ist für ${isEvent ? 'Events' : 'Camps'} erforderlich`
        });
      }

      if (team === null || team === undefined) {
        if (session) await session.abortTransaction();
        return res.status(400).json({
          success: false,
          error: `Mannschaft (Team/Freizeit) ist für ${isEvent ? 'Events' : 'Camps'} erforderlich`
        });
      }

      if (!['beginner', 'intermediate'].includes(skillLevel)) {
        if (session) await session.abortTransaction();
        return res.status(400).json({
          success: false,
          error: 'Ungültiger Skill Level'
        });
      }
    }

    // Check if registration is open
    const now = new Date();
    if (camp.status !== 'open' && camp.status !== 'full') {
      if (session) await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: `Die Anmeldung für dieses ${isEvent ? 'Event' : 'Camp'} ist nicht geöffnet`
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
    if (familyMemberId && camp.allowFamilyRegistration === false) {
      if (session) await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: 'Anmeldungen für Familienmitglieder sind für dieses Event nicht erlaubt'
      });
    }

    const existing = await CampRegistration.findOne({
      campId: campId,
      studentPortalUserId: req.user.id,
      familyMemberId: familyMemberId || null,
      status: { $in: ['pending', 'confirmed', 'waitlist'] }
    });

    if (existing) {
      if (session) await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: `Sie sind bereits für dieses ${isEvent ? 'Event' : 'Camp'} angemeldet`
      });
    }

    // Clean up any cancelled/rejected registration (to avoid unique index conflict)
    const oldReg = await CampRegistration.findOne({
      campId: campId,
      studentPortalUserId: req.user.id,
      familyMemberId: familyMemberId || null,
      status: { $in: ['cancelled', 'rejected'] }
    });

    if (oldReg) {
      await CampRegistration.deleteOne({ _id: oldReg._id });
    }

    // 3. Check capacity using live count (pending + confirmed both hold spots)
    const activeCount = await CampRegistration.countDocuments({
      campId: campId,
      status: { $in: ['pending', 'confirmed', 'waitlist'] }
    });
    
    let status = isEvent ? 'confirmed' : 'pending';
    
    // Only check capacity if participants are NOT unlimited
    if (!camp.isUnlimitedParticipants && activeCount >= camp.maxParticipants) {
      if (!camp.waitlistEnabled) {
        if (session) await session.abortTransaction();
        return res.status(400).json({
          success: false,
          error: `Das ${isEvent ? 'Event' : 'Camp'} ist ausgebucht`
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
    const isBBQ = isEvent ? !!isBarbecueParticipant : false;
    const guests = isEvent ? ((parseInt(additionalChildren) || 0) + (parseInt(additionalAdults) || 0)) : 0;
    const totalBBQPeople = isBBQ ? (guests + 1) : 0;

    const registration = new CampRegistration({
      campId: campId,
      studentPortalUserId: req.user.id,
      familyMemberId: familyMemberId || null,
      firstName,
      lastName,
      birthdate,
      email,
      phone: phone || '',
      skillLevel: isEvent ? null : skillLevel,
      team: isEvent ? false : (team === true || team === 'true'), // Default to false for events
      additionalChildren: isEvent ? (parseInt(additionalChildren) || 0) : 0,
      additionalAdults: isEvent ? (parseInt(additionalAdults) || 0) : 0,
      additionalParticipants: guests,
      isBarbecueParticipant: isBBQ,
      barbecueCount: totalBBQPeople,
      isVegetarian: isEvent ? (camp.showVegetarianOption !== false ? !!isVegetarian : false) : false,
      privacyConsent: !!privacyConsent,
      emergencyContactName: emergencyContactName || '',
      emergencyContactPhone: emergencyContactPhone || '',
      additionalEmergencyContactName: additionalEmergencyContactName || '',
      additionalEmergencyContactPhone: additionalEmergencyContactPhone || '',
      medicalNotes: medicalNotes || '',
      status: status,
      registeredAt: new Date(),
      // Auto-approval metadata
      approvedBy: isEvent && status === 'confirmed' ? req.user.id : null,
      approvalDate: isEvent && status === 'confirmed' ? new Date() : null
    });

    await registration.save(session ? { session } : {});

    // 5. Recount from actual registrations (drift-proof)
    await Camp.refreshParticipantCount(campId);


    // 6b. Save IBAN to user profile if provided and valid
    if (iban && iban.trim()) {
      const cleanIban = iban.replace(/\s/g, '');
      if (validateIBANFormat(cleanIban)) {
        const StudentPortalUser = (await import('../models/StudentPortalUser.js')).default;
        const encryptedIBAN = encryptIBAN(cleanIban);
        await StudentPortalUser.findByIdAndUpdate(req.user.id, { iban: encryptedIBAN });
      }
    }

    // 7. Commit transaction
    if (session) await session.commitTransaction();

    // 8. Send notification emails to admins (non-blocking)
    try {
      const settings = await Settings.findOne({ singleton: true });
      if (settings && settings.notificationEmails) {
        const emails = [
          settings.notificationEmails.email1,
          settings.notificationEmails.email2,
          settings.notificationEmails.email3
        ].filter(email => email && email.trim());

        if (emails.length > 0) {
          // Populate camp data for email (note: Camp model uses 'title' not 'name')
          const populatedRegistration = await CampRegistration.findById(registration._id)
            .populate('campId', 'title campType startDate endDate location price targetAudience ageMin ageMax skillLevels isWholeDay schedule showAdditionalGuestsOption showBarbecueOption');
          await sendCampRegistrationNotification(populatedRegistration, populatedRegistration.campId, emails);
          logger.info(`Camp registration notification emails sent to ${emails.length} recipient(s)`);
        }
      }
    } catch (emailError) {
      // Log error but don't fail the registration
      logger.error('Error sending camp registration notification email:', emailError);
    }

    // 9. Send notification to student about camp registration
    try {
      const campData = await Camp.findById(campId);
      if (campData) {
        const startDateStr = new Date(campData.startDate).toLocaleDateString('de-DE');
        const endDateStr = new Date(campData.endDate).toLocaleDateString('de-DE');

        let notificationTitle = '';
        let notificationBody = '';

        const additionalText = (isEvent && registration.additionalParticipants > 0) 
          ? ` und ${registration.additionalParticipants} weitere ${registration.additionalParticipants === 1 ? 'Person' : 'Personen'}` 
          : "";

        if (status === 'confirmed') {
          notificationTitle = `Anmeldung bestätigt: ${campData.title}`;
          notificationBody = `Ihre Anmeldung für ${campData.title} (${startDateStr} - ${endDateStr})${additionalText} wurde erfolgreich bestätigt!`;
        } else if (status === 'waitlist') {
          notificationTitle = `Auf Warteliste: ${campData.title}`;
          notificationBody = `Sie wurden auf die Warteliste für ${campData.title} (${startDateStr} - ${endDateStr}) gesetzt. Sie werden benachrichtigt, falls ein Platz frei wird.`;
        } else {
          notificationTitle = `Anmeldung eingegangen: ${campData.title}`;
          notificationBody = `Ihre Anmeldung für ${campData.title} (${startDateStr} - ${endDateStr}) ist eingegangen und wird geprüft.`;
        }

        await createNotification(
          req.user.id,
          'registration_approved',
          notificationTitle,
          notificationBody,
          {
            priority: status === 'confirmed' ? 'high' : 'normal',
            actionUrl: '/dashboard/my-camps',
            metadata: {
              campId: campId,
              registrationId: registration._id,
              status
            }
          }
        );
      }
    } catch (notificationError) {
      logger.error('Error creating notification for camp registration', { error: notificationError.message, stack: notificationError.stack });
      // Don't fail the request if notification fails
    }

    // 10. Send receipt/confirmation email to student (non-blocking)
    try {
      const campData = await Camp.findById(campId);
      if (campData) {
        if (status === 'confirmed') {
          await sendCampConfirmationEmail(registration, campData);
        } else if (status === 'pending') {
          await sendCampRegistrationReceivedEmail(registration, campData);
        }
      }
    } catch (emailError) {
      logger.error('Error sending registration email to student:', emailError);
    }

    const additionalText = (isEvent && registration.additionalParticipants > 0) 
      ? ` und ${registration.additionalParticipants} weitere ${registration.additionalParticipants === 1 ? 'Person' : 'Personen'}` 
      : "";

    res.status(201).json({
      success: true,
      message: status === 'confirmed'
        ? `Ihre Anmeldung für ${camp.title}${additionalText} wurde erfolgreich bestätigt!`
        : (status === 'pending' 
            ? 'Anmeldung eingegangen – wird geprüft. Sie erhalten eine Benachrichtigung sobald sie bestätigt wurde.'
            : 'Sie wurden auf die Warteliste gesetzt'),
      registration: {
        _id: registration._id,
        status: registration.status
      }
    });
  } catch (error) {
    if (session) await session.abortTransaction();
    logger.error("Error registering for camp", { error: error.message, stack: error.stack });

    if (error.message.includes('Notfallkontakt')) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: 'Fehler beim Anmelden'
    });
  } finally {
    if (session) session.endSession();
  }
});

/**
 * DELETE /api/portal/camps/registrations/:id
 * Cancel my registration (with waitlist auto-promotion)
 */
router.delete('/registrations/:id', auditLogMiddleware({ action: 'DELETE', resource: 'CampRegistration' }), async (req, res) => {
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
    const regId = req.params.id;
    const registration = await CampRegistration.findById(regId);

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

    // Check admin-configured cancellation toggle
    if (!camp.cancellationEnabled) {
      if (session) await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: 'Stornierungen sind leider nur bis zu sieben Tage vorher möglich'
      });
    }

    // Check cancellation deadline (7 days before start) — only for confirmed registrations
    // Pending registrations can be cancelled at any time (not yet approved)
    if (registration.status === 'confirmed') {
      const daysUntilStart = Math.ceil((new Date(camp.startDate) - new Date()) / (1000 * 60 * 60 * 24));
      if (daysUntilStart < 7) {
        if (session) await session.abortTransaction();
        return res.status(400).json({
          success: false,
          error: 'Stornierung ist nur bis 7 Tage vor Beginn möglich'
        });
      }
    }

    const wasConfirmedOrPending = ['confirmed', 'pending'].includes(registration.status);
    const now = new Date();

    // 1. Cancel registration (use updateOne to avoid re-validating old documents
    //    that may be missing fields added to the schema after their creation)
    await CampRegistration.updateOne(
      { _id: regId },
      { $set: { status: 'cancelled', cancelledAt: now } }
    );

    // 2. Auto-promote first waitlist participant if a spot opened up
    if (wasConfirmedOrPending) {
      const waitlistRegistration = await CampRegistration.findOne({
        campId: camp._id,
        status: 'waitlist'
      })
      .sort({ registeredAt: 1 }); // Oldest first

      if (waitlistRegistration) {
        await CampRegistration.updateOne(
          { _id: waitlistRegistration._id },
          { $set: { status: 'pending' } }
        );

        logger.info('Auto-promoted waitlist registration to pending (awaiting admin approval)', { registrationId: waitlistRegistration._id });

        // Send notification to promoted user
        try {
          const startDateStr = new Date(camp.startDate).toLocaleDateString('de-DE');
          const endDateStr = new Date(camp.endDate).toLocaleDateString('de-DE');

          await createNotification(
            waitlistRegistration.studentPortalUserId,
            'registration_approved',
            `Platz frei: ${camp.title}`,
            `Ein Platz für ${camp.title} (${startDateStr} - ${endDateStr}) ist frei geworden! Ihre Anmeldung wird nun geprüft und bestätigt.`,
            {
              priority: 'high',
              actionUrl: '/dashboard/my-camps',
              metadata: {
                campId: camp._id,
                registrationId: waitlistRegistration._id,
                promotedFromWaitlist: true
              }
            }
          );
        } catch (notificationError) {
          logger.error('Error creating notification for waitlist promotion', { error: notificationError.message, stack: notificationError.stack });
          // Don't fail the request if notification fails
        }
      }
    }

    // 3. Recount from actual registrations (drift-proof)
    await Camp.refreshParticipantCount(camp._id);

    if (session) await session.commitTransaction();

    // Send notification about cancellation
    try {
      const startDateStr = new Date(camp.startDate).toLocaleDateString('de-DE');
      const endDateStr = new Date(camp.endDate).toLocaleDateString('de-DE');

      await createNotification(
        req.user.id,
        'announcement',
        `${camp.campType === 'event' ? 'Event' : 'Camp'}-Anmeldung storniert: ${camp.title}`,
        `Ihre Anmeldung für ${camp.title} (${startDateStr} - ${endDateStr}) wurde erfolgreich storniert.`,
        {
          priority: 'normal',
          actionUrl: '/dashboard/my-camps',
          metadata: {
            campId: camp._id,
            registrationId: regId,
            cancelled: true
          }
        }
      );
    } catch (notificationError) {
      logger.error('Error creating notification for camp cancellation', { error: notificationError.message, stack: notificationError.stack });
      // Don't fail the request if notification fails
    }

    // Send cancellation emails (student + admin)
    try {
      await sendCampCancellationEmail(registration, camp);

      const settings = await Settings.findOne({ singleton: true });
      if (settings && settings.notificationEmails) {
        const emails = [
          settings.notificationEmails.email1,
          settings.notificationEmails.email2,
          settings.notificationEmails.email3
        ].filter(email => email && email.trim());
        if (emails.length > 0) {
          await sendCampCancellationAdminEmail(registration, camp, emails);
        }
      }
    } catch (emailError) {
      logger.error('Error sending camp cancellation emails', { error: emailError.message, stack: emailError.stack });
      // Don't fail the request if emails fail
    }

    res.json({
      success: true,
      message: 'Anmeldung erfolgreich storniert'
    });
  } catch (error) {
    if (session) await session.abortTransaction();
    logger.error("Error cancelling registration", { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: 'Fehler beim Stornieren der Anmeldung'
    });
  } finally {
    if (session) session.endSession();
  }
});

export default router;
