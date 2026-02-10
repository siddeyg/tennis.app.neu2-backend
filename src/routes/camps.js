/**
 * Camps Routes (Admin)
 *
 * Admin-only API for managing tennis camps and workshops.
 *
 * Endpoints:
 * - GET    /api/camps                           - List all camps
 * - GET    /api/camps/:id                       - Get single camp
 * - POST   /api/camps                           - Create new camp
 * - PUT    /api/camps/:id                       - Update camp
 * - DELETE /api/camps/:id                       - Soft delete camp
 * - POST   /api/camps/:id/open                  - Open registration
 * - POST   /api/camps/:id/close                 - Close registration
 * - GET    /api/camps/:id/registrations         - View all participants
 * - DELETE /api/camps/:id/registrations/:regId  - Cancel participant registration
 * - GET    /api/camps/:id/export/csv            - Export participants to CSV
 */

import express from 'express';
import Camp from '../models/Camp.js';
import CampRegistration from '../models/CampRegistration.js';
import requireAuth from '../middleware/requireAuth.js';
import requireRole from '../middleware/requireRole.js';
import mongoose from 'mongoose';
import logger from '../utils/logger.js';
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
 * GET /api/camps
 * List all camps with filters
 *
 * Query params:
 * - status: filter by status (draft, open, full, closed, cancelled, completed)
 * - upcoming: true/false (filter by startDate > now)
 */
router.get('/', async (req, res) => {
  try {
    const { status, upcoming } = req.query;

    // Build filter
    const filter = { deletedAt: null }; // Exclude soft-deleted camps
    if (status) filter.status = status;
    if (upcoming === 'true') {
      filter.startDate = { $gte: new Date() };
    } else if (upcoming === 'false') {
      filter.startDate = { $lt: new Date() };
    }

    const camps = await Camp.find(filter)
      .populate('createdBy', 'firstName lastName email')
      .populate('trainerId', 'name')
      .sort({ startDate: -1 }); // Newest first

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
 * GET /api/camps/:id
 * Get single camp with full details
 */
router.get('/:id', async (req, res) => {
  try {
    const camp = await Camp.findById(req.params.id)
      .populate('createdBy', 'firstName lastName email')
      .populate('trainerId', 'name');

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
    logger.error("Error fetching camp", { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: 'Fehler beim Laden des Camps'
    });
  }
});

/**
 * POST /api/camps
 * Create new camp
 *
 * Body: Camp fields
 */
router.post('/', auditLogMiddleware({ action: 'CREATE', resource: 'Camp' }), async (req, res) => {
  try {
    const {
      title,
      description,
      campType,
      schedule,
      startDate,
      endDate,
      registrationOpenDate,
      registrationCloseDate,
      maxParticipants,
      waitlistEnabled,
      maxWaitlist,
      targetAudience,
      minAge,
      maxAge,
      skillLevels,
      trainerId,
      trainerName
    } = req.body;

    // Validation
    if (!title || !description || !schedule || schedule.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Titel, Beschreibung und Trainingsplan sind erforderlich'
      });
    }

    if (!startDate || !endDate || !registrationOpenDate || !registrationCloseDate) {
      return res.status(400).json({
        success: false,
        error: 'Alle Datumsfelder sind erforderlich'
      });
    }

    if (!maxParticipants || maxParticipants < 1) {
      return res.status(400).json({
        success: false,
        error: 'Maximale Teilnehmerzahl muss mindestens 1 sein'
      });
    }

    // Create camp
    const camp = new Camp({
      title,
      description,
      campType: campType || 'other',
      schedule,
      startDate,
      endDate,
      registrationOpenDate,
      registrationCloseDate,
      maxParticipants,
      waitlistEnabled: waitlistEnabled || false,
      maxWaitlist: maxWaitlist || 0,
      targetAudience: targetAudience || 'all',
      minAge: minAge || null,
      maxAge: maxAge || null,
      skillLevels: skillLevels || [],
      trainerId: trainerId || null,
      trainerName: trainerName || '',
      status: 'draft',
      createdBy: req.user._id
    });

    await camp.save();

    // Populate for response
    await camp.populate('createdBy', 'firstName lastName email');
    await camp.populate('trainerId', 'name');

    res.status(201).json({
      success: true,
      message: 'Camp erfolgreich erstellt',
      camp
    });
  } catch (error) {
    logger.error("Error creating camp", { error: error.message, stack: error.stack });
    if (error.message.includes('Datum')) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
    res.status(500).json({
      success: false,
      error: 'Fehler beim Erstellen des Camps'
    });
  }
});

/**
 * PUT /api/camps/:id
 * Update camp
 */
router.put('/:id', auditLogMiddleware({ action: 'UPDATE', resource: 'Camp' }), async (req, res) => {
  try {
    const camp = await Camp.findById(req.params.id);

    if (!camp || camp.deletedAt) {
      return res.status(404).json({
        success: false,
        error: 'Camp nicht gefunden'
      });
    }

    // Capture BEFORE state
    const beforeState = camp.toObject();

    // Update allowed fields
    const allowedFields = [
      'title', 'description', 'campType', 'schedule',
      'startDate', 'endDate', 'registrationOpenDate', 'registrationCloseDate',
      'maxParticipants', 'waitlistEnabled', 'maxWaitlist',
      'targetAudience', 'minAge', 'maxAge', 'skillLevels',
      'trainerId', 'trainerName'
    ];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        camp[field] = req.body[field];
      }
    });

    await camp.save();

    // Populate for response
    await camp.populate('createdBy', 'firstName lastName email');
    await camp.populate('trainerId', 'name');

    // Attach before/after to req for audit log
    const afterState = camp.toObject();
    req.auditMetadata = {
      before: beforeState,
      after: afterState,
      changes: getChangedFields(beforeState, afterState)
    };

    res.json({
      success: true,
      message: 'Camp erfolgreich aktualisiert',
      camp
    });
  } catch (error) {
    logger.error("Error updating camp", { error: error.message, stack: error.stack });
    if (error.message.includes('Datum')) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
    res.status(500).json({
      success: false,
      error: 'Fehler beim Aktualisieren des Camps'
    });
  }
});

/**
 * DELETE /api/camps/:id
 * Soft delete camp
 */
router.delete('/:id', auditLogMiddleware({ action: 'DELETE', resource: 'Camp' }), async (req, res) => {
  try {
    const camp = await Camp.findById(req.params.id);

    if (!camp || camp.deletedAt) {
      return res.status(404).json({
        success: false,
        error: 'Camp nicht gefunden'
      });
    }

    // Check if camp has registrations
    const registrationsCount = await CampRegistration.countDocuments({
      campId: camp._id,
      status: { $in: ['confirmed', 'waitlist'] }
    });

    if (registrationsCount > 0) {
      return res.status(400).json({
        success: false,
        error: `Camp kann nicht gelöscht werden - ${registrationsCount} aktive Anmeldungen vorhanden`
      });
    }

    // Soft delete
    camp.deletedAt = new Date();
    await camp.save();

    res.json({
      success: true,
      message: 'Camp erfolgreich gelöscht'
    });
  } catch (error) {
    logger.error("Error deleting camp", { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: 'Fehler beim Löschen des Camps'
    });
  }
});

/**
 * POST /api/camps/:id/open
 * Open registration (draft → open)
 */
router.post('/:id/open', auditLogMiddleware({ action: 'UPDATE', resource: 'Camp', metadata: { operation: 'OPEN_REGISTRATION' } }), async (req, res) => {
  try {
    const camp = await Camp.findById(req.params.id);

    if (!camp || camp.deletedAt) {
      return res.status(404).json({
        success: false,
        error: 'Camp nicht gefunden'
      });
    }

    // Validation
    const now = new Date();
    if (camp.registrationOpenDate > now) {
      return res.status(400).json({
        success: false,
        error: 'Anmeldung kann erst ab dem Anmeldeöffnungsdatum geöffnet werden'
      });
    }

    if (camp.status !== 'draft' && camp.status !== 'closed') {
      return res.status(400).json({
        success: false,
        error: 'Nur Entwürfe oder geschlossene Camps können geöffnet werden'
      });
    }

    camp.status = 'open';
    await camp.save();

    res.json({
      success: true,
      message: 'Anmeldung erfolgreich geöffnet',
      camp
    });
  } catch (error) {
    logger.error("Error opening camp", { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: 'Fehler beim Öffnen der Anmeldung'
    });
  }
});

/**
 * POST /api/camps/:id/close
 * Close registration (open → closed)
 */
router.post('/:id/close', auditLogMiddleware({ action: 'UPDATE', resource: 'Camp', metadata: { operation: 'CLOSE_REGISTRATION' } }), async (req, res) => {
  try {
    const camp = await Camp.findById(req.params.id);

    if (!camp || camp.deletedAt) {
      return res.status(404).json({
        success: false,
        error: 'Camp nicht gefunden'
      });
    }

    if (camp.status !== 'open' && camp.status !== 'full') {
      return res.status(400).json({
        success: false,
        error: 'Nur offene Camps können geschlossen werden'
      });
    }

    camp.status = 'closed';
    await camp.save();

    res.json({
      success: true,
      message: 'Anmeldung erfolgreich geschlossen',
      camp
    });
  } catch (error) {
    logger.error("Error closing camp", { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: 'Fehler beim Schließen der Anmeldung'
    });
  }
});

/**
 * GET /api/camps/:id/registrations
 * View all participants for a camp
 */
router.get('/:id/registrations', async (req, res) => {
  try {
    const campId = req.params.id;
    const camp = await Camp.findById(campId);

    if (!camp || camp.deletedAt) {
      return res.status(404).json({
        success: false,
        error: 'Camp nicht gefunden'
      });
    }

    // Get all registrations (confirmed + waitlist, exclude cancelled)
    const registrations = await CampRegistration.find({
      campId: campId,
      status: { $in: ['confirmed', 'waitlist'] }
    })
    .populate('studentPortalUserId', 'firstName lastName email iban')
    .sort({ status: 1, registeredAt: 1 }); // Confirmed first, then waitlist (FIFO)

    // Add IBAN last 3 digits to each registration
    const { getIBANLast3 } = await import('../utils/encryption.js');
    const enrichedRegistrations = registrations.map(reg => {
      const regObj = reg.toObject();
      // Get IBAN from populated user profile
      if (regObj.studentPortalUserId && regObj.studentPortalUserId.iban) {
        regObj.ibanLast3 = getIBANLast3(regObj.studentPortalUserId.iban, true);
      } else {
        regObj.ibanLast3 = null;
      }
      return regObj;
    });

    // Separate confirmed and waitlist
    const confirmed = enrichedRegistrations.filter(r => r.status === 'confirmed');
    const waitlist = enrichedRegistrations.filter(r => r.status === 'waitlist');

    res.json({
      success: true,
      camp: {
        _id: camp._id,
        title: camp.title,
        maxParticipants: camp.maxParticipants,
        currentParticipants: camp.currentParticipants
      },
      registrations: {
        confirmed,
        waitlist,
        total: enrichedRegistrations.length
      }
    });
  } catch (error) {
    logger.error("Error fetching registrations", { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: 'Fehler beim Laden der Teilnehmer'
    });
  }
});

/**
 * DELETE /api/camps/:id/registrations/:regId
 * Cancel participant registration (admin action)
 */
router.delete('/:id/registrations/:regId', auditLogMiddleware({ action: 'DELETE', resource: 'CampRegistration' }), async (req, res) => {
  // Check if transactions are supported (replica set/mongos only)
  // Respect USE_TRANSACTIONS setting (false for standalone MongoDB)
  const useTransactions = process.env.USE_TRANSACTIONS === 'true';

  let session = null;
  if (useTransactions) {
    session = await mongoose.startSession();
    await session.startTransaction();
  }

  try {
    const campId = req.params.id;
    const camp = await Camp.findById(campId);

    if (!camp || camp.deletedAt) {
      if (session) await session.abortTransaction();
      return res.status(404).json({
        success: false,
        error: 'Camp nicht gefunden'
      });
    }

    // Find registration
    const regId = req.params.regId;
    const registration = await CampRegistration.findById(regId);

    if (!registration) {
      if (session) await session.abortTransaction();
      return res.status(404).json({
        success: false,
        error: 'Anmeldung nicht gefunden'
      });
    }

    // Verify registration belongs to this camp
    if (registration.campId.toString() !== campId.toString()) {
      if (session) await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: 'Anmeldung gehört nicht zu diesem Camp'
      });
    }

    const wasConfirmed = registration.status === 'confirmed';

    // Cancel registration
    registration.status = 'cancelled';
    registration.cancelledAt = new Date();
    await registration.save(session ? { session } : {});

    // Decrement counter if was confirmed
    if (wasConfirmed) {
      camp.currentParticipants = Math.max(0, camp.currentParticipants - 1);
      await camp.save(session ? { session } : {});

      // Auto-promote first waitlist participant (FIFO)
      const waitlistRegistration = await CampRegistration.findOne({
        campId: campId,
        status: 'waitlist'
      })
      .sort({ registeredAt: 1 }); // Oldest first

      if (waitlistRegistration) {
        // Promote to confirmed
        waitlistRegistration.status = 'confirmed';
        await waitlistRegistration.save(session ? { session } : {});

        // Increment counter
        camp.currentParticipants += 1;
        await camp.save(session ? { session } : {});

        // TODO: Send email notification to promoted user
      }
    }

    if (session) await session.commitTransaction();

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

/**
 * GET /api/camps/:id/export/csv
 * Export participants to CSV
 */
router.get('/:id/export/csv', async (req, res) => {
  try {
    const campId = req.params.id;
    const camp = await Camp.findById(campId);

    if (!camp || camp.deletedAt) {
      return res.status(404).json({
        success: false,
        error: 'Camp nicht gefunden'
      });
    }

    // Get all registrations (confirmed first, then waitlist)
    const registrations = await CampRegistration.find({
      campId: campId,
      status: { $in: ['confirmed', 'waitlist'] }
    })
    .populate('studentPortalUserId', 'iban')
    .sort({ status: 1, registeredAt: 1 });

    // Get IBAN decryption helper for CSV export (admin needs full IBAN for SEPA payments)
    const { decryptIBAN } = await import('../utils/encryption.js');

    // Build CSV with UTF-8 BOM
    const BOM = '\uFEFF';
    const headers = 'Status,Name,Geburtsdatum,Alter,Email,Telefon,IBAN,Skill Level,Mannschaft,Notfallkontakt,Notfalltelefon,Medizinische Hinweise,Anmeldedatum\n';

    const rows = registrations.map(reg => {
      const status = reg.status === 'confirmed' ? 'Bestätigt' : 'Warteliste';
      const name = `${reg.firstName} ${reg.lastName}`;
      const birthdate = reg.birthdate.toISOString().split('T')[0];
      const age = reg.age;
      const email = reg.email;
      const phone = reg.phone || '';
      const iban = reg.studentPortalUserId && reg.studentPortalUserId.iban
        ? decryptIBAN(reg.studentPortalUserId.iban)
        : '';
      const skillLevel = reg.skillLevel;
      const team = reg.team ? 'Mannschaft' : 'Hobby';
      const emergencyName = reg.emergencyContactName || '';
      const emergencyPhone = reg.emergencyContactPhone || '';
      const medicalNotes = (reg.medicalNotes || '').replace(/,/g, ';').replace(/\n/g, ' ');
      const registeredAt = reg.registeredAt.toISOString().split('T')[0];

      return `${status},"${name}",${birthdate},${age},"${email}","${phone}","${iban}",${skillLevel},${team},"${emergencyName}","${emergencyPhone}","${medicalNotes}",${registeredAt}`;
    }).join('\n');

    const csv = BOM + headers + rows;

    // Set headers for download
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="camp-${campId}-teilnehmer.csv"`);
    res.send(csv);
  } catch (error) {
    logger.error("Error exporting CSV", { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: 'Fehler beim Exportieren der CSV'
    });
  }
});

export default router;
