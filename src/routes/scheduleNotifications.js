import express from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdminOrSupermod } from '../middleware/requireRole.js';
import auditLogMiddleware from '../middleware/auditLog.js';
import Student from '../models/Student.js';
import StudentPortalUser from '../models/StudentPortalUser.js';
import Settings from '../models/Settings.js';
import RegistrationPeriod from '../models/RegistrationPeriod.js';
import EmailLog from '../models/EmailLog.js';
import Coach from '../models/Coach.js';
import { createNotification } from '../utils/notificationHelpers.js';
import { sendScheduleNotificationEmail } from '../utils/emailService.js';
import { resolveVenueForAssignment } from '../utils/venueResolver.js';

const router = express.Router();

// All routes require admin or supermod — sending bulk notifications is a privileged action
router.use(requireAuth, requireAdminOrSupermod);

// Day order for sorting assignments
const DAY_ORDER = {
  Montag: 1,
  Dienstag: 2,
  Mittwoch: 3,
  Donnerstag: 4,
  Freitag: 5,
  Samstag: 6,
  Sonntag: 7
};

/**
 * Check if a date is today in the German timezone (Europe/Berlin)
 */
function isSameDayBerlin(date) {
  if (!date) return false;
  const berlinNow = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  const berlinDate = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(date));
  return berlinNow === berlinDate;
}

/**
 * Build a sorted assignment list string for a student.
 * e.g. "Montag 14:00 Uhr (BTHV), Mittwoch 16:00 Uhr (Brüser Berg)"
 */
function buildAssignmentList(assignments) {
  const sorted = [...assignments].sort((a, b) => {
    const dayDiff = (DAY_ORDER[a.day] || 99) - (DAY_ORDER[b.day] || 99);
    if (dayDiff !== 0) return dayDiff;
    return (Number(a.hour) || 0) - (Number(b.hour) || 0);
  });
  return sorted.map(a => {
    const h = Math.floor(Number(a.hour) || 0);
    const m = (Number(a.hour) || 0) % 1 !== 0 ? '30' : '00';
    const timeStr = `${String(h).padStart(2, '0')}:${m}`;
    const venueStr = a.venue ? ` (${a.venue})` : '';
    return `${a.day} ${timeStr} Uhr${venueStr}`;
  }).join(', ');
}

/**
 * Find the portal user for a student.
 * Checks both direct link (StudentPortalUser.studentId) and
 * family member link (StudentPortalUser.familyMembers[].studentId).
 * Returns the parent portal user in both cases (notifications go to the parent).
 */
/**
 * Find the StudentPortalUser associated with a Student record.
 * Supports:
 * 1. Modern Multi-Season Inversion of Control standard (student.studentPortalUserId)
 * 2. Legacy direct link (StudentPortalUser.studentId)
 * 3. Family member link (StudentPortalUser.familyMembers.studentId)
 * 4. Fallback match by email
 */
async function findPortalUserForStudent(studentId, student = null) {
  let s = student;
  if (!s) {
    s = await Student.findById(studentId);
  }

  // 1. Modern Multi-Season Inversion of Control standard (student.studentPortalUserId)
  if (s?.studentPortalUserId) {
    const user = await StudentPortalUser.findById(s.studentPortalUserId);
    if (user) return user;
  }

  // 2. Legacy direct link (adult student with own portal account)
  const direct = await StudentPortalUser.findOne({ studentId });
  if (direct) return direct;

  // 3. Family member link (child → parent's portal account)
  const byFamily = await StudentPortalUser.findOne({ 'familyMembers.studentId': studentId });
  if (byFamily) return byFamily;

  // 4. Fallback: match by email if student has email
  if (s?.email) {
    const byEmail = await StudentPortalUser.findOne({ email: s.email.toLowerCase().trim() });
    if (byEmail) return byEmail;
  }

  return null;
}

/**
 * Load Settings singleton, upsert if not exists.
 */
async function getSettings() {
  let settings = await Settings.findOne({ singleton: true });
  if (!settings) {
    settings = await Settings.findOneAndUpdate(
      { singleton: true },
      { singleton: true },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  return settings;
}

// =============================================
// GET /api/schedule-notifications/status
// Returns last bulk notification info (scoped by periodId if provided)
// =============================================
router.get('/status', async (req, res) => {
  try {
    const { periodId } = req.query;
    let lastBulkNotificationSent = null;

    if (periodId && mongoose.Types.ObjectId.isValid(periodId)) {
      const period = await RegistrationPeriod.findById(periodId).select('lastBulkScheduleNotification');
      if (period?.lastBulkScheduleNotification?.sentAt) {
        lastBulkNotificationSent = period.lastBulkScheduleNotification;
      }
    } else {
      const settings = await getSettings();
      lastBulkNotificationSent = settings.lastBulkScheduleNotification || null;
    }

    const alreadySentToday = isSameDayBerlin(lastBulkNotificationSent?.sentAt);

    res.json({
      lastBulkNotificationSent,
      alreadySentToday
    });
  } catch (error) {
    console.error('[schedule-notifications] Error in GET /status:', error);
    res.status(500).json({ error: 'Fehler beim Laden des Status' });
  }
});

/**
 * Execute unified notification pipeline for a single student:
 * 1. Resolves portalUser via findPortalUserForStudent
 * 2. Creates In-App notification (portal bell) if portal account exists
 * 3. Sets Student.scheduleVisible = true
 * 4. Dispatches personalized email (with student's name in subject and body)
 * 5. Writes immutable audit entry to EmailLog
 */
async function sendNotificationPipelineForStudent({
  student,
  period = null,
  triggerType = 'single',
  sentBy = 'admin',
  slotMeta = null,
  coachMap = null
}) {
  const portalUser = await findPortalUserForStudent(student._id, student);
  const recipientEmail = portalUser?.email || student.email;
  let activePeriod = period;
  if (!activePeriod && student.periodId) {
    activePeriod = await RegistrationPeriod.findById(student.periodId).lean();
  }
  const periodName = activePeriod?.name || 'Saisontraining';

  // Enrich assignments with Coach and Venue details
  let enrichedAssignments = student.assignments || [];
  try {
    let resolvedMap = coachMap;
    if (!resolvedMap) {
      const coachIds = enrichedAssignments
        .map(a => a.coach?._id || a.coach)
        .filter(Boolean);
      if (coachIds.length > 0) {
        const coaches = await Coach.find({ _id: { $in: coachIds } }).lean();
        resolvedMap = new Map(coaches.map(c => [String(c._id), c]));
      }
    }

    enrichedAssignments = enrichedAssignments.map(a => {
      const coachIdStr = String(a.coach?._id || a.coach || '');
      const coachObj = (a.coach && typeof a.coach === 'object' && a.coach.firstName)
        ? a.coach
        : (resolvedMap ? resolvedMap.get(coachIdStr) : null);
      const coachName = coachObj
        ? `${coachObj.firstName} ${coachObj.lastName}`.trim()
        : (a.coachName || 'Trainerteam');
      const venue = resolveVenueForAssignment(student, a, activePeriod);
      return {
        ...(typeof a.toObject === 'function' ? a.toObject() : a),
        coach: coachObj || a.coach,
        coachName,
        venue
      };
    });
  } catch (coachErr) {
    console.error(`[schedule-notifications] Failed to enrich coach/venue details for student ${student._id}:`, coachErr.message);
  }

  const assignmentList = buildAssignmentList(enrichedAssignments);

  // 1. In-App Notification (Portal Bell)
  if (portalUser) {
    try {
      await createNotification(
        portalUser._id,
        'schedule_change',
        `Trainingsplan: ${student.firstName} ${student.lastName}`,
        `Trainingszeiten für ${student.firstName}: ${assignmentList}`,
        {
          priority: 'high',
          actionUrl: '/dashboard/schedule'
        }
      );
    } catch (notifErr) {
      console.error(`[schedule-notifications] Failed to create In-App notification for student ${student._id}:`, notifErr.message);
    }
  }

  // 2. Set scheduleVisible = true and persist resolved venue to student record if missing
  const needsVenueUpdate = (student.assignments || []).some((a, idx) => !a.venue && enrichedAssignments[idx]?.venue);
  const updateFields = { scheduleVisible: true };
  if (needsVenueUpdate) {
    updateFields.assignments = (student.assignments || []).map((a, idx) => {
      const plain = typeof a.toObject === 'function' ? a.toObject() : { ...a };
      if (!plain.venue && enrichedAssignments[idx]?.venue) {
        plain.venue = enrichedAssignments[idx].venue;
      }
      return plain;
    });
  }
  await Student.findByIdAndUpdate(student._id, updateFields);

  // 3. Email Delivery & Audit Logging
  let emailResult = null;
  let emailError = null;

  if (recipientEmail) {
    try {
      emailResult = await sendScheduleNotificationEmail({
        student,
        portalUser,
        assignments: enrichedAssignments,
        periodName
      });
    } catch (err) {
      emailError = err.message;
      console.error(`[schedule-notifications] Failed to send email to ${recipientEmail} for student ${student._id}:`, err.message);
    }

    try {
      await EmailLog.create({
        recipientEmail: recipientEmail.toLowerCase().trim(),
        studentId: student._id,
        studentName: `${student.firstName} ${student.lastName}`,
        portalUserId: portalUser?._id || null,
        periodId: period?._id || student.periodId || null,
        periodName,
        subject: `Trainingsplan ${periodName}: Trainingszeiten für ${student.firstName} ${student.lastName} 🎾`,
        templateType: 'schedule_notification',
        category: 'notification',
        status: emailError ? 'failed' : (emailResult?.simulated ? 'simulated' : 'sent'),
        messageId: emailResult?.messageId || null,
        errorMessage: emailError,
        sentAt: new Date(),
        sentBy,
        triggerType,
        assignmentsSummary: assignmentList,
        metadata: slotMeta || {}
      });
    } catch (logErr) {
      console.error(`[schedule-notifications] Failed to write EmailLog:`, logErr.message);
    }
  } else {
    // Log failure due to missing email address
    try {
      await EmailLog.create({
        recipientEmail: 'keine-email@system.local',
        studentId: student._id,
        studentName: `${student.firstName} ${student.lastName}`,
        portalUserId: portalUser?._id || null,
        periodId: period?._id || student.periodId || null,
        periodName,
        subject: `Trainingsplan ${periodName}: Trainingszeiten für ${student.firstName} ${student.lastName} 🎾`,
        templateType: 'schedule_notification',
        category: 'notification',
        status: 'failed',
        errorMessage: 'Keine E-Mail-Adresse für Schüler oder Elternkonto vorhanden',
        sentAt: new Date(),
        sentBy,
        triggerType,
        assignmentsSummary: assignmentList,
        metadata: slotMeta || {}
      });
    } catch (logErr) {
      console.error(`[schedule-notifications] Failed to write missing-email EmailLog:`, logErr.message);
    }
  }

  return {
    studentId: student._id,
    studentName: `${student.firstName} ${student.lastName}`,
    recipientEmail: recipientEmail || null,
    hasPortalUser: !!portalUser,
    emailSent: !emailError && !!recipientEmail,
    emailSimulated: !!emailResult?.simulated
  };
}

// =============================================
// POST /api/schedule-notifications/notify-all
// Send schedule notifications & emails to all students with assignments
// Body: { periodId: string, force: boolean }
// =============================================
router.post('/notify-all', auditLogMiddleware({ action: 'BULK_OPERATION', resource: 'ScheduleNotification', metadata: { operation: 'NOTIFY_ALL' } }), async (req, res) => {
  try {
    const force = req.body?.force === true;
    const periodId = req.body?.periodId;

    if (!periodId || !mongoose.Types.ObjectId.isValid(periodId)) {
      return res.status(400).json({ error: 'periodId ist zwingend erforderlich' });
    }

    const period = await RegistrationPeriod.findById(periodId);
    if (!period) {
      return res.status(404).json({ error: 'Trainingsperiode nicht gefunden' });
    }

    const lastBulkNotificationSent = period.lastBulkScheduleNotification?.sentAt
      ? period.lastBulkScheduleNotification
      : null;
    const alreadySentToday = isSameDayBerlin(lastBulkNotificationSent?.sentAt);

    // Warn if already sent today and force flag not set
    if (alreadySentToday && !force) {
      return res.json({
        warned: true,
        alreadySentToday: true,
        lastSentAt: lastBulkNotificationSent.sentAt,
        sentCount: 0
      });
    }

    // Find all students with at least one assignment (strictly scoped by periodId)
    const studentFilter = {
      periodId,
      'assignments.0': { $exists: true }
    };
    const students = await Student.find(studentFilter);
    const sentBy = req.user?.username || 'admin';

    // Pre-load all coaches once to avoid querying Coach in a loop
    const allCoaches = await Coach.find({}).lean();
    const globalCoachMap = new Map(allCoaches.map(c => [String(c._id), c]));

    let sentCount = 0;
    for (const student of students) {
      if (!student.assignments || student.assignments.length === 0) continue;
      await sendNotificationPipelineForStudent({
        student,
        period,
        triggerType: 'bulk',
        sentBy,
        coachMap: globalCoachMap
      });
      sentCount++;
      // Gentle pacing to avoid SMTP socket exhaustion & Netcup rate limiting (400ms delay)
      await new Promise(r => setTimeout(r, 400));
    }

    // Update RegistrationPeriod with bulk notification metadata
    const notificationMeta = {
      sentAt: new Date(),
      sentCount,
      sentBy
    };
    await RegistrationPeriod.findByIdAndUpdate(periodId, {
      $set: {
        'lastBulkScheduleNotification.sentAt': notificationMeta.sentAt,
        'lastBulkScheduleNotification.sentCount': notificationMeta.sentCount,
        'lastBulkScheduleNotification.sentBy': notificationMeta.sentBy
      }
    });

    // Also update Settings for global audit/backwards compatibility
    await Settings.findOneAndUpdate(
      { singleton: true },
      {
        $set: {
          'lastBulkScheduleNotification.sentAt': notificationMeta.sentAt,
          'lastBulkScheduleNotification.sentCount': notificationMeta.sentCount,
          'lastBulkScheduleNotification.sentBy': notificationMeta.sentBy
        }
      },
      { upsert: true }
    );

    res.json({
      success: true,
      sentCount,
      warned: false
    });
  } catch (error) {
    console.error('[schedule-notifications] Error in POST /notify-all:', error);
    res.status(500).json({ error: 'Fehler beim Senden der Benachrichtigungen' });
  }
});

// =============================================
// POST /api/schedule-notifications/notify-slot
// Send schedule notification & email to all students in a specific slot / group
// Body: { periodId: string, day: string, hour: number, coachId?: string, studentIds?: string[] }
// =============================================
router.post('/notify-slot', auditLogMiddleware({ action: 'CREATE', resource: 'ScheduleNotification', metadata: { operation: 'NOTIFY_SLOT' } }), async (req, res) => {
  try {
    const { periodId, day, hour, coachId, studentIds } = req.body;

    if (!periodId && (!Array.isArray(studentIds) || studentIds.length === 0)) {
      return res.status(400).json({ error: 'periodId oder studentIds ist erforderlich' });
    }

    let targetStudents = [];
    if (Array.isArray(studentIds) && studentIds.length > 0) {
      targetStudents = await Student.find({
        _id: { $in: studentIds },
        ...(periodId ? { periodId } : {})
      });
    } else if (periodId && day && hour !== undefined) {
      const matchCriteria = {
        day: String(day).trim(),
        hour: Number(hour)
      };
      if (coachId) {
        matchCriteria.coach = coachId;
      }
      targetStudents = await Student.find({
        periodId,
        assignments: { $elemMatch: matchCriteria }
      });
    }

    if (targetStudents.length === 0) {
      return res.status(400).json({ error: 'Keine Schüler für diesen Slot gefunden' });
    }

    const period = periodId
      ? await RegistrationPeriod.findById(periodId)
      : (targetStudents[0].periodId ? await RegistrationPeriod.findById(targetStudents[0].periodId) : null);

    const sentBy = req.user?.username || 'admin';
    const allCoaches = await Coach.find({}).lean();
    const globalCoachMap = new Map(allCoaches.map(c => [String(c._id), c]));

    const slotMeta = {
      day: day || targetStudents[0]?.assignments?.[0]?.day,
      hour: hour !== undefined ? hour : targetStudents[0]?.assignments?.[0]?.hour,
      coachId: coachId || targetStudents[0]?.assignments?.[0]?.coach
    };

    let sentCount = 0;
    const notifiedStudents = [];

    for (const student of targetStudents) {
      if (!student.assignments || student.assignments.length === 0) continue;
      const resStudent = await sendNotificationPipelineForStudent({
        student,
        period,
        triggerType: 'slot',
        sentBy,
        slotMeta,
        coachMap: globalCoachMap
      });
      sentCount++;
      notifiedStudents.push({
        id: resStudent.studentId,
        name: resStudent.studentName,
        email: resStudent.recipientEmail
      });
    }

    res.json({
      success: true,
      sentCount,
      totalCount: targetStudents.length,
      notifiedStudents
    });
  } catch (error) {
    console.error('[schedule-notifications] Error in POST /notify-slot:', error);
    res.status(500).json({ error: 'Fehler beim Senden der Gruppen-Benachrichtigung' });
  }
});

// =============================================
// POST /api/schedule-notifications/notify-student/:studentId
// Send schedule notification & email to a single student
// =============================================
router.post('/notify-student/:studentId', auditLogMiddleware({ action: 'CREATE', resource: 'ScheduleNotification', metadata: { operation: 'NOTIFY_STUDENT' } }), async (req, res) => {
  try {
    const { studentId } = req.params;

    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ error: 'Schüler nicht gefunden' });
    }

    const portalUser = await findPortalUserForStudent(student._id, student);
    if (!portalUser) {
      return res.status(400).json({ error: 'Schüler hat kein Portal-Konto' });
    }

    if (!student.assignments || student.assignments.length === 0) {
      return res.status(400).json({ error: 'Schüler hat keine Trainingszeiten' });
    }

    const period = student.periodId ? await RegistrationPeriod.findById(student.periodId) : null;
    const sentBy = req.user?.username || 'admin';

    const result = await sendNotificationPipelineForStudent({
      student,
      period,
      triggerType: 'single',
      sentBy
    });

    res.json({
      success: true,
      sent: true,
      studentName: result.studentName,
      recipientEmail: result.recipientEmail,
      emailSent: result.emailSent
    });
  } catch (error) {
    console.error('[schedule-notifications] Error in POST /notify-student:', error);
    if (error.name === 'CastError' || error.name === 'BSONError') {
      return res.status(400).json({ error: 'Ungültige Schüler-ID' });
    }
    res.status(500).json({ error: 'Fehler beim Senden der Benachrichtigung' });
  }
});

// =============================================
// GET /api/schedule-notifications/email-logs
// Audit trail of sent schedule notification emails
// Query: { periodId?, triggerType?, status?, page?, limit? }
// =============================================
router.get('/email-logs', async (req, res) => {
  try {
    const { periodId, triggerType, status, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (periodId) filter.periodId = periodId;
    if (triggerType) filter.triggerType = triggerType;
    if (status) filter.status = status;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [logs, total] = await Promise.all([
      EmailLog.find(filter)
        .sort({ sentAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .select('-metadata.rawHtml')
        .lean(),
      EmailLog.countDocuments(filter)
    ]);

    res.json({
      success: true,
      logs,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum)
    });
  } catch (error) {
    console.error('[schedule-notifications] Error in GET /email-logs:', error);
    res.status(500).json({ error: 'Fehler beim Laden der E-Mail-Logs' });
  }
});

export default router;
