/**
 * Portal Seasonal Registrations Routes
 *
 * Student Portal API for seasonal training registrations.
 * Authenticated students can register for active training periods.
 *
 * Endpoints:
 * - GET    /api/portal/seasonal-registrations/active-period    - Get active registration period
 * - GET    /api/portal/seasonal-registrations/my-registration  - Get current user's registration
 * - POST   /api/portal/seasonal-registrations                  - Submit new registration
 * - PUT    /api/portal/seasonal-registrations/:id              - Update pending registration
 * - DELETE /api/portal/seasonal-registrations/:id              - Delete pending registration
 */

import express from 'express';
import mongoose from 'mongoose';
import RegistrationPeriod from '../models/RegistrationPeriod.js';
import SeasonalRegistration from '../models/SeasonalRegistration.js';
import StudentPortalUser from '../models/StudentPortalUser.js';
import Student from '../models/Student.js';
import Settings from '../models/Settings.js';
import verifyPortalAuth from '../middleware/verifyPortalAuth.js';
import logger from '../utils/logger.js';
import { encryptIBAN, validateIBANFormat } from '../utils/encryption.js';
import { sendSeasonalRegistrationNotification } from '../utils/emailService.js';
import auditLogMiddleware from '../middleware/auditLog.js';

const router = express.Router();

// All routes require portal authentication
// Uses verifyPortalAuth middleware which checks portalAccessToken cookie
router.use(verifyPortalAuth);

/**
 * GET /api/portal/seasonal-registrations/active-period
 * Get active registration period with form configuration
 *
 * Returns null if no active period
 */
router.get('/active-period', async (req, res) => {
  try {
    const period = await RegistrationPeriod.findOne({
      isActive: true,
      status: 'open'
    }).select('-createdBy'); // Don't expose admin user ID

    if (!period) {
      return res.json({
        success: true,
        period: null,
        message: 'Derzeit ist kein Anmeldezeitraum aktiv'
      });
    }

    // Check if registration deadline has passed
    if (new Date() > period.registrationDeadline) {
      return res.json({
        success: true,
        period: null,
        message: 'Die Anmeldefrist ist bereits abgelaufen'
      });
    }

    res.json({
      success: true,
      period
    });
  } catch (error) {
    logger.error('Error fetching active period:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Abrufen des Anmeldezeitraums'
    });
  }
});

/**
 * GET /api/portal/seasonal-registrations/my-registrations
 * Get all registrations for current user (parent + all children) for a period
 *
 * Query params:
 * - periodId: required - get registrations for specific period
 */
router.get('/my-registrations', async (req, res) => {
  try {
    const { periodId } = req.query;

    if (!periodId) {
      return res.status(400).json({
        success: false,
        error: 'periodId ist erforderlich'
      });
    }

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(periodId)) {
      return res.json({
        success: true,
        registrations: [],
        message: 'Ungültige periodId'
      });
    }

    const period = await RegistrationPeriod.findById(periodId);
    if (!period) {
      return res.json({
        success: true,
        registrations: [],
        message: 'Anmeldezeitraum nicht gefunden'
      });
    }

    // Find all registrations for this user and period (parent + children)
    // Exclude rejected registrations (rejected status is deprecated, but filter anyway)
    const registrations = await SeasonalRegistration.find({
      studentPortalUserId: req.user.id,
      periodId: period._id,
      status: { $ne: 'rejected' } // Don't show rejected registrations
    })
      .populate('periodId', 'name season trainingStartDate trainingEndDate')
      .sort({ createdAt: 1 });

    // Get parent user to fetch child names
    const portalUser = await StudentPortalUser.findById(req.user.id);

    // Format registrations with child name
    const formattedRegistrations = registrations.map(reg => {
      const obj = reg.toObject();

      // Remove encrypted IBAN
      delete obj.iban;

      // Add child name if familyMemberId exists
      if (reg.familyMemberId && portalUser) {
        const child = portalUser.familyMembers.id(reg.familyMemberId);
        obj.childName = child
          ? `${child.firstName || ''} ${child.lastName || ''}`.trim()
          : 'Unbekannt';
      } else {
        obj.childName = null; // Parent's own registration
      }

      return obj;
    });

    res.json({
      success: true,
      registrations: formattedRegistrations
    });
  } catch (error) {
    logger.error('Error fetching user registrations:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Abrufen der Anmeldungen'
    });
  }
});

/**
 * GET /api/portal/seasonal-registrations/history
 * Get ALL seasonal registrations for current user across ALL periods
 *
 * Returns full history (not just active period)
 */
router.get('/history', async (req, res) => {
  try {
    // Find all registrations for this user (all periods)
    const registrations = await SeasonalRegistration.find({
      studentPortalUserId: req.user.id,
      status: { $ne: 'rejected' }
    })
      .populate('periodId', 'name season year trainingStartDate trainingEndDate')
      .sort({ createdAt: -1 }); // Newest first

    // Get portal user to fetch child names
    const portalUser = await StudentPortalUser.findById(req.user.id);

    // Format with child names
    const formatted = registrations.map(reg => {
      const obj = reg.toObject();
      delete obj.iban; // Security: never send encrypted IBAN to frontend

      if (reg.familyMemberId && portalUser) {
        const child = portalUser.familyMembers.id(reg.familyMemberId);
        obj.childName = child ? `${child.firstName} ${child.lastName}`.trim() : 'Unbekannt';
      } else {
        obj.childName = null;
      }

      return obj;
    });

    res.json({
      success: true,
      registrations: formatted
    });
  } catch (error) {
    logger.error('Error fetching registration history:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Abrufen der Anmeldungen'
    });
  }
});

/**
 * GET /api/portal/seasonal-registrations/my-registration
 * Get current user's registration for active period
 *
 * Query params:
 * - periodId: optional - get registration for specific period (defaults to active)
 */
router.get('/my-registration', async (req, res) => {
  try {
    const { periodId } = req.query;

    let period;
    if (periodId) {
      period = await RegistrationPeriod.findById(periodId);
    } else {
      period = await RegistrationPeriod.findOne({
        isActive: true,
        status: 'open'
      });
    }

    if (!period) {
      return res.json({
        success: true,
        registration: null,
        message: 'Kein Anmeldezeitraum gefunden'
      });
    }

    // Find registration for this user and period
    const registration = await SeasonalRegistration.findOne({
      studentPortalUserId: req.user.id,
      periodId: period._id
    }).populate('periodId', 'name season trainingStartDate trainingEndDate');

    // Don't send encrypted IBAN to frontend
    if (registration && registration.iban) {
      const obj = registration.toObject();
      delete obj.iban;
      return res.json({
        success: true,
        registration: obj
      });
    }

    res.json({
      success: true,
      registration
    });
  } catch (error) {
    logger.error('Error fetching user registration:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Abrufen der Anmeldung'
    });
  }
});

/**
 * POST /api/portal/seasonal-registrations
 * Submit new registration
 *
 * Body: Registration fields (auto-filled + user-entered)
 */
router.post('/', auditLogMiddleware({ action: 'CREATE', resource: 'SeasonalRegistration' }), async (req, res) => {
  try {
    // Check if user has completed profile (CRITICAL SECURITY CHECK)
    const portalUser = await StudentPortalUser.findById(req.user.id);
    if (!portalUser) {
      return res.status(404).json({
        success: false,
        error: 'Benutzer nicht gefunden'
      });
    }

    if (!portalUser.profileCompleted) {
      return res.status(400).json({
        success: false,
        error: 'Bitte vervollständigen Sie zuerst Ihr Profil',
        requiresProfileCompletion: true
      });
    }

    const {
      periodId,
      formType,
      familyMemberId, // Optional: ID of child in parent's familyMembers array
      // Auto-filled fields (from StudentPortalUser or child)
      firstName,
      lastName,
      birthdate,
      email,
      phone,
      address,
      // Kids-specific
      mitgliedsstatus,
      trainingsart,
      trainingshäufigkeit,
      teamParticipation,
      availableTimesKids,
      // Adults-specific
      spielstärke,
      trainingGoals,
      groupSize,
      availableTimesAdults,
      // SEPA
      sepaMandate,
      accountHolder,
      iban,
      // Privacy & remarks
      privacyConsent,
      remarks
    } = req.body;

    // Validate required fields
    if (!periodId || !formType || !firstName || !lastName || !birthdate || !email || !privacyConsent) {
      return res.status(400).json({
        success: false,
        error: 'Erforderliche Felder fehlen'
      });
    }

    // Check if period exists and is active
    const period = await RegistrationPeriod.findById(periodId);

    if (!period) {
      return res.status(404).json({
        success: false,
        error: 'Anmeldezeitraum nicht gefunden'
      });
    }

    if (!period.isActive || period.status !== 'open') {
      return res.status(400).json({
        success: false,
        error: 'Anmeldungen für diesen Zeitraum sind nicht möglich'
      });
    }

    // Check deadline
    if (new Date() > period.registrationDeadline) {
      return res.status(400).json({
        success: false,
        error: 'Die Anmeldefrist ist bereits abgelaufen'
      });
    }

    // Validate familyMemberId if provided
    let childData = null;
    if (familyMemberId) {
      const child = portalUser.familyMembers.id(familyMemberId);
      if (!child || child.relationship !== 'child') {
        return res.status(400).json({
          success: false,
          error: 'Ungültige familyMemberId'
        });
      }
      childData = child;
    }

    // Check if user already has registration for this period + familyMember combo
    const query = {
      studentPortalUserId: req.user.id,
      periodId: period._id
    };

    if (familyMemberId) {
      query.familyMemberId = familyMemberId;
    } else {
      // For parent's own registration, familyMemberId should be null
      query.familyMemberId = { $exists: false };
    }

    const existingRegistration = await SeasonalRegistration.findOne(query);

    if (existingRegistration) {
      const childName = childData
        ? `${childData.firstName} ${childData.lastName}`
        : 'Sie';
      return res.status(400).json({
        success: false,
        error: `${childName} ${childData ? 'hat' : 'haben'} bereits eine Anmeldung für diesen Zeitraum`
      });
    }

    // Validate form-specific required fields
    if (formType === 'kids') {
      const kidsEnabled = period.kidsFormConfig?.enabledFields || [];
      const kidsRequired = period.kidsFormConfig?.requiredFields || [];

      if (kidsRequired.includes('mitgliedsstatus') && !mitgliedsstatus) {
        return res.status(400).json({ success: false, error: 'Mitgliedsstatus ist erforderlich' });
      }
      if (kidsRequired.includes('trainingsart') && !trainingsart) {
        return res.status(400).json({ success: false, error: 'Trainingsart ist erforderlich' });
      }
      if (kidsRequired.includes('trainingshäufigkeit') && !trainingshäufigkeit) {
        return res.status(400).json({ success: false, error: 'Trainingshäufigkeit ist erforderlich' });
      }
      if (kidsRequired.includes('availableTimesKids') && (!availableTimesKids || availableTimesKids.length === 0)) {
        return res.status(400).json({ success: false, error: 'Verfügbare Zeiten sind erforderlich' });
      }

      // Check minimum 3 distinct days
      if (availableTimesKids) {
        const uniqueDays = new Set(availableTimesKids.map(t => t.day)).size;
        if (uniqueDays < 3) {
          return res.status(400).json({
            success: false,
            error: 'Bitte wählen Sie Zeiten an mindestens 3 verschiedenen Tagen aus'
          });
        }
      }
    } else if (formType === 'adults') {
      const adultsEnabled = period.adultsFormConfig?.enabledFields || [];
      const adultsRequired = period.adultsFormConfig?.requiredFields || [];

      if (adultsRequired.includes('spielstärke') && !spielstärke) {
        return res.status(400).json({ success: false, error: 'Spielstärke ist erforderlich' });
      }
      if (adultsRequired.includes('trainingGoals') && (!trainingGoals || trainingGoals.length === 0)) {
        return res.status(400).json({ success: false, error: 'Trainingsziele sind erforderlich' });
      }
      if (adultsRequired.includes('groupSize') && (!groupSize || groupSize.length === 0)) {
        return res.status(400).json({ success: false, error: 'Gruppengröße ist erforderlich' });
      }
      if (adultsRequired.includes('availableTimesAdults') && (!availableTimesAdults || availableTimesAdults.length === 0)) {
        return res.status(400).json({ success: false, error: 'Verfügbare Zeiten sind erforderlich' });
      }

      // Check minimum 3 distinct days
      if (availableTimesAdults) {
        const uniqueDays = new Set(availableTimesAdults.map(t => t.day)).size;
        if (uniqueDays < 3) {
          return res.status(400).json({
            success: false,
            error: 'Bitte wählen Sie Zeiten an mindestens 3 verschiedenen Tagen aus'
          });
        }
      }
    }

    // Prepare registration data
    // Use child data if familyMemberId provided, otherwise use request data
    const registrationData = {
      periodId: period._id,
      studentPortalUserId: req.user.id,
      formType,
      firstName: childData?.firstName || firstName,
      lastName: childData?.lastName || lastName,
      birthdate: childData?.birthdate ? new Date(childData.birthdate) : new Date(birthdate),
      email: childData ? portalUser.email : email, // Use parent's email for children
      phone: childData?.phone || phone || '',
      address: portalUser.address || address || '',
      privacyConsent,
      remarks: remarks || ''
    };

    // Add familyMemberId if this is a child registration
    if (familyMemberId) {
      registrationData.familyMemberId = familyMemberId;
    }

    // Add form-specific fields
    if (formType === 'kids') {
      registrationData.mitgliedsstatus = mitgliedsstatus;
      registrationData.trainingsart = trainingsart;
      registrationData.trainingshäufigkeit = trainingshäufigkeit;
      registrationData.teamParticipation = teamParticipation || false;
      registrationData.availableTimesKids = availableTimesKids || [];
    } else {
      registrationData.spielstärke = spielstärke;
      registrationData.trainingGoals = trainingGoals || [];
      registrationData.groupSize = groupSize || [];
      registrationData.availableTimesAdults = availableTimesAdults || [];
    }

    // Handle SEPA mandate
    if (sepaMandate && accountHolder && iban) {
      // Validate IBAN format
      if (!validateIBANFormat(iban)) {
        return res.status(400).json({
          success: false,
          error: 'Ungültiges IBAN-Format'
        });
      }

      registrationData.sepaMandate = true;
      registrationData.accountHolder = accountHolder;
      registrationData.iban = encryptIBAN(iban);
    }

    // Create registration
    const registration = new SeasonalRegistration(registrationData);
    await registration.save();

    // Save IBAN to user profile (both StudentPortalUser and Student if exists)
    if (iban && validateIBANFormat(iban)) {
      const encryptedIBAN = encryptIBAN(iban);

      // Always save to StudentPortalUser
      await StudentPortalUser.findByIdAndUpdate(req.user.id, { iban: encryptedIBAN });

      // Also save to Student if user has linked Student record
      if (req.user.studentId) {
        const Student = (await import('../models/Student.js')).default;
        await Student.findByIdAndUpdate(req.user.studentId, { iban: encryptedIBAN });
      }
    }

    // Auto-create Student record
    // For child registrations: check if child already has studentId
    // For parent registrations: check if portalUser already has studentId
    let studentId = null;

    if (familyMemberId && childData) {
      // Check if child already has a Student record
      studentId = childData.studentId;
    } else {
      // Parent's own registration
      studentId = portalUser.studentId;
    }

    if (!studentId) {
      // Create new Student record from registration data
      // Get sex and member from portal user or family member
      let userSex, userMember;
      if (familyMemberId && childData) {
        userSex = childData.sex;
        userMember = childData.member;
      } else {
        userSex = portalUser.sex;
        userMember = portalUser.member;
      }

      const studentData = {
        firstName: (familyMemberId && childData) ? childData.firstName : firstName,
        lastName: (familyMemberId && childData) ? childData.lastName : lastName,
        birthDate: new Date(birthdate).toISOString().split('T')[0], // Format: YYYY-MM-DD
        email: email,
        phone: phone || '',
        adress: address || '',
        comment: remarks || '',
        sex: userSex || '',
        member: userMember || false,
        adult: formType === 'adults',
        frequence: trainingshäufigkeit === '2x pro Woche' ? '2' : '1',
        assignments: [] // Will be assigned during schedule planning
      };

      // Add form-specific fields
      if (formType === 'kids') {
        studentData.team = teamParticipation || false;
        studentData.trainigGroup = trainingsart || ''; // e.g. "Rot", "Orange", "Gelb Team"
        studentData.availableTimes = (availableTimesKids || []).map(t => ({
          day: t.day,
          hour: t.hour,
          venue: t.venue || ''
        }));
      } else {
        // Adults
        studentData.skillLevel = spielstärke || '';
        studentData.comment2 = trainingGoals ? trainingGoals.join(', ') : ''; // Trainingsziele
        studentData.groupSize = groupSize ? groupSize.join(', ') : ''; // Gruppengröße preferences
        studentData.availableTimes = (availableTimesAdults || []).map(t => ({
          day: t.day,
          hour: t.hour,
          venue: t.venue || ''
        }));
      }

      const student = new Student(studentData);
      await student.save();

      studentId = student._id;

      // Link Student to StudentPortalUser or familyMember
      if (familyMemberId && childData) {
        // Link to child's familyMember entry
        childData.studentId = studentId;
        await portalUser.save();

        logger.info('Auto-created Student record from child registration', {
          studentId: studentId,
          portalUserId: req.user.id,
          familyMemberId: familyMemberId,
          childName: `${childData.firstName} ${childData.lastName}`,
          formType
        });
      } else {
        // Link to parent's studentId
        portalUser.studentId = studentId;
        await portalUser.save();

        logger.info('Auto-created Student record from seasonal registration', {
          studentId: studentId,
          portalUserId: req.user.id,
          formType
        });
      }
    }

    // Link registration to student and mark as processed (auto-approved)
    registration.studentId = studentId;
    registration.status = 'processed';
    registration.processedAt = new Date();
    await registration.save();

    logger.info('Seasonal registration created and auto-approved', {
      registrationId: registration._id,
      userId: req.user.id,
      studentId: studentId,
      periodId: period._id,
      formType
    });

    // Send notification emails to admins
    try {
      const settings = await Settings.findOne({ singleton: true });
      if (settings && settings.notificationEmails) {
        const emails = [
          settings.notificationEmails.email1,
          settings.notificationEmails.email2,
          settings.notificationEmails.email3
        ].filter(email => email && email.trim()); // Filter out empty emails

        if (emails.length > 0) {
          // Populate registration with period data for email
          const populatedRegistration = await SeasonalRegistration.findById(registration._id)
            .populate('periodId', 'name season trainingStartDate trainingEndDate');

          await sendSeasonalRegistrationNotification(populatedRegistration, emails);
          logger.info(`Seasonal registration notification emails sent to ${emails.length} recipient(s)`);
        }
      }
    } catch (emailError) {
      // Log error but don't fail the registration
      logger.error('Error sending seasonal registration notification email:', emailError);
    }

    // Don't send encrypted IBAN back
    const responseObj = registration.toObject();
    delete responseObj.iban;

    res.status(201).json({
      success: true,
      message: 'Anmeldung erfolgreich eingereicht',
      registration: responseObj
    });
  } catch (error) {
    logger.error('Error creating seasonal registration:', error);

    // Handle duplicate registration error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'Sie haben bereits eine Anmeldung für diesen Zeitraum'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Fehler beim Einreichen der Anmeldung'
    });
  }
});

/**
 * PUT /api/portal/seasonal-registrations/:id
 * Update pending registration
 *
 * Users can only update their own pending registrations
 */
router.put('/:id', auditLogMiddleware({ action: 'UPDATE', resource: 'SeasonalRegistration' }), async (req, res) => {
  try {
    const registration = await SeasonalRegistration.findById(req.params.id);

    if (!registration) {
      return res.status(404).json({
        success: false,
        error: 'Anmeldung nicht gefunden'
      });
    }

    // Check ownership
    if (registration.studentPortalUserId.toString() !== req.user.id.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Keine Berechtigung'
      });
    }

    // Only allow updating pending registrations
    if (registration.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Nur ausstehende Anmeldungen können bearbeitet werden'
      });
    }

    // Check if registration period is still open
    const period = await RegistrationPeriod.findById(registration.periodId);
    if (!period || !period.isActive || period.status !== 'open') {
      return res.status(400).json({
        success: false,
        error: 'Anmeldungen für diesen Zeitraum sind nicht mehr möglich'
      });
    }

    // Update allowed fields (similar validation as POST)
    const {
      mitgliedsstatus,
      trainingsart,
      trainingshäufigkeit,
      teamParticipation,
      availableTimesKids,
      spielstärke,
      trainingGoals,
      groupSize,
      availableTimesAdults,
      sepaMandate,
      accountHolder,
      iban,
      remarks
    } = req.body;

    // Update form-specific fields
    if (registration.formType === 'kids') {
      if (mitgliedsstatus) registration.mitgliedsstatus = mitgliedsstatus;
      if (trainingsart) registration.trainingsart = trainingsart;
      if (trainingshäufigkeit) registration.trainingshäufigkeit = trainingshäufigkeit;
      if (teamParticipation !== undefined) registration.teamParticipation = teamParticipation;
      if (availableTimesKids) {
        if (availableTimesKids.length < 5) {
          return res.status(400).json({
            success: false,
            error: 'Bitte wählen Sie mindestens 5 verfügbare Zeiten aus'
          });
        }
        registration.availableTimesKids = availableTimesKids;
      }
    } else {
      if (spielstärke) registration.spielstärke = spielstärke;
      if (trainingGoals) registration.trainingGoals = trainingGoals;
      if (groupSize) registration.groupSize = groupSize;
      if (availableTimesAdults) {
        if (availableTimesAdults.length < 5) {
          return res.status(400).json({
            success: false,
            error: 'Bitte wählen Sie mindestens 5 verfügbare Zeiten aus'
          });
        }
        registration.availableTimesAdults = availableTimesAdults;
      }
    }

    // Update SEPA fields
    if (sepaMandate !== undefined) registration.sepaMandate = sepaMandate;
    if (accountHolder) registration.accountHolder = accountHolder;
    if (iban) {
      if (!validateIBANFormat(iban)) {
        return res.status(400).json({
          success: false,
          error: 'Ungültiges IBAN-Format'
        });
      }
      registration.iban = encryptIBAN(iban);
    }

    if (remarks !== undefined) registration.remarks = remarks;

    await registration.save();

    logger.info('Seasonal registration updated', {
      registrationId: registration._id,
      userId: req.user.id
    });

    // Don't send encrypted IBAN back
    const responseObj = registration.toObject();
    delete responseObj.iban;

    res.json({
      success: true,
      message: 'Anmeldung erfolgreich aktualisiert',
      registration: responseObj
    });
  } catch (error) {
    logger.error('Error updating seasonal registration:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Aktualisieren der Anmeldung'
    });
  }
});

/**
 * DELETE /api/portal/seasonal-registrations/:id
 * Delete pending registration
 *
 * Users can only delete their own pending registrations
 */
router.delete('/:id', auditLogMiddleware({ action: 'DELETE', resource: 'SeasonalRegistration' }), async (req, res) => {
  try {
    const registration = await SeasonalRegistration.findById(req.params.id);

    if (!registration) {
      return res.status(404).json({
        success: false,
        error: 'Anmeldung nicht gefunden'
      });
    }

    // Check ownership
    if (registration.studentPortalUserId.toString() !== req.user.id.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Keine Berechtigung'
      });
    }

    // Only allow deleting pending registrations
    if (registration.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Nur ausstehende Anmeldungen können gelöscht werden'
      });
    }

    await registration.deleteOne();

    logger.info('Seasonal registration deleted by user', {
      registrationId: registration._id,
      userId: req.user.id
    });

    res.json({
      success: true,
      message: 'Anmeldung erfolgreich gelöscht'
    });
  } catch (error) {
    logger.error('Error deleting seasonal registration:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Löschen der Anmeldung'
    });
  }
});

export default router;
