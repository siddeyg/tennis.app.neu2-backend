import express from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import Student from '../models/Student.js';
import Settings from '../models/Settings.js';
import { createNotification } from '../utils/notificationHelpers.js';

const router = express.Router();

// All routes require admin authentication
router.use(requireAuth);

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
 * e.g. "Montag 14:00, Mittwoch 16:00"
 */
function buildAssignmentList(assignments) {
  const sorted = [...assignments].sort((a, b) => {
    const dayDiff = (DAY_ORDER[a.day] || 99) - (DAY_ORDER[b.day] || 99);
    if (dayDiff !== 0) return dayDiff;
    return (Number(a.hour) || 0) - (Number(b.hour) || 0);
  });
  return sorted.map(a => `${a.day} ${String(a.hour).padStart(2, '0')}:00`).join(', ');
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
// Returns last bulk notification info
// =============================================
router.get('/status', async (req, res) => {
  try {
    const settings = await getSettings();
    const lastBulkNotificationSent = settings.lastBulkScheduleNotification || null;
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

// =============================================
// POST /api/schedule-notifications/notify-all
// Send schedule notifications to all students with assignments + portal accounts
// Body: { force: boolean }
// =============================================
router.post('/notify-all', async (req, res) => {
  try {
    const force = req.body?.force === true;

    const settings = await getSettings();
    const alreadySentToday = isSameDayBerlin(settings.lastBulkScheduleNotification?.sentAt);

    // Warn if already sent today and force flag not set
    if (alreadySentToday && !force) {
      return res.json({
        warned: true,
        alreadySentToday: true,
        lastSentAt: settings.lastBulkScheduleNotification.sentAt,
        sentCount: 0
      });
    }

    // Find all students with at least one assignment and a portal account
    const students = await Student.find({
      'assignments.0': { $exists: true },
      portalUser: { $exists: true, $ne: null }
    }).populate('portalUser');

    let sentCount = 0;

    for (const student of students) {
      if (!student.portalUser || !student.assignments?.length) continue;

      const assignmentList = buildAssignmentList(student.assignments);

      try {
        await createNotification(
          student.portalUser._id,
          'schedule_change',
          'Dein Trainingsplan',
          `Deine Trainingszeiten: ${assignmentList}`,
          {
            priority: 'high',
            actionUrl: '/schedule'
          }
        );
        sentCount++;
      } catch (notifError) {
        console.error(`[schedule-notifications] Failed to notify student ${student._id}:`, notifError.message);
      }
    }

    // Update Settings with bulk notification metadata
    await Settings.findOneAndUpdate(
      { singleton: true },
      {
        $set: {
          'lastBulkScheduleNotification.sentAt': new Date(),
          'lastBulkScheduleNotification.sentCount': sentCount,
          'lastBulkScheduleNotification.sentBy': req.user?.username || 'admin'
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
// POST /api/schedule-notifications/notify-student/:studentId
// Send schedule notification to a single student
// =============================================
router.post('/notify-student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;

    const student = await Student.findById(studentId).populate('portalUser');

    if (!student) {
      return res.status(404).json({ error: 'Schüler nicht gefunden' });
    }

    if (!student.portalUser) {
      return res.status(404).json({ error: 'Student hat kein Portal-Konto' });
    }

    if (!student.assignments || student.assignments.length === 0) {
      return res.status(400).json({ error: 'Student hat keine Trainingszeiten' });
    }

    const assignmentList = buildAssignmentList(student.assignments);

    await createNotification(
      student.portalUser._id,
      'schedule_change',
      'Dein Trainingsplan',
      `Deine Trainingszeiten: ${assignmentList}`,
      {
        priority: 'high',
        actionUrl: '/schedule'
      }
    );

    res.json({
      success: true,
      sent: true,
      studentName: `${student.firstName} ${student.lastName}`
    });
  } catch (error) {
    console.error('[schedule-notifications] Error in POST /notify-student:', error);
    if (error.name === 'CastError' || error.name === 'BSONError') {
      return res.status(400).json({ error: 'Ungültige Schüler-ID' });
    }
    res.status(500).json({ error: 'Fehler beim Senden der Benachrichtigung' });
  }
});

export default router;
