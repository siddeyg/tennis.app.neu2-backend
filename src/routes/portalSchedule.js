import express from 'express';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Student from '../models/Student.js';
import Coach from '../models/Coach.js';
import Announcement from '../models/Announcement.js';
import ScheduleChangeRequest from '../models/ScheduleChangeRequest.js';
import Absence from '../models/Absence.js';
import Attendance from '../models/Attendance.js';
import StudentPortalUser from '../models/StudentPortalUser.js';
import RegistrationPeriod from '../models/RegistrationPeriod.js';
import verifyPortalAuth from '../middleware/verifyPortalAuth.js';
import { getIBANLast3, encryptIBAN, validateIBANFormat } from '../utils/encryption.js';
import logger from '../utils/logger.js';
import auditLogMiddleware from '../middleware/auditLog.js';
import { getDatesInRangeForDay } from '../utils/nrwHolidays.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, '../../uploads/announcements');

const router = express.Router();

const DAY_NAME_TO_NUM = { Montag: 1, Dienstag: 2, Mittwoch: 3, Donnerstag: 4, Freitag: 5, Samstag: 6 };

function toDateKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildExclusionMap(computedHolidays = [], trainingExclusions = []) {
  const map = new Map();
  for (const h of computedHolidays) {
    map.set(toDateKey(h.date), { name: h.name, isWholeDay: true, slots: [] });
  }
  for (const e of trainingExclusions) {
    const key = toDateKey(e.date);
    const isWholeDay = !e.affectedSlots || e.affectedSlots.length === 0;
    const existing = map.get(key);
    if (isWholeDay) {
      map.set(key, { name: e.reason, isWholeDay: true, slots: [] });
    } else if (existing) {
      existing.slots.push(...e.affectedSlots);
    } else {
      map.set(key, { name: e.reason, isWholeDay: false, slots: [...e.affectedSlots] });
    }
  }
  return map;
}

// Helper: build schedule array from a Student document (reused for parent + children)
async function buildScheduleForStudent(student) {
  let schedule = [];

  if (student.assignments && student.assignments.length > 0) {
    const coachIds = student.assignments
      .map(a => a.coach)
      .filter(id => id && id.toString);

    const coaches = await Coach.find({ _id: { $in: coachIds } });
    const coachMap = new Map(
      coaches.map(c => [c._id.toString(), `${c.firstName} ${c.lastName}`])
    );

    schedule = student.assignments.map(assignment => ({
      day: assignment.day,
      hour: assignment.hour,
      duration: assignment.duration || 60,
      coach: assignment.coach
        ? (coachMap.get(assignment.coach.toString()) || assignment.coach)
        : 'Unbekannt'
    }));
  } else if (student.day && student.hour) {
    let coachName = 'Unbekannt';
    if (student.coach) {
      const coach = await Coach.findById(student.coach);
      if (coach) {
        coachName = `${coach.firstName} ${coach.lastName}`;
      } else {
        coachName = student.coach;
      }
    }
    schedule = [{
      day: student.day,
      hour: student.hour,
      duration: 60,
      coach: coachName
    }];
  }

  const dayOrder = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  schedule.sort((a, b) => {
    const dayComparison = dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day);
    if (dayComparison !== 0) return dayComparison;
    return a.hour - b.hour;
  });

  return schedule;
}

/**
 * @route   GET /api/portal/schedule
 * @desc    Get student's personalized schedule + children's schedules
 * @access  Private (student portal users only)
 */
router.get('/schedule', verifyPortalAuth, async (req, res) => {
  try {
    // Look up current portal user from DB (JWT may be stale after registration auto-creates student)
    const portalUser = await StudentPortalUser.findById(req.user.id);
    if (!portalUser) {
      return res.status(404).json({ error: 'Portal-Benutzer nicht gefunden' });
    }

    const studentId = portalUser.studentId || req.user.studentId;

    // Find parent's student record (may be null if only children are registered)
    const student = studentId ? await Student.findById(studentId) : null;
    const hasChildren = (portalUser.familyMembers || []).some(fm => fm.studentId);

    // No student record yet — return empty schedule (not 404)
    if (!student && !hasChildren) {
      return res.json({ student: null, schedule: [], period: null, trainingCount: null, holidays: [], familySchedules: [] });
    }

    // Find the RegistrationPeriod that covers today (training dates bracket today)
    const today = new Date();
    let period = await RegistrationPeriod.findOne({
      trainingStartDate: { $lte: today },
      trainingEndDate:   { $gte: today }
    }).sort({ trainingStartDate: -1 }).lean();

    // Fallback: most recent period by end date (even if season already ended)
    if (!period) {
      period = await RegistrationPeriod.findOne({})
        .sort({ trainingEndDate: -1 })
        .lean();
    }

    // If the schedule hasn't been published yet, return empty schedule with a flag.
    // Gate triggers when:
    //   - schedulePublished === false (explicitly unpublished), OR
    //   - schedulePublished is undefined/null AND training hasn't started yet (future season)
    // Exception: per-student scheduleVisible flag bypasses this gate (set by "Benachrichtigen")
    const trainingNotStarted = period && new Date(period.trainingStartDate) > new Date();
    const isUnpublished = period && (period.schedulePublished === false || (period.schedulePublished == null && trainingNotStarted));

    // Check if any linked student has scheduleVisible: true
    let hasVisibleSchedule = student?.scheduleVisible === true;
    if (!hasVisibleSchedule && hasChildren) {
      const childStudentIds = (portalUser.familyMembers || [])
        .filter(fm => fm.studentId)
        .map(fm => fm.studentId);
      if (childStudentIds.length > 0) {
        const visibleChild = await Student.findOne({ _id: { $in: childStudentIds }, scheduleVisible: true });
        hasVisibleSchedule = !!visibleChild;
      }
    }

    if (isUnpublished && !hasVisibleSchedule) {
      return res.json({
        student: student ? {
          firstName: student.firstName,
          lastName: student.lastName,
          adult: student.adult,
          skillLevel: student.skillLevel,
          trainigGroup: student.trainigGroup,
          frequence: student.frequence
        } : null,
        schedule: [],
        period: { start: period.trainingStartDate, end: period.trainingEndDate, name: period.name, holidaysComputed: !!period.holidaysComputedAt },
        trainingCount: null,
        holidays: [],
        familySchedules: [],
        schedulePublished: false,
      });
    }

    // If globally unpublished, only show schedule for students with scheduleVisible: true
    const perStudentMode = isUnpublished && hasVisibleSchedule;

    const schedule = (student && (!perStudentMode || student.scheduleVisible)) ? await buildScheduleForStudent(student) : [];

    // Compute training session count using pre-computed holidays + custom exclusions from DB
    let trainingCount = null;
    let holidayHits = [];

    // Only compute if admin has already run compute-holidays (computedHolidays is populated)
    if (period && schedule.length > 0 && period.computedHolidays && period.computedHolidays.length > 0) {
      const exclusionMap = buildExclusionMap(period.computedHolidays, period.trainingExclusions);
      trainingCount = 0;

      for (const a of schedule) {
        const dayNum = DAY_NAME_TO_NUM[a.day];
        if (dayNum === undefined) continue;
        const allDates = getDatesInRangeForDay(period.trainingStartDate, period.trainingEndDate, dayNum);
        for (const d of allDates) {
          const key = toDateKey(d);
          const excl = exclusionMap.get(key);
          const isExcluded = excl && (
            excl.isWholeDay ||
            excl.slots.some(s => s.day === a.day && s.hour === a.hour)
          );
          if (isExcluded) {
            holidayHits.push({ date: d, name: excl.name, day: a.day, hour: a.hour });
          } else {
            trainingCount++;
          }
        }
      }
    }
    // If computedHolidays is empty: trainingCount stays null → stats card hidden on frontend

    // Return student info + schedule + season stats
    // Build family member schedules (children with linked studentId)
    const familySchedules = [];
    const childMembers = (portalUser.familyMembers || []).filter(fm => fm.studentId);
    if (childMembers.length > 0) {
      const childStudentIds = childMembers.map(fm => fm.studentId);
      const childStudents = await Student.find({ _id: { $in: childStudentIds } });
      const childStudentMap = new Map(childStudents.map(s => [s._id.toString(), s]));

      for (const fm of childMembers) {
        const childStudent = childStudentMap.get(fm.studentId.toString());
        if (!childStudent) continue;
        // In per-student mode, skip children whose schedule hasn't been individually published
        if (perStudentMode && !childStudent.scheduleVisible) continue;

        const childSchedule = await buildScheduleForStudent(childStudent);

        // Compute training count for child (same logic as parent)
        let childTrainingCount = null;
        let childHolidayHits = [];
        if (period && childSchedule.length > 0 && period.computedHolidays && period.computedHolidays.length > 0) {
          const childExclusionMap = buildExclusionMap(period.computedHolidays, period.trainingExclusions);
          childTrainingCount = 0;
          for (const a of childSchedule) {
            const dayNum = DAY_NAME_TO_NUM[a.day];
            if (dayNum === undefined) continue;
            const allDates = getDatesInRangeForDay(period.trainingStartDate, period.trainingEndDate, dayNum);
            for (const d of allDates) {
              const key = toDateKey(d);
              const excl = childExclusionMap.get(key);
              const isExcluded = excl && (excl.isWholeDay || excl.slots.some(s => s.day === a.day && s.hour === a.hour));
              if (isExcluded) {
                childHolidayHits.push({ date: d, name: excl.name, day: a.day, hour: a.hour });
              } else {
                childTrainingCount++;
              }
            }
          }
        }

        familySchedules.push({
          familyMemberId: fm._id,
          childName: `${fm.firstName || ''} ${fm.lastName || ''}`.trim() || fm.name || 'Kind',
          student: {
            firstName: childStudent.firstName,
            lastName: childStudent.lastName,
            adult: childStudent.adult,
            skillLevel: childStudent.skillLevel,
            trainigGroup: childStudent.trainigGroup,
            frequence: childStudent.frequence
          },
          schedule: childSchedule,
          trainingCount: childTrainingCount,
          holidays: childHolidayHits,
        });
      }
    }

    res.json({
      student: student ? {
        firstName: student.firstName,
        lastName: student.lastName,
        adult: student.adult,
        skillLevel: student.skillLevel,
        trainigGroup: student.trainigGroup,
        frequence: student.frequence
      } : null,
      schedule,
      period: period ? {
        start: period.trainingStartDate,
        end:   period.trainingEndDate,
        name:  period.name,
        holidaysComputed: !!period.holidaysComputedAt,
      } : null,
      trainingCount,
      holidays: holidayHits,
      familySchedules,
      schedulePublished: true,
    });

  } catch (error) {
    logger.error("Error fetching portal schedule", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Laden des Trainingsplans' });
  }
});

/**
 * @route   GET /api/portal/announcements
 * @desc    Get active announcements for students
 * @access  Private (student portal users only)
 */
router.get('/announcements', verifyPortalAuth, async (req, res) => {
  try {
    const studentId = req.user.studentId;
    const now = new Date();

    // Build base query for announcements
    const query = {
      isActive: true,
      publishDate: { $lte: now },
      $or: [
        { expiryDate: null },
        { expiryDate: { $gt: now } }
      ]
    };

    // Filter by target audience if Student record exists
    if (studentId) {
      const student = await Student.findById(studentId);
      if (student) {
        // Filter based on adult/child status
        if (student.adult) {
          query.targetAudience = { $in: ['all', 'adults'] };
        } else {
          query.targetAudience = { $in: ['all', 'children'] };
        }
      } else {
        // Student ID exists but not found - show all announcements
        query.targetAudience = 'all';
      }
    } else {
      // No Student record yet - show only 'all' announcements
      query.targetAudience = 'all';
    }

    const announcements = await Announcement.find(query)
      .select('title content priority publishDate attachments')
      .limit(50)
      .lean();

    // Sort by priority (urgent > important > normal), then by publishDate descending
    const priorityOrder = { urgent: 0, important: 1, normal: 2 };
    announcements.sort((a, b) => {
      const pA = priorityOrder[a.priority] ?? 2;
      const pB = priorityOrder[b.priority] ?? 2;
      if (pA !== pB) return pA - pB;
      return new Date(b.publishDate) - new Date(a.publishDate);
    });

    res.json(announcements);

  } catch (error) {
    logger.error("Error fetching portal announcements", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Laden der Ankündigungen' });
  }
});

/**
 * @route   GET /api/portal/announcements/:id/attachments/:filename
 * @desc    Download an attachment for a portal user
 * @access  Private (student portal users only)
 */
router.get('/announcements/:id/attachments/:filename', verifyPortalAuth, async (req, res) => {
  try {
    const announcement = await Announcement.findOne({
      _id: req.params.id,
      isActive: true
    });
    if (!announcement) {
      return res.status(404).json({ error: 'Ankündigung nicht gefunden' });
    }

    const attachment = announcement.attachments.find(a => a.filename === req.params.filename);
    if (!attachment) {
      return res.status(404).json({ error: 'Anhang nicht gefunden' });
    }

    const filePath = path.join(uploadDir, attachment.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Datei nicht gefunden' });
    }

    res.setHeader('Content-Disposition', `inline; filename="${attachment.originalName}"`);
    res.setHeader('Content-Type', attachment.mimeType);
    res.sendFile(filePath);
  } catch (error) {
    logger.error("Error downloading portal announcement attachment", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Herunterladen des Anhangs' });
  }
});

/**
 * @route   GET /api/portal/profile
 * @desc    Get full student profile data for viewing/editing
 * @access  Private (student portal users only)
 */
router.get('/profile', verifyPortalAuth, async (req, res) => {
  try {
    const studentId = req.user.studentId;
    const portalUserId = req.user.id;

    // If user has a Student record, return Student data
    if (studentId) {
      const student = await Student.findById(studentId);
      if (!student) {
        // Stale studentId — Student was deleted. Fall through to portal user data below.
        logger.warn('Profile fetch: studentId set but Student not found, falling back to portal user', { studentId, portalUserId });
      } else {

      // Return full student data with flag indicating Student record exists
      // Also fetch pendingEmail from portalUser
      const portalUserForPending = await StudentPortalUser.findById(portalUserId).select('pendingEmail');
      return res.json({
        _id: student._id,
        firstName: student.firstName,
        lastName: student.lastName,
        birthDate: student.birthDate,
        sex: student.sex || '',
        member: student.member || false,
        email: student.email || '',
        phone: student.phone || '',
        address: student.adress || '',  // Map Student.adress to response.address
        ibanLast3: student.iban ? getIBANLast3(student.iban, true) : null,
        adult: student.adult,
        skillLevel: student.skillLevel || '',
        trainigGroup: student.trainigGroup || '',
        team: student.team || '',
        frequence: student.frequence || '',
        availableTimes: student.availableTimes || [],
        pendingEmail: portalUserForPending?.pendingEmail || null,
        hasStudentRecord: true
      });
      }
    }

    // If no Student record, return StudentPortalUser data
    const portalUser = await StudentPortalUser.findById(portalUserId);
    if (!portalUser) {
      return res.status(404).json({ error: 'Portal-Benutzer nicht gefunden' });
    }

    // Return portal user data (basic profile info only)
    res.json({
      _id: portalUser._id,
      firstName: portalUser.firstName,
      lastName: portalUser.lastName,
      birthDate: portalUser.birthdate,
      sex: portalUser.sex || '',
      member: portalUser.member || false,
      email: portalUser.email || '',
      phone: portalUser.phone || '',
      address: portalUser.address || '',
      ibanLast3: portalUser.iban ? getIBANLast3(portalUser.iban, true) : null,
      parentName: portalUser.parentName || '',
      parentEmail: portalUser.parentEmail || '',
      parentPhone: portalUser.parentPhone || '',
      isStudent: portalUser.isStudent || false,
      pendingEmail: portalUser.pendingEmail || null,
      hasStudentRecord: false
    });

  } catch (error) {
    logger.error("Error fetching profile", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Laden des Profils' });
  }
});

/**
 * @route   PUT /api/portal/profile
 * @desc    Update student profile information (all editable fields)
 * @access  Private (student portal users only)
 */
router.put('/profile', verifyPortalAuth, auditLogMiddleware({ action: 'UPDATE', resource: 'StudentProfile' }), async (req, res) => {
  try {
    const studentId = req.user.studentId;
    const portalUserId = req.user.id;
    // Accept both 'address' (correct) and 'adress' (legacy) for backward compatibility
    const { firstName, lastName, birthDate, sex, member, email, phone, address, adress, iban, parentName, parentEmail, parentPhone, isStudent } = req.body;
    const addressValue = address || adress;  // Prefer 'address', fall back to 'adress'

    // Validate required fields
    if (!firstName || firstName.trim() === '') {
      return res.status(400).json({ error: 'Vorname ist erforderlich' });
    }

    if (!lastName || lastName.trim() === '') {
      return res.status(400).json({ error: 'Nachname ist erforderlich' });
    }

    if (!birthDate) {
      return res.status(400).json({ error: 'Geburtsdatum ist erforderlich' });
    }

    if (!sex || !['männlich', 'weiblich', 'divers'].includes(sex)) {
      return res.status(400).json({ error: 'Geschlecht ist erforderlich' });
    }

    // Validate birthDate format and plausible year range
    const birthDateObj = new Date(birthDate);
    if (isNaN(birthDateObj.getTime())) {
      return res.status(400).json({ error: 'Ungültiges Geburtsdatum' });
    }
    const birthYear = birthDateObj.getFullYear();
    if (birthYear < 1900 || birthYear > new Date().getFullYear()) {
      return res.status(400).json({ error: 'Geburtsdatum muss zwischen 1900 und heute liegen' });
    }

    // Validate email format if provided (test trimmed value)
    if (email && email.trim() !== '') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return res.status(400).json({ error: 'Ungültige Email-Adresse' });
      }
      // Check for duplicate email (only if it differs from current email)
      const portalUserForCheck = await StudentPortalUser.findById(portalUserId).select('email');
      if (portalUserForCheck && email.trim().toLowerCase() !== portalUserForCheck.email) {
        const existing = await StudentPortalUser.findOne({ email: email.trim().toLowerCase(), _id: { $ne: portalUserId } });
        if (existing) {
          return res.status(400).json({ error: 'Diese E-Mail-Adresse wird bereits verwendet' });
        }
      }
    }

    // Validate phone format if provided (basic validation, test trimmed value)
    if (phone && phone.trim() !== '') {
      const phoneRegex = /^[\d\s+\-()]+$/;
      if (!phoneRegex.test(phone.trim())) {
        return res.status(400).json({ error: 'Ungültige Telefonnummer' });
      }
    }

    // Validate parent email format if provided
    if (parentEmail && parentEmail.trim() !== '') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(parentEmail.trim())) {
        return res.status(400).json({ error: 'Ungültige Email-Adresse des Elternteils' });
      }
    }

    // Validate and encrypt IBAN if provided
    let encryptedIBAN = null;
    if (iban && iban.trim() !== '') {
      const cleanIBAN = iban.replace(/\s/g, ''); // Remove spaces
      if (!validateIBANFormat(cleanIBAN)) {
        return res.status(400).json({ error: 'Ungültige IBAN' });
      }
      encryptedIBAN = encryptIBAN(cleanIBAN);
    }

    // If user has a Student record, update Student model
    if (studentId) {
      const student = await Student.findById(studentId);
      if (!student) {
        return res.status(404).json({ error: 'Schüler nicht gefunden' });
      }

      // Update all editable fields including name and birthdate
      student.firstName = firstName.trim();
      student.lastName = lastName.trim();
      student.birthDate = birthDateObj;
      student.sex = sex;
      student.member = member === true || member === 'true';
      student.phone = phone?.trim() || '';
      student.adress = addressValue?.trim() || '';  // Update Student.adress field (legacy)
      if (encryptedIBAN) {
        student.iban = encryptedIBAN;
      }

      await student.save();

      // Save IBAN separately via direct $set (bypasses Mongoose strict mode)
      if (encryptedIBAN) {
        await Student.updateOne(
          { _id: student._id },
          { $set: { iban: encryptedIBAN } }
        );
      }

      logger.info('Profile updated for student', { studentId: student._id, name: `${student.firstName} ${student.lastName}` });

      // Also update StudentPortalUser (keep both models in sync)
      const portalUser = await StudentPortalUser.findById(portalUserId);
      if (portalUser) {
        portalUser.firstName = firstName.trim();
        portalUser.lastName = lastName.trim();
        portalUser.birthdate = birthDateObj;
        portalUser.sex = sex;
        portalUser.member = member === true || member === 'true';
        portalUser.phone = phone?.trim() || '';
        if (addressValue && addressValue.trim() !== '') {
          portalUser.address = addressValue.trim();
        }
        // Update parent info if provided (for children)
        if (parentName !== undefined) {
          portalUser.parentName = parentName?.trim() || '';
        }
        if (parentEmail !== undefined) {
          portalUser.parentEmail = parentEmail?.trim().toLowerCase() || '';
        }
        if (parentPhone !== undefined) {
          portalUser.parentPhone = parentPhone?.trim() || '';
        }
        await portalUser.save();

        // Save IBAN separately via direct $set (bypasses Mongoose strict mode)
        if (encryptedIBAN) {
          await StudentPortalUser.updateOne(
            { _id: portalUserId },
            { $set: { iban: encryptedIBAN } }
          );
        }

        // Handle email change: pending flow (verify before activating)
        let pendingEmailResult = null;
        const newEmail = email?.trim().toLowerCase();
        if (newEmail && newEmail !== portalUser.email) {
          const token = crypto.randomBytes(32).toString('hex');
          const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
          const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
          await StudentPortalUser.updateOne(
            { _id: portalUserId },
            { $set: { pendingEmail: newEmail, emailChangeToken: hashedToken, emailChangeTokenExpires: expires } }
          );
          const studentName = `${portalUser.firstName} ${portalUser.lastName}`;
          try {
            const { sendEmailChangeVerification, sendEmailChangeWarning } = await import('../utils/emailService.js');
            await sendEmailChangeVerification(newEmail, token, studentName); // raw token in email link
            await sendEmailChangeWarning(portalUser.email, newEmail, studentName);
          } catch (emailError) {
            logger.error('Failed to send email change emails', { error: emailError.message });
          }
          pendingEmailResult = newEmail;
          logger.info('Email change requested', { userId: portalUserId, oldEmail: portalUser.email, newEmail });
        }
      }

      // Return updated student data
      const updatedPortalUser = await StudentPortalUser.findById(portalUserId).select('pendingEmail');
      return res.json({
        _id: student._id,
        firstName: student.firstName,
        lastName: student.lastName,
        birthDate: student.birthDate,
        sex: student.sex,
        member: student.member,
        email: student.email,
        phone: student.phone,
        address: student.adress,  // Map Student.adress to response.address
        ibanLast3: student.iban ? getIBANLast3(student.iban, true) : null,
        adult: student.adult,
        skillLevel: student.skillLevel || '',
        trainigGroup: student.trainigGroup || '',
        team: student.team || '',
        frequence: student.frequence || '',
        availableTimes: student.availableTimes || [],
        pendingEmail: updatedPortalUser?.pendingEmail || null,
        hasStudentRecord: true
      });
    }

    // If no Student record, update StudentPortalUser
    const portalUser = await StudentPortalUser.findById(portalUserId);
    if (!portalUser) {
      return res.status(404).json({ error: 'Portal-Benutzer nicht gefunden' });
    }

    // Update personal data in StudentPortalUser
    portalUser.firstName = firstName.trim();
    portalUser.lastName = lastName.trim();
    portalUser.birthdate = birthDateObj;
    portalUser.sex = sex;
    portalUser.member = member === true || member === 'true';

    // Track old parent values for admin notification
    const oldParentValues = {
      parentName: portalUser.parentName || '',
      parentEmail: portalUser.parentEmail || '',
      parentPhone: portalUser.parentPhone || ''
    };

    // Update phone and address (email handled separately via pending flow)
    portalUser.phone = phone?.trim() || '';
    if (addressValue && addressValue.trim() !== '') {
      portalUser.address = addressValue.trim();
    }
    // Update parent info if provided (for children)
    let parentInfoChanged = false;
    if (parentName !== undefined) {
      const newValue = parentName?.trim() || '';
      if (newValue !== oldParentValues.parentName) parentInfoChanged = true;
      portalUser.parentName = newValue;
    }
    if (parentEmail !== undefined) {
      const newValue = parentEmail?.trim().toLowerCase() || '';
      if (newValue !== oldParentValues.parentEmail) parentInfoChanged = true;
      portalUser.parentEmail = newValue;
    }
    if (parentPhone !== undefined) {
      const newValue = parentPhone?.trim() || '';
      if (newValue !== oldParentValues.parentPhone) parentInfoChanged = true;
      portalUser.parentPhone = newValue;
    }
    if (isStudent !== undefined) {
      portalUser.isStudent = isStudent === true || isStudent === 'true';
    }

    await portalUser.save();

    // Save IBAN separately via direct $set (bypasses Mongoose strict mode)
    if (encryptedIBAN) {
      await StudentPortalUser.updateOne(
        { _id: portalUserId },
        { $set: { iban: encryptedIBAN } }
      );
      portalUser.iban = encryptedIBAN;
    }

    // Send admin notification if parent info changed (for children)
    if (parentInfoChanged && portalUser.isChild && portalUser.isChild()) {
      try {
        const { sendParentInfoChangeNotification } = await import('../utils/emailService.js');
        await sendParentInfoChangeNotification({
          childName: `${portalUser.firstName} ${portalUser.lastName}`,
          childEmail: portalUser.email,
          oldValues: oldParentValues,
          newValues: {
            parentName: portalUser.parentName || '',
            parentEmail: portalUser.parentEmail || '',
            parentPhone: portalUser.parentPhone || ''
          }
        });
        logger.info('Admin notification sent for parent info change', { email: portalUser.email });
      } catch (emailError) {
        // Log but don't fail the request if email fails
        logger.error('Failed to send admin notification', { error: emailError.message, stack: emailError.stack });
      }
    }

    // Handle email change: pending flow (verify before activating)
    const newEmail = email?.trim().toLowerCase();
    if (newEmail && newEmail !== portalUser.email) {
      const token = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
      await StudentPortalUser.updateOne(
        { _id: portalUserId },
        { $set: { pendingEmail: newEmail, emailChangeToken: hashedToken, emailChangeTokenExpires: expires } }
      );
      const studentName = `${portalUser.firstName} ${portalUser.lastName}`;
      try {
        const { sendEmailChangeVerification, sendEmailChangeWarning } = await import('../utils/emailService.js');
        await sendEmailChangeVerification(newEmail, token, studentName); // raw token in email link
        await sendEmailChangeWarning(portalUser.email, newEmail, studentName);
      } catch (emailError) {
        logger.error('Failed to send email change emails', { error: emailError.message });
      }
      logger.info('Email change requested', { userId: portalUserId, oldEmail: portalUser.email, newEmail });
    }

    logger.info('Profile updated for portal user', { userId: portalUser._id, name: `${portalUser.firstName} ${portalUser.lastName}` });

    // Return updated portal user data
    const refreshedUser = await StudentPortalUser.findById(portalUserId).select('pendingEmail iban');
    res.json({
      _id: portalUser._id,
      firstName: portalUser.firstName,
      lastName: portalUser.lastName,
      birthDate: portalUser.birthdate,
      sex: portalUser.sex,
      member: portalUser.member,
      email: portalUser.email,
      phone: portalUser.phone,
      address: portalUser.address || '',
      ibanLast3: refreshedUser?.iban ? getIBANLast3(refreshedUser.iban, true) : null,
      parentName: portalUser.parentName || '',
      parentEmail: portalUser.parentEmail || '',
      parentPhone: portalUser.parentPhone || '',
      isStudent: portalUser.isStudent || false,
      pendingEmail: refreshedUser?.pendingEmail || null,
      hasStudentRecord: false
    });

  } catch (error) {
    logger.error("Error updating profile", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Aktualisieren des Profils' });
  }
});

/**
 * @route   DELETE /api/portal/profile/iban
 * @desc    Delete stored IBAN from user profile
 * @access  Private (student portal users only)
 */
router.delete('/profile/iban', verifyPortalAuth, auditLogMiddleware({ action: 'UPDATE', resource: 'StudentProfile', metadata: { operation: 'delete_iban' } }), async (req, res) => {
  try {
    const portalUserId = req.user.id;
    await StudentPortalUser.findByIdAndUpdate(portalUserId, { $unset: { iban: '' } });
    if (req.user.studentId) {
      await Student.findByIdAndUpdate(req.user.studentId, { $unset: { iban: '' } });
    }
    res.json({ success: true, message: 'IBAN erfolgreich gelöscht' });
  } catch (error) {
    logger.error('Error deleting IBAN', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Löschen der IBAN' });
  }
});

/**
 * @route   POST /api/portal/profile/complete
 * @desc    Complete user profile with address and parent info (for children)
 * @access  Private (student portal users only)
 */
router.post('/profile/complete', verifyPortalAuth, async (req, res) => {
  try {
    const portalUserId = req.user.id;
    const { address, parentName, parentEmail, parentPhone } = req.body;

    // Validate address (required for all)
    if (!address || address.trim().length === 0) {
      return res.status(400).json({ error: 'Adresse ist erforderlich' });
    }

    // Get portal user
    const portalUser = await StudentPortalUser.findById(portalUserId);
    if (!portalUser) {
      return res.status(404).json({ error: 'Portal-Benutzer nicht gefunden' });
    }

    // Check if email is verified
    if (!portalUser.emailVerified) {
      return res.status(400).json({
        error: 'Bitte verifizieren Sie zuerst Ihre E-Mail-Adresse',
        emailVerified: false
      });
    }

    // Check if user is a child - if so, parent info is required
    const isChild = portalUser.isChild();

    if (isChild) {
      if (!parentName || parentName.trim().length === 0) {
        return res.status(400).json({ error: 'Name eines Elternteils ist erforderlich für Kinder' });
      }
      if (!parentEmail || parentEmail.trim().length === 0) {
        return res.status(400).json({ error: 'E-Mail eines Elternteils ist erforderlich für Kinder' });
      }
      if (!parentPhone || parentPhone.trim().length === 0) {
        return res.status(400).json({ error: 'Telefonnummer eines Elternteils ist erforderlich für Kinder' });
      }

      // Validate parent email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(parentEmail.trim())) {
        return res.status(400).json({ error: 'Ungültige E-Mail-Adresse des Elternteils' });
      }
    }

    // Update portal user
    portalUser.address = address.trim();

    if (isChild) {
      portalUser.parentName = parentName.trim();
      portalUser.parentEmail = parentEmail.trim().toLowerCase();
      portalUser.parentPhone = parentPhone.trim();
    }

    portalUser.profileCompleted = true;
    await portalUser.save();

    res.json({
      message: 'Profil erfolgreich vervollständigt',
      profileCompleted: true,
      isChild
    });

  } catch (error) {
    logger.error("Error completing profile", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Vervollständigen des Profils' });
  }
});

/**
 * @route   POST /api/portal/schedule-change-requests
 * @desc    Create a new schedule change request
 * @access  Private (student portal users only)
 */
router.post('/schedule-change-requests', verifyPortalAuth, auditLogMiddleware({ action: 'CREATE', resource: 'ScheduleChangeRequest' }), async (req, res) => {
  try {
    const { requestType, currentSlot, requestedSlot, reason } = req.body;
    const studentId = req.user.studentId;
    const portalUserId = req.user.id; // Changed from userId to id for test compatibility

    // Validate request type
    if (!['add', 'remove', 'change'].includes(requestType)) {
      return res.status(400).json({ error: 'Ungültiger Anfragetyp' });
    }

    // Validate reason
    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ error: 'Begründung ist erforderlich' });
    }

    if (reason.length > 500) {
      return res.status(400).json({ error: 'Begründung ist zu lang (max. 500 Zeichen)' });
    }

    // Validate slots based on request type
    if ((requestType === 'remove' || requestType === 'change') && !currentSlot?.day) {
      return res.status(400).json({ error: 'Aktueller Trainingsslot ist erforderlich' });
    }

    if ((requestType === 'add' || requestType === 'change') && !requestedSlot?.day) {
      return res.status(400).json({ error: 'Gewünschter Trainingsslot ist erforderlich' });
    }

    // Check if student exists
    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ error: 'Schüler nicht gefunden' });
    }

    // Check if there's already a pending request for this student
    const existingPendingRequest = await ScheduleChangeRequest.findOne({
      studentId,
      status: 'pending'
    });

    if (existingPendingRequest) {
      return res.status(400).json({
        error: 'Du hast bereits eine offene Anfrage. Bitte warte auf die Bearbeitung.'
      });
    }

    // Create the request
    const changeRequest = new ScheduleChangeRequest({
      studentId,
      portalUserId,
      requestType,
      currentSlot: (requestType === 'remove' || requestType === 'change') ? currentSlot : undefined,
      requestedSlot: (requestType === 'add' || requestType === 'change') ? requestedSlot : undefined,
      reason: reason.trim()
    });

    await changeRequest.save();

    logger.info('Schedule change request created', { requestType, studentId: student._id, name: `${student.firstName} ${student.lastName}` });

    // Convert to plain object and return fields directly
    const savedRequest = changeRequest.toObject();
    res.status(201).json({
      message: 'Anfrage erfolgreich erstellt',
      ...savedRequest  // Spread request fields to top level
    });

  } catch (error) {
    logger.error("Error creating schedule change request", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Erstellen der Anfrage' });
  }
});

/**
 * @route   GET /api/portal/schedule-change-requests
 * @desc    Get student's schedule change requests (all statuses)
 * @access  Private (student portal users only)
 */
router.get('/schedule-change-requests', verifyPortalAuth, async (req, res) => {
  try {
    const studentId = req.user.studentId;

    // Find all requests for this student, sorted by most recent first
    const requests = await ScheduleChangeRequest.find({ studentId })
      .populate('reviewedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .lean();

    // Format requests for frontend
    const formattedRequests = requests.map(request => ({
      _id: request._id,
      requestType: request.requestType,
      currentSlot: request.currentSlot,
      requestedSlot: request.requestedSlot,
      reason: request.reason,
      status: request.status,
      adminResponse: request.adminResponse,
      reviewedBy: request.reviewedBy
        ? `${request.reviewedBy.firstName} ${request.reviewedBy.lastName}`
        : null,
      reviewedAt: request.reviewedAt,
      createdAt: request.createdAt
    }));

    res.json(formattedRequests);

  } catch (error) {
    logger.error("Error fetching schedule change requests", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Laden der Anfragen' });
  }
});

/**
 * @route   DELETE /api/portal/schedule-change-requests/:id
 * @desc    Cancel a pending schedule change request
 * @access  Private (student portal users only)
 */
router.delete('/schedule-change-requests/:id', verifyPortalAuth, auditLogMiddleware({ action: 'DELETE', resource: 'ScheduleChangeRequest' }), async (req, res) => {
  try {
    const requestId = req.params.id;
    const studentId = req.user.studentId;

    // Find the request
    const changeRequest = await ScheduleChangeRequest.findById(requestId);

    if (!changeRequest) {
      return res.status(404).json({ error: 'Anfrage nicht gefunden' });
    }

    // Verify this request belongs to the student (return 404 for security)
    if (changeRequest.studentId.toString() !== studentId.toString()) {
      return res.status(404).json({ error: 'Anfrage nicht gefunden' });
    }

    // Only allow cancellation of pending requests
    if (changeRequest.status !== 'pending') {
      return res.status(400).json({
        error: 'Nur offene Anfragen können storniert werden'
      });
    }

    await ScheduleChangeRequest.findByIdAndDelete(requestId);

    logger.info('Schedule change request cancelled', { requestId });

    res.json({ message: 'Anfrage erfolgreich storniert' });

  } catch (error) {
    logger.error("Error cancelling schedule change request", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Stornieren der Anfrage' });
  }
});

/**
 * @route   POST /api/portal/absences
 * @desc    Report an absence for a training session
 * @access  Private (student portal users only)
 */
router.post('/absences', verifyPortalAuth, auditLogMiddleware({ action: 'CREATE', resource: 'Absence' }), async (req, res) => {
  try {
    const { absenceDate, day, hour, coach, absenceType, reason } = req.body;
    const studentId = req.user.studentId;
    const portalUserId = req.user.id; // Changed from userId to id for test compatibility

    // Validate required fields
    if (!absenceDate || !day || !hour || !absenceType) {
      return res.status(400).json({ error: 'Alle Pflichtfelder müssen ausgefüllt werden' });
    }

    // Validate absence type
    if (!['illness', 'vacation', 'school', 'other'].includes(absenceType)) {
      return res.status(400).json({ error: 'Ungültiger Abwesenheitstyp' });
    }

    // Check if student exists
    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ error: 'Schüler nicht gefunden' });
    }

    // Check if absence already exists for this date/time
    const existingAbsence = await Absence.findOne({
      studentId,
      absenceDate: new Date(absenceDate),
      day,
      hour,
      status: { $in: ['pending', 'acknowledged'] }
    });

    if (existingAbsence) {
      return res.status(400).json({
        error: 'Abwesenheit für diesen Termin wurde bereits gemeldet'
      });
    }

    // Create absence notification
    const absence = new Absence({
      studentId,
      portalUserId,
      absenceDate: new Date(absenceDate),
      day,
      hour,
      coach: coach || null,
      absenceType,
      reason: reason?.trim() || null
    });

    await absence.save();

    logger.info('Absence reported', { studentId: student._id, name: `${student.firstName} ${student.lastName}`, day, hour, absenceDate });

    // Convert to plain object and return fields directly
    const savedAbsence = absence.toObject();
    res.status(201).json({
      message: 'Abwesenheit erfolgreich gemeldet',
      ...savedAbsence  // Spread absence fields to top level
    });

  } catch (error) {
    logger.error("Error creating absence", { error: error.message, stack: error.stack });

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const firstError = Object.values(error.errors)[0];
      return res.status(400).json({ error: firstError.message });
    }

    if (error.message.includes('vergangene Termine')) {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({ error: 'Serverfehler beim Melden der Abwesenheit' });
  }
});

/**
 * @route   GET /api/portal/absences/upcoming
 * @desc    Get upcoming absences for quick view (next 10)
 * @access  Private (student portal users only)
 * NOTE: This route MUST come before /absences/:id to avoid route conflicts
 */
router.get('/absences/upcoming', verifyPortalAuth, async (req, res) => {
  try {
    const studentId = req.user.studentId;

    const upcomingAbsences = await Absence.getUpcomingForStudent(studentId);

    res.json(upcomingAbsences);

  } catch (error) {
    logger.error("Error fetching upcoming absences", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Laden der Abwesenheiten' });
  }
});

/**
 * @route   GET /api/portal/absences
 * @desc    Get student's absence history (past and upcoming)
 * @access  Private (student portal users only)
 */
router.get('/absences', verifyPortalAuth, async (req, res) => {
  try {
    const studentId = req.user.studentId;
    const { status, upcoming } = req.query;

    // Build query
    const query = { studentId };

    if (status && ['pending', 'acknowledged', 'cancelled'].includes(status)) {
      query.status = status;
    }

    if (upcoming === 'true') {
      // Only upcoming absences
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      query.absenceDate = { $gte: today };
      query.status = { $in: ['pending', 'acknowledged'] };
    }

    // Find absences
    const absences = await Absence.find(query)
      .populate('acknowledgedBy', 'firstName lastName')
      .sort({ absenceDate: -1 })
      .limit(50)
      .lean();

    // Format absences for frontend
    const formattedAbsences = absences.map(absence => ({
      _id: absence._id,
      absenceDate: absence.absenceDate,
      day: absence.day,
      hour: absence.hour,
      coach: absence.coach,
      absenceType: absence.absenceType,
      reason: absence.reason,
      status: absence.status,
      acknowledgedBy: absence.acknowledgedBy
        ? `${absence.acknowledgedBy.firstName} ${absence.acknowledgedBy.lastName}`
        : null,
      acknowledgedAt: absence.acknowledgedAt,
      adminNotes: absence.adminNotes,
      createdAt: absence.createdAt
    }));

    res.json(formattedAbsences);

  } catch (error) {
    logger.error("Error fetching absences", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Laden der Abwesenheiten' });
  }
});

/**
 * @route   DELETE /api/portal/absences/:id
 * @desc    Cancel an absence notification (if plans change)
 * @access  Private (student portal users only)
 */
router.delete('/absences/:id', verifyPortalAuth, auditLogMiddleware({ action: 'DELETE', resource: 'Absence' }), async (req, res) => {
  try {
    const absenceId = req.params.id;
    const studentId = req.user.studentId;

    // Find the absence
    const absence = await Absence.findById(absenceId);

    if (!absence) {
      return res.status(404).json({ error: 'Abwesenheit nicht gefunden' });
    }

    // Verify this absence belongs to the student (return 404 for security)
    if (absence.studentId.toString() !== studentId.toString()) {
      return res.status(404).json({ error: 'Abwesenheit nicht gefunden' });
    }

    // Only allow deletion of pending absences
    if (absence.status !== 'pending') {
      return res.status(400).json({
        error: 'Nur ausstehende Abwesenheiten können gelöscht werden'
      });
    }

    // Only allow deletion of future absences
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const absDate = new Date(absence.absenceDate);
    absDate.setHours(0, 0, 0, 0);

    if (absDate < today) {
      return res.status(400).json({
        error: 'Vergangene Abwesenheiten können nicht gelöscht werden'
      });
    }

    // Delete the absence
    await Absence.findByIdAndDelete(absenceId);

    logger.info('Absence deleted', { absenceId });

    res.json({ message: 'Abwesenheit erfolgreich gelöscht' });

  } catch (error) {
    logger.error("Error deleting absence", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Löschen der Abwesenheit' });
  }
});

/**
 * @route   GET /api/portal/attendance/history
 * @desc    Get student's attendance history
 * @access  Private (student portal users only)
 */
router.get('/attendance/history', verifyPortalAuth, async (req, res) => {
  try {
    const studentId = req.user.studentId;
    const { limit } = req.query;

    const history = await Attendance.getStudentHistory(
      studentId,
      limit ? parseInt(limit, 10) : 50
    );

    res.json(history);

  } catch (error) {
    logger.error("Error fetching attendance history", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Laden der Anwesenheitshistorie' });
  }
});

/**
 * @route   GET /api/portal/attendance/statistics
 * @desc    Get student's attendance statistics
 * @access  Private (student portal users only)
 */
router.get('/attendance/statistics', verifyPortalAuth, async (req, res) => {
  try {
    const studentId = req.user.studentId;

    const statistics = await Attendance.getStudentStatistics(studentId);

    res.json(statistics);

  } catch (error) {
    logger.error("Error fetching attendance statistics", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Laden der Statistik' });
  }
});

export default router;
