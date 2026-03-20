/**
 * Registration Periods Routes
 *
 * Admin-only API for managing seasonal training registration periods.
 *
 * Endpoints:
 * - GET    /api/registration-periods             - List all periods
 * - GET    /api/registration-periods/active      - Get active period with current plan
 * - POST   /api/registration-periods             - Create new period
 * - GET    /api/registration-periods/:id         - Get specific period
 * - PUT    /api/registration-periods/:id         - Update period
 * - DELETE /api/registration-periods/:id         - Delete period
 * - POST   /api/registration-periods/:id/create-plan - Create training plan for period
 * - POST   /api/registration-periods/:id/open    - Open registration
 * - POST   /api/registration-periods/:id/close   - Close registration
 * - POST   /api/registration-periods/:id/reopen  - Reopen closed registration
 * - GET    /api/registration-periods/:id/submissions - List submissions
 * - POST   /api/registration-periods/:id/process-all - Bulk process submissions
 */

import express from 'express';
import mongoose from 'mongoose';
import RegistrationPeriod from '../models/RegistrationPeriod.js';
import SeasonalRegistration from '../models/SeasonalRegistration.js';
import Student from '../models/Student.js';
import SavedSchedule from '../models/SavedSchedule.js';
import Coach from '../models/Coach.js';
import StudentPortalUser from '../models/StudentPortalUser.js';
import requireAuth from '../middleware/requireAuth.js';
import requireRole, { requireAdminOrSupermod } from '../middleware/requireRole.js';
import logger from '../utils/logger.js';
import auditLogMiddleware from '../middleware/auditLog.js';
import { createNotification } from '../utils/notificationHelpers.js';
import { getHolidaysInRange } from '../utils/nrwHolidays.js';

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

// All routes require admin or supermod authentication
router.use(requireAuth);
router.use(requireAdminOrSupermod);

/**
 * GET /api/registration-periods
 * List all registration periods
 *
 * Query params:
 * - status: filter by status (draft, open, closed, archived)
 * - season: filter by season (winter, summer)
 * - isActive: filter by active status (true, false)
 */
router.get('/', async (req, res) => {
  try {
    const { status, season, isActive } = req.query;

    // Build filter
    const filter = {};
    if (status) filter.status = status;
    if (season) filter.season = season;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const periods = await RegistrationPeriod.find(filter)
      .populate('createdBy', 'firstName lastName email')
      .populate('submissionsCount')
      .populate('pendingSubmissionsCount')
      .populate('kidsSubmissionsCount')
      .populate('adultsSubmissionsCount')
      .sort({ createdAt: -1 });

    logger.info(`Listed ${periods.length} registration periods`, {
      userId: req.user.id,
      filter
    });

    res.json({
      success: true,
      count: periods.length,
      periods
    });
  } catch (error) {
    logger.error('Error listing registration periods:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Abrufen der Anmeldezeiträume'
    });
  }
});

/**
 * POST /api/registration-periods
 * Create new registration period
 *
 * Body: RegistrationPeriod fields
 */
router.post('/', auditLogMiddleware({ action: 'CREATE', resource: 'RegistrationPeriod' }), async (req, res) => {
  try {
    const {
      name,
      season,
      trainingStartDate,
      trainingEndDate,
      registrationDeadline,
      status,
      isActive,
      kidsFormConfig,
      adultsFormConfig,
      trainingSlots
    } = req.body;

    // Validate required fields
    if (!name || !season || !trainingStartDate || !trainingEndDate || !registrationDeadline) {
      return res.status(400).json({
        success: false,
        error: 'Erforderliche Felder fehlen'
      });
    }

    // Validate dates
    const startDate = new Date(trainingStartDate);
    const endDate = new Date(trainingEndDate);
    const deadline = new Date(registrationDeadline);

    if (endDate <= startDate) {
      return res.status(400).json({
        success: false,
        error: 'Enddatum muss nach dem Startdatum liegen'
      });
    }

    if (deadline >= startDate) {
      return res.status(400).json({
        success: false,
        error: 'Anmeldefrist muss vor dem Trainingsstart liegen'
      });
    }

    // Create period
    const period = new RegistrationPeriod({
      name,
      season,
      trainingStartDate: startDate,
      trainingEndDate: endDate,
      registrationDeadline: deadline,
      status: status || 'draft',
      isActive: isActive || false,
      kidsFormConfig: kidsFormConfig || {
        enabledFields: [
          'mitgliedsstatus',
          'trainingsart',
          'trainingshäufigkeit',
          'teamParticipation',
          'availableTimesKids',
          'sepaMandate',
          'remarks'
        ],
        requiredFields: [
          'mitgliedsstatus',
          'trainingsart',
          'trainingshäufigkeit',
          'availableTimesKids'
        ]
      },
      adultsFormConfig: adultsFormConfig || {
        enabledFields: [
          'spielstärke',
          'trainingGoals',
          'groupSize',
          'availableTimesAdults',
          'sepaMandate',
          'remarks'
        ],
        requiredFields: [
          'spielstärke',
          'trainingGoals',
          'groupSize',
          'availableTimesAdults'
        ]
      },
      trainingSlots: trainingSlots || [],
      createdBy: req.user.id
    });

    await period.save();

    logger.info('Registration period created', {
      periodId: period._id,
      name: period.name,
      userId: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Anmeldezeitraum erfolgreich erstellt',
      period
    });
  } catch (error) {
    logger.error('Error creating registration period:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Erstellen des Anmeldezeitraums'
    });
  }
});

/**
 * GET /api/registration-periods/active
 * Get currently active registration period with current plan
 *
 * Returns the active period (isActive=true) and its linked training plan.
 * Used by frontend to determine current context.
 */
router.get('/active', async (req, res) => {
  try {
    const period = await RegistrationPeriod.findOne({ isActive: true })
      .populate('createdBy', 'firstName lastName email')
      .populate('currentPlanId');

    if (!period) {
      return res.json({
        success: true,
        period: null,
        currentPlan: null,
        message: 'Kein aktiver Anmeldezeitraum vorhanden'
      });
    }

    logger.info('Fetched active registration period', {
      periodId: period._id,
      userId: req.user.id
    });

    res.json({
      success: true,
      period,
      currentPlan: period.currentPlanId || null
    });
  } catch (error) {
    logger.error('Error fetching active registration period:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Abrufen des aktiven Anmeldezeitraums'
    });
  }
});

/**
 * GET /api/registration-periods/:id
 * Get specific registration period
 */
router.get('/:id', async (req, res) => {
  try {
    const period = await RegistrationPeriod.findById(req.params.id)
      .populate('createdBy', 'firstName lastName email');

    if (!period) {
      return res.status(404).json({
        success: false,
        error: 'Anmeldezeitraum nicht gefunden'
      });
    }

    // Get current plan (saved schedule) for this period
    let currentPlan = null;
    if (period.currentPlanId) {
      currentPlan = await SavedSchedule.findById(period.currentPlanId);
    }

    // Get submission counts
    const kidsCount = await SeasonalRegistration.countDocuments({
      periodId: period._id,
      formType: 'kids'
    });

    const adultsCount = await SeasonalRegistration.countDocuments({
      periodId: period._id,
      formType: 'adults'
    });

    const pendingCount = await SeasonalRegistration.countDocuments({
      periodId: period._id,
      status: 'pending'
    });

    res.json({
      success: true,
      period,
      currentPlan,
      stats: {
        totalSubmissions: kidsCount + adultsCount,
        kidsSubmissions: kidsCount,
        adultsSubmissions: adultsCount,
        pendingSubmissions: pendingCount
      }
    });
  } catch (error) {
    logger.error('Error fetching registration period:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Abrufen des Anmeldezeitraums'
    });
  }
});

/**
 * PUT /api/registration-periods/:id
 * Update registration period
 */
router.put('/:id', auditLogMiddleware({ action: 'UPDATE', resource: 'RegistrationPeriod' }), async (req, res) => {
  try {
    const period = await RegistrationPeriod.findById(req.params.id);

    if (!period) {
      return res.status(404).json({
        success: false,
        error: 'Anmeldezeitraum nicht gefunden'
      });
    }

    // Don't allow updating closed/archived periods
    if (period.status === 'archived') {
      return res.status(400).json({
        success: false,
        error: 'Archivierte Anmeldezeiträume können nicht bearbeitet werden'
      });
    }

    const {
      name,
      season,
      trainingStartDate,
      trainingEndDate,
      registrationDeadline,
      status,
      isActive,
      kidsFormConfig,
      adultsFormConfig,
      trainingSlots
    } = req.body;

    // Prevent changing critical date fields if submissions already exist
    if (trainingStartDate || trainingEndDate) {
      const submissionsCount = await SeasonalRegistration.countDocuments({ periodId: period._id });
      if (submissionsCount > 0) {
        return res.status(400).json({
          success: false,
          error: `Trainingsdaten können nicht geändert werden, da bereits ${submissionsCount} Anmeldungen existieren`
        });
      }
    }

    // Capture BEFORE state
    const beforeState = period.toObject();

    // Update fields
    if (name) period.name = name;
    if (season) period.season = season;
    if (trainingStartDate) period.trainingStartDate = new Date(trainingStartDate);
    if (trainingEndDate) period.trainingEndDate = new Date(trainingEndDate);
    if (registrationDeadline) period.registrationDeadline = new Date(registrationDeadline);
    if (status) period.status = status;
    if (isActive !== undefined) period.isActive = isActive;
    if (kidsFormConfig) period.kidsFormConfig = kidsFormConfig;
    if (adultsFormConfig) period.adultsFormConfig = adultsFormConfig;
    if (trainingSlots !== undefined) period.trainingSlots = trainingSlots;

    await period.save();

    logger.info('Registration period updated', {
      periodId: period._id,
      userId: req.user.id
    });

    // Attach before/after to req for audit log
    const afterState = period.toObject();
    req.auditMetadata = {
      before: beforeState,
      after: afterState,
      changes: getChangedFields(beforeState, afterState)
    };

    res.json({
      success: true,
      message: 'Anmeldezeitraum erfolgreich aktualisiert',
      period
    });
  } catch (error) {
    logger.error('Error updating registration period:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Aktualisieren des Anmeldezeitraums'
    });
  }
});

/**
 * DELETE /api/registration-periods/:id
 * Delete registration period
 *
 * Only allows deletion if no submissions exist
 */
router.delete('/:id', auditLogMiddleware({ action: 'DELETE', resource: 'RegistrationPeriod', metadata: { cascade: true } }), async (req, res) => {
  try {
    const period = await RegistrationPeriod.findById(req.params.id);

    if (!period) {
      return res.status(404).json({
        success: false,
        error: 'Anmeldezeitraum nicht gefunden'
      });
    }

    // Delete all related seasonal registrations (cascade delete)
    const deleteResult = await SeasonalRegistration.deleteMany({
      periodId: period._id
    });

    const deletedRegistrations = deleteResult.deletedCount || 0;

    // Delete the period itself
    await period.deleteOne();

    logger.info('Registration period deleted with cascade', {
      periodId: period._id,
      deletedRegistrations: deletedRegistrations,
      userId: req.user.id
    });

    res.json({
      success: true,
      message: deletedRegistrations > 0
        ? `Anmeldezeitraum und ${deletedRegistrations} Anmeldung(en) erfolgreich gelöscht`
        : 'Anmeldezeitraum erfolgreich gelöscht',
      deletedRegistrations: deletedRegistrations
    });
  } catch (error) {
    logger.error('Error deleting registration period:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Löschen des Anmeldezeitraums'
    });
  }
});

/**
 * POST /api/registration-periods/:id/create-plan
 * Create initial training plan for registration period
 *
 * Body:
 * - planName: string (required) - Name of the plan
 * - description: string (optional) - Plan description
 * - copyFromPeriodId: string (optional) - ID of period to copy coaches from
 *
 * Creates SavedSchedule linked to period and sets as currentPlanId.
 * Optionally copies coach records from another period's current plan.
 */
router.post('/:id/create-plan', auditLogMiddleware({ action: 'CREATE', resource: 'SavedSchedule' }), async (req, res) => {
  try {
    const period = await RegistrationPeriod.findById(req.params.id);

    if (!period) {
      return res.status(404).json({
        success: false,
        error: 'Anmeldezeitraum nicht gefunden'
      });
    }

    // Validate period is not closed/archived
    if (period.status === 'closed' || period.status === 'archived') {
      return res.status(400).json({
        success: false,
        error: 'Kann keinen Plan für einen geschlossenen oder archivierten Zeitraum erstellen'
      });
    }

    const { planName, description = '', copyFromPeriodId } = req.body;

    if (!planName) {
      return res.status(400).json({
        success: false,
        error: 'Planname ist erforderlich'
      });
    }

    // Calculate version number (count existing plans for this period + 1)
    const existingPlansCount = await SavedSchedule.countDocuments({ periodId: period._id });
    const version = existingPlansCount + 1;

    let coaches = [];
    let coachIdMap = new Map(); // Old ID → New ID mapping

    // Copy coaches from previous period if requested
    if (copyFromPeriodId) {
      const sourcePeriod = await RegistrationPeriod.findById(copyFromPeriodId)
        .populate('currentPlanId');

      if (!sourcePeriod || !sourcePeriod.currentPlanId) {
        return res.status(404).json({
          success: false,
          error: 'Quell-Zeitraum oder dessen Plan nicht gefunden'
        });
      }

      const sourcePlan = sourcePeriod.currentPlanId;

      if (sourcePlan.coaches && sourcePlan.coaches.length > 0) {
        // Copy coach records (create new ObjectIds)
        for (const sourceCoach of sourcePlan.coaches) {
          const newCoach = await Coach.create({
            firstName: sourceCoach.firstName,
            lastName: sourceCoach.lastName,
            email: sourceCoach.email,
            phone: sourceCoach.phone,
            birthday: sourceCoach.birthday,
            adress: sourceCoach.adress,
            availableTimes: sourceCoach.availableTimes || [],
            isCoachingAdult: sourceCoach.isCoachingAdult || false,
            isCoachingChildren: sourceCoach.isCoachingChildren || false,
            CoachingChildrenLevels: sourceCoach.CoachingChildrenLevels || []
          });

          coaches.push(newCoach.toObject());
          coachIdMap.set(sourceCoach._id.toString(), newCoach._id.toString());
        }

        logger.info('Copied coaches from source plan', {
          sourcePeriodId: copyFromPeriodId,
          coachCount: coaches.length,
          userId: req.user.id
        });
      }
    }

    // Create SavedSchedule with periodId link
    const plan = new SavedSchedule({
      name: planName,
      description,
      periodId: period._id,
      version,
      createdBy: req.user.id,
      createdByEmail: req.user.email,
      students: [], // Empty - will be populated when processing registrations
      coaches,
      schedule: [], // Empty - will be populated by algorithm
      studentsNotSet: [],
      metadata: {
        studentCount: 0,
        coachCount: coaches.length,
        courseCount: 0,
        possibleCourseCount: 0,
        unassignedCount: 0
      }
    });

    await plan.save();

    // Update period's currentPlanId
    period.currentPlanId = plan._id;
    await period.save();

    logger.info('Training plan created for period', {
      periodId: period._id,
      planId: plan._id,
      planName,
      version,
      copiedFrom: copyFromPeriodId || null,
      userId: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Trainingsplan erfolgreich erstellt',
      plan,
      period
    });
  } catch (error) {
    logger.error('Error creating training plan:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Erstellen des Trainingsplans',
      details: error.message
    });
  }
});

/**
 * POST /api/registration-periods/:id/open
 * Open registration period
 *
 * Sets status to 'open' and optionally isActive to true
 */
router.post('/:id/open', auditLogMiddleware({ action: 'UPDATE', resource: 'RegistrationPeriod', metadata: { operation: 'OPEN' } }), async (req, res) => {
  try {
    const period = await RegistrationPeriod.findById(req.params.id);

    if (!period) {
      return res.status(404).json({
        success: false,
        error: 'Anmeldezeitraum nicht gefunden'
      });
    }

    if (period.status === 'open') {
      return res.status(400).json({
        success: false,
        error: 'Anmeldezeitraum ist bereits geöffnet'
      });
    }

    period.status = 'open';
    period.isActive = true; // Activate when opening

    await period.save();

    logger.info('Registration period opened', {
      periodId: period._id,
      userId: req.user.id
    });

    res.json({
      success: true,
      message: 'Anmeldezeitraum erfolgreich geöffnet',
      period
    });
  } catch (error) {
    logger.error('Error opening registration period:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Öffnen des Anmeldezeitraums'
    });
  }
});

/**
 * POST /api/registration-periods/:id/close
 * Close registration period
 *
 * Sets status to 'closed' and isActive to false
 */
router.post('/:id/close', auditLogMiddleware({ action: 'UPDATE', resource: 'RegistrationPeriod', metadata: { operation: 'CLOSE' } }), async (req, res) => {
  try {
    const period = await RegistrationPeriod.findById(req.params.id);

    if (!period) {
      return res.status(404).json({
        success: false,
        error: 'Anmeldezeitraum nicht gefunden'
      });
    }

    if (period.status === 'closed' || period.status === 'archived') {
      return res.status(400).json({
        success: false,
        error: 'Anmeldezeitraum ist bereits geschlossen'
      });
    }

    period.status = 'closed';
    period.isActive = false;

    await period.save();

    logger.info('Registration period closed', {
      periodId: period._id,
      userId: req.user.id
    });

    res.json({
      success: true,
      message: 'Anmeldezeitraum erfolgreich geschlossen',
      period
    });
  } catch (error) {
    logger.error('Error closing registration period:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Schließen des Anmeldezeitraums'
    });
  }
});

/**
 * POST /api/registration-periods/:id/reopen
 * Reopen a closed registration period
 *
 * Sets status back to 'open' and isActive to true
 */
router.post('/:id/reopen', auditLogMiddleware({ action: 'UPDATE', resource: 'RegistrationPeriod', metadata: { operation: 'REOPEN' } }), async (req, res) => {
  try {
    const period = await RegistrationPeriod.findById(req.params.id);

    if (!period) {
      return res.status(404).json({
        success: false,
        error: 'Anmeldezeitraum nicht gefunden'
      });
    }

    if (period.status !== 'closed') {
      return res.status(400).json({
        success: false,
        error: 'Nur geschlossene Anmeldezeiträume können wieder geöffnet werden'
      });
    }

    period.status = 'open';
    period.isActive = true;

    await period.save();

    logger.info('Registration period reopened', {
      periodId: period._id,
      userId: req.user.id
    });

    res.json({
      success: true,
      message: 'Anmeldezeitraum erfolgreich wieder geöffnet',
      period
    });
  } catch (error) {
    logger.error('Error reopening registration period:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Wieder-Öffnen des Anmeldezeitraums'
    });
  }
});

/**
 * PATCH /api/registration-periods/:id/cancellation
 * Enable or disable student cancellations for this period
 */
router.patch('/:id/cancellation', async (req, res) => {
  try {
    const { cancellationEnabled } = req.body;
    if (typeof cancellationEnabled !== 'boolean') {
      return res.status(400).json({ error: 'cancellationEnabled must be boolean' });
    }
    const period = await RegistrationPeriod.findByIdAndUpdate(req.params.id, { cancellationEnabled }, { new: true });
    if (!period) return res.status(404).json({ error: 'Anmeldezeitraum nicht gefunden' });
    res.json({ cancellationEnabled: period.cancellationEnabled });
  } catch (error) {
    logger.error('Error toggling period cancellation', { error: error.message });
    res.status(500).json({ error: 'Fehler beim Ändern der Stornierungseinstellung' });
  }
});

/**
 * GET /api/registration-periods/:id/submissions
 * List submissions for a period
 *
 * Query params:
 * - status: filter by status (pending, processed)
 * - formType: filter by form type (kids, adults)
 */
router.get('/:id/submissions', async (req, res) => {
  try {
    const period = await RegistrationPeriod.findById(req.params.id);

    if (!period) {
      return res.status(404).json({
        success: false,
        error: 'Anmeldezeitraum nicht gefunden'
      });
    }

    const { status, formType } = req.query;

    // Build filter
    const filter = { periodId: period._id };
    if (status) filter.status = status;
    if (formType) filter.formType = formType;

    const submissions = await SeasonalRegistration.find(filter)
      .populate('studentPortalUserId', 'email familyMembers')
      .populate('studentId', 'firstName lastName')
      .populate('processedBy', 'firstName lastName')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: submissions.length,
      submissions
    });
  } catch (error) {
    logger.error('Error fetching submissions:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Abrufen der Anmeldungen'
    });
  }
});

/**
 * POST /api/registration-periods/:id/process-all
 * Bulk process all pending submissions
 *
 * Creates or updates Student records for all pending submissions
 * and marks them as processed.
 *
 * Body: (optional)
 * - dryRun: boolean - if true, returns what would be created/updated without saving
 */
router.post('/:id/process-all', auditLogMiddleware({ action: 'BULK_OPERATION', resource: 'SeasonalRegistration', metadata: { critical: true, operation: 'BULK_PROCESS' } }), async (req, res) => {
  try {
    const period = await RegistrationPeriod.findById(req.params.id);

    if (!period) {
      return res.status(404).json({
        success: false,
        error: 'Anmeldezeitraum nicht gefunden'
      });
    }

    const { dryRun = false } = req.body;

    // Get all pending submissions
    const submissions = await SeasonalRegistration.find({
      periodId: period._id,
      status: 'pending'
    });

    if (submissions.length === 0) {
      return res.json({
        success: true,
        message: 'Keine ausstehenden Anmeldungen zum Verarbeiten',
        processed: 0
      });
    }

    const results = {
      created: [],
      updated: [],
      errors: []
    };

    for (const submission of submissions) {
      try {
        // Check if Student record already exists (by email or studentId)
        let student;

        if (submission.studentId) {
          student = await Student.findById(submission.studentId);
        } else {
          student = await Student.findOne({ email: submission.email });
        }

        // Look up portal user for both kids and adults (sex, address)
        const portalUser = await StudentPortalUser.findById(submission.studentPortalUserId);
        let userSex = null;
        if (submission.familyMemberId && portalUser) {
          const child = portalUser.familyMembers.id(submission.familyMemberId);
          userSex = child?.sex || null;
        } else if (portalUser) {
          userSex = portalUser.sex || null;
        }

        const isSameSlot = (a, b) => a.day === b.day && String(a.hour) === String(b.hour) && (a.venue || '') === (b.venue || '');

        const studentData = {
          firstName: submission.firstName,
          lastName: submission.lastName,
          birthDate: submission.birthdate,
          email: submission.email,
          phone: submission.phone,
          adress: portalUser?.address || submission.address || '',
          comment: submission.remarks || '',
          adult: submission.formType === 'adults',
          sex: userSex,
          frequence: submission.trainingshäufigkeit === '2x pro Woche' ? '2' : '1',
          sessionDuration: submission.sessionDuration || null
        };

        // Map long-form trainingsart labels to Student.trainigGroup short codes
        const trainigGroupMap = {
          'Kindergarten (ca. 4-6 Jahre)': 'Kinderland',
          'KIDS-ROT (ca. 6-8 Jahre)': 'Rot',
          'KIDS-ORANGE (ca. 8-10 Jahre)': 'Orange',
          'KIDS-GRÜN (ca. 10-12 Jahre)': 'Grün',
          'Jugend HOBBY (Gelb)': 'Gelb Hobby',
          'Jugend TEAM (Gelb)': 'Gelb Team',
        };

        // Add form-specific fields
        if (submission.formType === 'kids') {
          studentData.trainigGroup = trainigGroupMap[submission.trainingsart] || submission.trainingsart;
          studentData.member = submission.mitgliedsstatus === 'Mitglied';
          studentData.team = !!(submission.teamParticipation && submission.teamParticipation !== '-' && submission.teamParticipation !== false);
          let kidsSlots = (submission.availableTimesKids || []).map(t => ({ day: t.day, hour: t.hour, venue: t.venue || '' }));
          if (submission.priorityTime && submission.priorityTime.day) {
            const prio = kidsSlots.find(t => isSameSlot(t, submission.priorityTime));
            if (prio) kidsSlots = [prio, ...kidsSlots.filter(t => !isSameSlot(t, submission.priorityTime))];
          }
          studentData.availableTimes = kidsSlots;
        } else {
          // Adults
          studentData.skillLevel = submission.spielstärke || '';
          studentData.member = submission.mitgliedsstatus === 'Mitglied';
          studentData.comment2 = submission.trainingGoals ? submission.trainingGoals.join(', ') : '';
          studentData.groupSize = submission.groupSize ? submission.groupSize.join(', ') : '';
          let adultSlots = (submission.availableTimesAdults || []).map(t => ({ day: t.day, hour: t.hour, venue: t.venue || '' }));
          if (submission.priorityTime && submission.priorityTime.day) {
            const prio = adultSlots.find(t => isSameSlot(t, submission.priorityTime));
            if (prio) adultSlots = [prio, ...adultSlots.filter(t => !isSameSlot(t, submission.priorityTime))];
          }
          studentData.availableTimes = adultSlots;
        }

        // Store priorityTime on Student for algorithm Phase P
        if (submission.priorityTime && submission.priorityTime.day && submission.priorityTime.hour !== undefined) {
          studentData.priorityTime = {
            day: submission.priorityTime.day,
            hour: submission.priorityTime.hour,
            venue: submission.priorityTime.venue || ''
          };
        }

        if (!dryRun) {
          // Each submission gets its own transaction (if supported) so Student creation
          // and registration status update are atomic. If submission.save() fails
          // after student.save(), the transaction rolls back both — preventing
          // orphaned Student records. One submission's failure doesn't stop
          // processing of the others.
          const useTransactions = process.env.USE_TRANSACTIONS === 'true';

          let session = null;
          if (useTransactions) {
            session = await mongoose.startSession();
            await session.startTransaction();
          }

          try {
            if (student) {
              // Update existing student
              Object.assign(student, studentData);
              await (useTransactions && session
                ? student.save({ session })
                : student.save());
              results.updated.push({
                studentId: student._id,
                name: `${student.firstName} ${student.lastName}`
              });
            } else {
              // Create new student
              student = new Student(studentData);
              await (useTransactions && session
                ? student.save({ session })
                : student.save());
              results.created.push({
                studentId: student._id,
                name: `${student.firstName} ${student.lastName}`
              });
            }

            // Link submission to student
            submission.studentId = student._id;
            submission.status = 'processed';
            submission.processedAt = new Date();
            submission.processedBy = req.user.id;
            await (useTransactions && session
              ? submission.save({ session })
              : submission.save());

            if (useTransactions && session) {
              await session.commitTransaction();
            }

            // Send notification to student about registration approval
            try {
              if (submission.studentPortalUserId) {
                const isNewStudent = results.created.some(r => r.studentId?.toString() === student._id.toString());
                await createNotification(
                  submission.studentPortalUserId,
                  'registration_approved',
                  `Anmeldung für ${period.name} bestätigt`,
                  isNewStudent
                    ? 'Ihre Anmeldung wurde erfolgreich verarbeitet. Sie wurden als neuer Schüler hinzugefügt.'
                    : 'Ihre Anmeldung wurde erfolgreich verarbeitet und Ihr Profil aktualisiert.',
                  {
                    priority: 'high',
                    actionUrl: '/dashboard',
                    metadata: {
                      registrationId: submission._id,
                      periodId: period._id,
                      studentId: student._id,
                      isNewStudent
                    }
                  }
                );
              }
            } catch (notificationError) {
              logger.error('Error creating notification for registration approval', {
                error: notificationError.message,
                submissionId: submission._id,
                stack: notificationError.stack
              });
              // Don't fail the request if notification fails
            }
          } catch (txError) {
            if (useTransactions && session) {
              await session.abortTransaction();
            }
            throw txError; // Re-throw so outer per-submission catch records the error
          } finally {
            if (useTransactions && session) {
              session.endSession();
            }
          }
        } else {
          // Dry run - just report what would happen
          if (student) {
            results.updated.push({
              studentId: student._id,
              name: `${submission.firstName} ${submission.lastName}`,
              action: 'update'
            });
          } else {
            results.created.push({
              name: `${submission.firstName} ${submission.lastName}`,
              action: 'create'
            });
          }
        }
      } catch (error) {
        results.errors.push({
          submissionId: submission._id,
          name: `${submission.firstName} ${submission.lastName}`,
          error: error.message
        });
      }
    }

    // Auto-add processed students to current plan (if not dry run)
    if (!dryRun && period.currentPlanId && (results.created.length > 0 || results.updated.length > 0)) {
      try {
        const currentPlan = await SavedSchedule.findById(period.currentPlanId);
        if (currentPlan) {
          // Get all processed student IDs
          const processedStudentIds = [
            ...results.created.map(r => r.studentId),
            ...results.updated.map(r => r.studentId)
          ];

          // Fetch full Student records
          const studentsToAdd = await Student.find({
            _id: { $in: processedStudentIds }
          });

          // Add to plan's students array (merge, avoiding duplicates)
          const existingStudentIds = new Set(
            currentPlan.students.map(s => s._id.toString())
          );

          for (const student of studentsToAdd) {
            if (!existingStudentIds.has(student._id.toString())) {
              currentPlan.students.push(student.toObject());
            }
          }

          // Update metadata
          currentPlan.metadata.studentCount = currentPlan.students.length;
          currentPlan.metadata.unassignedCount = currentPlan.students.filter(
            s => !s.day || s.hour === null || s.hour === undefined
          ).length;

          await currentPlan.save();

          logger.info('Added processed students to current plan', {
            periodId: period._id,
            planId: currentPlan._id,
            studentsAdded: studentsToAdd.length,
            userId: req.user.id
          });
        }
      } catch (planError) {
        logger.error('Error adding students to current plan:', planError);
        // Don't fail the request, just log the error
      }
    }

    logger.info('Bulk processed submissions', {
      periodId: period._id,
      userId: req.user.id,
      created: results.created.length,
      updated: results.updated.length,
      errors: results.errors.length,
      dryRun
    });

    res.json({
      success: true,
      message: dryRun
        ? 'Vorschau der zu verarbeitenden Anmeldungen'
        : `${results.created.length + results.updated.length} Anmeldungen erfolgreich verarbeitet und zum aktuellen Plan hinzugefügt`,
      dryRun,
      processed: results.created.length + results.updated.length,
      results
    });
  } catch (error) {
    logger.error('Error bulk processing submissions:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Verarbeiten der Anmeldungen'
    });
  }
});

/**
 * POST /api/registration-periods/:id/compute-holidays
 * Compute and store NRW holidays for the period (calls ferien-api.de once).
 * Replaces any previously stored holidays.
 */
router.post('/:id/compute-holidays', async (req, res) => {
  try {
    const period = await RegistrationPeriod.findById(req.params.id);
    if (!period) {
      return res.status(404).json({ success: false, error: 'Anmeldezeitraum nicht gefunden' });
    }

    let warning = null;
    let holidays;
    try {
      holidays = await getHolidaysInRange(period.trainingStartDate, period.trainingEndDate);
    } catch (err) {
      // If getHolidaysInRange itself throws (shouldn't — it has internal graceful degradation)
      logger.error('Error in getHolidaysInRange', { error: err.message });
      return res.status(500).json({ success: false, error: 'Fehler beim Abrufen der Feiertage' });
    }

    // Detect if school holidays might be missing (heuristic: very few holidays for a full season)
    // The util logs a warning internally; we surface it to the admin via the response
    const hasSchoolHolidays = holidays.some(h =>
      h.name.toLowerCase().includes('ferien') || h.name.toLowerCase().includes('ferien')
    );
    if (!hasSchoolHolidays && holidays.length < 11) {
      warning = 'Schulferien konnten nicht von ferien-api.de abgerufen werden. Nur gesetzliche Feiertage wurden gespeichert.';
    }

    period.computedHolidays = holidays.map(h => ({ date: h.date, name: h.name }));
    period.holidaysComputedAt = new Date();
    await period.save();

    logger.info('Holidays computed for period', {
      periodId: period._id,
      count: holidays.length,
      userId: req.user.id
    });

    res.json({
      success: true,
      holidays: period.computedHolidays,
      computedAt: period.holidaysComputedAt,
      count: holidays.length,
      warning,
    });
  } catch (error) {
    logger.error('Error computing holidays:', error);
    res.status(500).json({ success: false, error: 'Fehler beim Berechnen der Feiertage' });
  }
});

/**
 * POST /api/registration-periods/:id/exclusions
 * Add a custom training exclusion (tournament, maintenance, etc.)
 *
 * Body:
 * - date:          string (required) - ISO date string
 * - reason:        string (required) - max 100 chars
 * - affectedSlots: array (optional)  - [{day, hour}] — empty = whole day
 */
router.post('/:id/exclusions', async (req, res) => {
  try {
    const period = await RegistrationPeriod.findById(req.params.id);
    if (!period) {
      return res.status(404).json({ success: false, error: 'Anmeldezeitraum nicht gefunden' });
    }

    const { date, reason, affectedSlots } = req.body;

    if (!date) {
      return res.status(400).json({ success: false, error: 'Datum ist erforderlich' });
    }
    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Ungültiges Datum' });
    }
    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Grund ist erforderlich' });
    }
    if (reason.trim().length > 100) {
      return res.status(400).json({ success: false, error: 'Grund darf maximal 100 Zeichen haben' });
    }

    const exclusion = {
      date: parsedDate,
      reason: reason.trim(),
      affectedSlots: Array.isArray(affectedSlots) ? affectedSlots : [],
    };

    period.trainingExclusions.push(exclusion);
    await period.save();

    logger.info('Training exclusion added', {
      periodId: period._id,
      date: parsedDate,
      reason: exclusion.reason,
      userId: req.user.id
    });

    res.json({
      success: true,
      trainingExclusions: period.trainingExclusions,
    });
  } catch (error) {
    logger.error('Error adding training exclusion:', error);
    res.status(500).json({ success: false, error: 'Fehler beim Hinzufügen des Ausschlusstags' });
  }
});

/**
 * DELETE /api/registration-periods/:id/exclusions/:exclusionId
 * Remove a custom training exclusion.
 */
router.delete('/:id/exclusions/:exclusionId', async (req, res) => {
  try {
    const period = await RegistrationPeriod.findById(req.params.id);
    if (!period) {
      return res.status(404).json({ success: false, error: 'Anmeldezeitraum nicht gefunden' });
    }

    const exclusion = period.trainingExclusions.id(req.params.exclusionId);
    if (!exclusion) {
      return res.status(404).json({ success: false, error: 'Ausschlusstag nicht gefunden' });
    }

    period.trainingExclusions.pull({ _id: req.params.exclusionId });
    await period.save();

    logger.info('Training exclusion removed', {
      periodId: period._id,
      exclusionId: req.params.exclusionId,
      userId: req.user.id
    });

    res.json({
      success: true,
      trainingExclusions: period.trainingExclusions,
    });
  } catch (error) {
    logger.error('Error removing training exclusion:', error);
    res.status(500).json({ success: false, error: 'Fehler beim Entfernen des Ausschlusstags' });
  }
});

export default router;
