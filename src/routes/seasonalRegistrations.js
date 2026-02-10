/**
 * Seasonal Registrations Routes
 *
 * Admin routes for managing seasonal registration submissions.
 *
 * Admin Endpoints:
 * - GET    /api/seasonal-registrations           - List all submissions
 * - GET    /api/seasonal-registrations/:id       - Get specific submission
 * - PUT    /api/seasonal-registrations/:id       - Update submission
 * - DELETE /api/seasonal-registrations/:id       - Delete submission
 * - POST   /api/seasonal-registrations/:id/process - Process single submission
 * - POST   /api/seasonal-registrations/:id/reject  - Reject submission
 */

import express from 'express';
import SeasonalRegistration from '../models/SeasonalRegistration.js';
import RegistrationPeriod from '../models/RegistrationPeriod.js';
import Student from '../models/Student.js';
import requireAuth from '../middleware/requireAuth.js';
import requireRole from '../middleware/requireRole.js';
import logger from '../utils/logger.js';
import { encryptIBAN, decryptIBAN, maskIBAN, validateIBANFormat } from '../utils/encryption.js';
import auditLogMiddleware from '../middleware/auditLog.js';

const router = express.Router();

// Helper function to identify changed fields
function getChangedFields(before, after) {
  const changes = {};
  for (const key in after) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = {
        old: before[key],
        new: after[key]
      };
    }
  }
  return changes;
}

// All routes require admin authentication
router.use(requireAuth);
router.use(requireRole(['admin']));

/**
 * GET /api/seasonal-registrations
 * List all seasonal registrations
 *
 * Query params:
 * - periodId: filter by period
 * - status: filter by status (pending, processed, rejected)
 * - formType: filter by form type (kids, adults)
 */
router.get('/', async (req, res) => {
  try {
    const { periodId, status, formType } = req.query;

    // Build filter
    const filter = {};
    if (periodId) filter.periodId = periodId;
    if (status) filter.status = status;
    if (formType) filter.formType = formType;

    const registrations = await SeasonalRegistration.find(filter)
      .populate('periodId', 'name season')
      .populate('studentPortalUserId', 'email familyMembers')
      .populate('studentId', 'firstName lastName')
      .populate('processedBy', 'firstName lastName')
      .sort({ createdAt: -1 });

    // Mask IBAN in response
    const sanitizedRegistrations = registrations.map(reg => {
      const obj = reg.toObject();
      if (obj.iban) {
        obj.ibanMasked = maskIBAN(obj.iban, true);
        delete obj.iban; // Don't send full encrypted IBAN to frontend
      }
      return obj;
    });

    logger.info(`Listed ${registrations.length} seasonal registrations`, {
      userId: req.user.id,
      filter
    });

    res.json({
      success: true,
      count: registrations.length,
      registrations: sanitizedRegistrations
    });
  } catch (error) {
    logger.error('Error listing seasonal registrations:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Abrufen der Anmeldungen'
    });
  }
});

/**
 * GET /api/seasonal-registrations/:id
 * Get specific seasonal registration with full details
 */
router.get('/:id', async (req, res) => {
  try {
    const registration = await SeasonalRegistration.findById(req.params.id)
      .populate('periodId', 'name season trainingStartDate trainingEndDate')
      .populate('studentPortalUserId', 'email familyMembers')
      .populate('studentId', 'firstName lastName email phone')
      .populate('processedBy', 'firstName lastName');

    if (!registration) {
      return res.status(404).json({
        success: false,
        error: 'Anmeldung nicht gefunden'
      });
    }

    const obj = registration.toObject();

    // Decrypt IBAN for admin view (show last 4 + allow full view on request)
    if (obj.iban) {
      obj.ibanMasked = maskIBAN(obj.iban, true);
      obj.ibanFull = decryptIBAN(obj.iban); // Admin can see full IBAN
    }

    res.json({
      success: true,
      registration: obj
    });
  } catch (error) {
    logger.error('Error fetching seasonal registration:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Abrufen der Anmeldung'
    });
  }
});

/**
 * PUT /api/seasonal-registrations/:id
 * Update seasonal registration
 *
 * Admins can edit submissions before processing
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

    // Don't allow editing processed/rejected submissions
    if (registration.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Verarbeitete oder abgelehnte Anmeldungen können nicht bearbeitet werden'
      });
    }

    // Capture BEFORE state
    const beforeState = registration.toObject();

    const {
      firstName,
      lastName,
      birthdate,
      email,
      phone,
      address,
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

    // Update basic fields
    if (firstName) registration.firstName = firstName;
    if (lastName) registration.lastName = lastName;
    if (birthdate) registration.birthdate = new Date(birthdate);
    if (email) registration.email = email;
    if (phone) registration.phone = phone;
    if (address) registration.address = address;

    // Update kids-specific fields
    if (registration.formType === 'kids') {
      if (mitgliedsstatus) registration.mitgliedsstatus = mitgliedsstatus;
      if (trainingsart) registration.trainingsart = trainingsart;
      if (trainingshäufigkeit) registration.trainingshäufigkeit = trainingshäufigkeit;
      if (teamParticipation !== undefined) registration.teamParticipation = teamParticipation;
      if (availableTimesKids) registration.availableTimesKids = availableTimesKids;
    }

    // Update adults-specific fields
    if (registration.formType === 'adults') {
      if (spielstärke) registration.spielstärke = spielstärke;
      if (trainingGoals) registration.trainingGoals = trainingGoals;
      if (groupSize) registration.groupSize = groupSize;
      if (availableTimesAdults) registration.availableTimesAdults = availableTimesAdults;
    }

    // Update SEPA fields
    if (sepaMandate !== undefined) registration.sepaMandate = sepaMandate;
    if (accountHolder) registration.accountHolder = accountHolder;
    if (iban) {
      // Validate and encrypt IBAN
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

    // Attach before/after to req for audit log
    const afterState = registration.toObject();
    req.auditMetadata = {
      before: beforeState,
      after: afterState,
      changes: getChangedFields(beforeState, afterState)
    };

    res.json({
      success: true,
      message: 'Anmeldung erfolgreich aktualisiert',
      registration
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
 * DELETE /api/seasonal-registrations/:id
 * Delete seasonal registration
 *
 * Only allows deletion of pending submissions
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

    // Only allow deleting pending submissions
    if (registration.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Nur ausstehende Anmeldungen können gelöscht werden'
      });
    }

    await registration.deleteOne();

    logger.info('Seasonal registration deleted', {
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

/**
 * POST /api/seasonal-registrations/:id/process
 * Process single seasonal registration
 *
 * Creates or updates Student record and marks submission as processed
 */
router.post('/:id/process', auditLogMiddleware({ action: 'UPDATE', resource: 'SeasonalRegistration', metadata: { operation: 'PROCESS' } }), async (req, res) => {
  try {
    const registration = await SeasonalRegistration.findById(req.params.id);

    if (!registration) {
      return res.status(404).json({
        success: false,
        error: 'Anmeldung nicht gefunden'
      });
    }

    if (registration.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Anmeldung wurde bereits verarbeitet'
      });
    }

    // Check if Student record already exists
    let student;

    if (registration.studentId) {
      student = await Student.findById(registration.studentId);
    } else {
      student = await Student.findOne({ email: registration.email });
    }

    const studentData = {
      firstName: registration.firstName,
      lastName: registration.lastName,
      birthDate: registration.birthdate,
      email: registration.email,
      phone: registration.phone,
      address: registration.address,
      adult: registration.formType === 'adults'
    };

    // Add form-specific fields
    if (registration.formType === 'kids') {
      studentData.trainigGroup = registration.trainingsart;
      studentData.member = registration.mitgliedsstatus === 'Mitglied';
      studentData.team = registration.teamParticipation ? 'Team' : '';
      studentData.frequence = registration.trainingshäufigkeit === '2x pro Woche' ? '2' : '1';
      studentData.availableTimes = registration.availableTimesKids.map(
        t => `${t.day} ${t.hour}`
      );
    } else {
      // Adults
      studentData.skillLevel = registration.spielstärke;
      studentData.member = true; // Assume adults are members
      studentData.sex = ''; // Will be filled by admin or gender detection
      studentData.frequence = '1'; // Default
      studentData.availableTimes = registration.availableTimesAdults.map(
        t => `${t.day} ${t.hour}`
      );
    }

    if (student) {
      // Update existing student
      Object.assign(student, studentData);
      await student.save();
    } else {
      // Create new student
      student = new Student(studentData);
      await student.save();
    }

    // Link submission to student and mark as processed
    registration.studentId = student._id;
    registration.status = 'processed';
    registration.processedAt = new Date();
    registration.processedBy = req.user.id;
    await registration.save();

    logger.info('Seasonal registration processed', {
      registrationId: registration._id,
      studentId: student._id,
      userId: req.user.id
    });

    res.json({
      success: true,
      message: 'Anmeldung erfolgreich verarbeitet',
      registration,
      student
    });
  } catch (error) {
    logger.error('Error processing seasonal registration:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Verarbeiten der Anmeldung'
    });
  }
});

/**
 * POST /api/seasonal-registrations/:id/reject
 * Reject seasonal registration
 *
 * Body:
 * - reason: string - reason for rejection
 */
router.post('/:id/reject', auditLogMiddleware({ action: 'UPDATE', resource: 'SeasonalRegistration', metadata: { operation: 'REJECT' } }), async (req, res) => {
  try {
    const registration = await SeasonalRegistration.findById(req.params.id);

    if (!registration) {
      return res.status(404).json({
        success: false,
        error: 'Anmeldung nicht gefunden'
      });
    }

    if (registration.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Anmeldung wurde bereits verarbeitet'
      });
    }

    const { reason } = req.body;

    registration.status = 'rejected';
    registration.processedAt = new Date();
    registration.processedBy = req.user.id;
    if (reason) {
      registration.remarks = `ABGELEHNT: ${reason}\n\n${registration.remarks || ''}`;
    }

    await registration.save();

    logger.info('Seasonal registration rejected', {
      registrationId: registration._id,
      userId: req.user.id,
      reason
    });

    res.json({
      success: true,
      message: 'Anmeldung abgelehnt',
      registration
    });
  } catch (error) {
    logger.error('Error rejecting seasonal registration:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Ablehnen der Anmeldung'
    });
  }
});

export default router;
