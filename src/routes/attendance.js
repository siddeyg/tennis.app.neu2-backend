/**
 * Attendance Routes
 *
 * API endpoints for marking and managing attendance records.
 * - Coaches can mark and edit attendance (within 2-hour window)
 * - Admins can override/edit any attendance
 *
 * Created: 2025-11-10 (Phase 3 - Coach Portal)
 */

import express from 'express';
import Attendance from '../models/Attendance.js';
import Student from '../models/Student.js';
import Absence from '../models/Absence.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireCoach } from '../middleware/requireRole.js';
import { requireRole } from '../middleware/requireRole.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * POST /api/attendance
 *
 * Mark attendance for a course.
 * Only coaches can create attendance records.
 *
 * Request body:
 * {
 *   courseDate: "2025-11-10",
 *   day: "Montag",
 *   hour: 14,
 *   students: [
 *     { studentId: "...", status: "present" },
 *     { studentId: "...", status: "absent" },
 *     { studentId: "...", status: "absent_notified" }
 *   ]
 * }
 *
 * Response:
 * {
 *   _id: "...",
 *   courseDate, day, hour, coach,
 *   students: [...],
 *   markedBy, markedAt
 * }
 */
router.post('/', requireAuth, requireCoach, async (req, res) => {
  try {
    const { courseDate, day, hour, students } = req.body;
    const coachId = req.user._id;

    // Validation
    if (!courseDate || !day || !hour || !students || !Array.isArray(students)) {
      return res.status(400).json({
        error: 'Fehlende oder ungültige Daten',
        message: 'courseDate, day, hour und students sind erforderlich'
      });
    }

    if (students.length === 0) {
      return res.status(400).json({
        error: 'Keine Schüler angegeben',
        message: 'Die Schülerliste darf nicht leer sein'
      });
    }

    // Check if attendance already exists for this course
    const existing = await Attendance.findOne({
      courseDate: new Date(courseDate),
      day,
      hour,
      coach: coachId
    });

    if (existing) {
      return res.status(400).json({
        error: 'Anwesenheit bereits erfasst',
        message: 'Für diesen Kurs wurde bereits Anwesenheit erfasst. Verwenden Sie PUT /api/attendance/:id zum Bearbeiten.'
      });
    }


    // Get absence notifications for this date to auto-mark students
    const studentIds = students.map(s => s.studentId);
    const courseDateObj = new Date(courseDate);
    const nextDay = new Date(courseDateObj);
    nextDay.setDate(nextDay.getDate() + 1);

    const absences = await Absence.find({
      studentId: { $in: studentIds },
      absenceDate: {
        $gte: courseDateObj,
        $lt: nextDay
      }
    }).lean();

    // Update status for students who reported absence
    const studentsWithAbsences = students.map(student => {
      const hasAbsence = absences.some(
        abs => abs.studentId.toString() === student.studentId.toString()
      );

      return {
        studentId: student.studentId,
        status: hasAbsence && student.status !== 'present'
          ? 'absent_notified'
          : student.status,
        notes: student.notes || ''
      };
    });

    // Create attendance record
    const attendance = new Attendance({
      courseDate: new Date(courseDate),
      day,
      hour,
      coach: coachId,
      students: studentsWithAbsences,
      markedBy: req.user._id,
      markedAt: new Date()
    });

    await attendance.save();


    res.status(201).json(attendance);

  } catch (error) {
    logger.error("[Attendance] Error creating attendance", { error: error.message, stack: error.stack });

    if (error.code === 11000) {
      // Duplicate key error (unique index violation)
      return res.status(400).json({
        error: 'Anwesenheit bereits erfasst',
        message: 'Für diesen Kurs existiert bereits ein Anwesenheitseintrag'
      });
    }

    res.status(500).json({
      error: 'Fehler beim Speichern der Anwesenheit',
      message: error.message
    });
  }
});

/**
 * PUT /api/attendance/:id
 *
 * Edit existing attendance record.
 * - Coaches can edit within 2 hours of course end
 * - Admins can edit anytime
 *
 * Request body:
 * {
 *   students: [
 *     { studentId: "...", status: "present", notes: "..." },
 *     ...
 *   ]
 * }
 *
 * Response: Updated attendance record
 */
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const attendanceId = req.params.id;
    const { students } = req.body;
    const userId = req.user._id;
    const userRole = req.user.role;

    // Validation
    if (!students || !Array.isArray(students)) {
      return res.status(400).json({
        error: 'Ungültige Daten',
        message: 'students Array ist erforderlich'
      });
    }

    // Find attendance record
    const attendance = await Attendance.findById(attendanceId);

    if (!attendance) {
      return res.status(404).json({
        error: 'Anwesenheit nicht gefunden',
        message: `Kein Anwesenheitseintrag mit ID ${attendanceId} gefunden`
      });
    }

    // Authorization check
    const isCoach = userRole === 'trainer';
    const isAdmin = userRole === 'admin';
    const isOwnCourse = attendance.coach.toString() === userId.toString();

    if (isCoach) {
      // Coaches can only edit their own courses
      if (!isOwnCourse) {
        return res.status(403).json({
          error: 'Keine Berechtigung',
          message: 'Sie können nur Anwesenheit für Ihre eigenen Kurse bearbeiten'
        });
      }

      // Coaches can only edit within 2-hour window
      if (!attendance.canEditByCoach()) {
        return res.status(403).json({
          error: 'Bearbeitungszeit abgelaufen',
          message: 'Anwesenheit kann nur innerhalb von 2 Stunden nach Kursende bearbeitet werden. Kontaktieren Sie einen Admin.'
        });
      }
    } else if (!isAdmin) {
      // Must be either coach or admin
      return res.status(403).json({
        error: 'Keine Berechtigung',
        message: 'Nur Trainer und Admins können Anwesenheit bearbeiten'
      });
    }


    // Update students array
    attendance.students = students.map(s => ({
      studentId: s.studentId,
      status: s.status,
      notes: s.notes || ''
    }));

    // Track edit metadata
    attendance.editedBy = userId;
    attendance.editedAt = new Date();

    await attendance.save();


    // Populate for response
    await attendance.populate('students.studentId', 'firstName lastName');

    res.json(attendance);

  } catch (error) {
    logger.error("[Attendance] Error updating attendance", { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Fehler beim Aktualisieren der Anwesenheit',
      message: error.message
    });
  }
});

/**
 * GET /api/attendance
 *
 * Get attendance records.
 * Coaches see only their own courses, admins see all.
 * Supports filtering by date range via query params.
 *
 * Query params:
 * - startDate: Filter records from this date (ISO string)
 * - endDate: Filter records until this date (ISO string)
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;
    const { startDate, endDate } = req.query;

    // Build query
    const query = {};

    // Coaches can only see their own records
    if (userRole === 'trainer') {
      query.coach = userId;
    }
    // Admins can see all records (no coach filter)

    // Date filtering
    if (startDate || endDate) {
      query.courseDate = {};
      if (startDate) {
        query.courseDate.$gte = new Date(startDate);
      }
      if (endDate) {
        query.courseDate.$lte = new Date(endDate);
      }
    }

    const records = await Attendance.find(query)
      .populate('coach', 'firstName lastName')
      .populate('students.studentId', 'firstName lastName')
      .populate('markedBy', 'firstName lastName')
      .sort({ courseDate: -1, hour: -1 })
      .lean();

    res.json(records);

  } catch (error) {
    logger.error("[Attendance] Error fetching attendance records", { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Fehler beim Laden der Anwesenheitsdaten',
      message: error.message
    });
  }
});

/**
 * GET /api/attendance/:id
 *
 * Get a specific attendance record.
 * Coaches can view their own courses, admins can view all.
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const attendanceId = req.params.id;
    const userId = req.user._id;
    const userRole = req.user.role;

    const attendance = await Attendance.findById(attendanceId)
      .populate('students.studentId', 'firstName lastName birthDate')
      .populate('coach', 'firstName lastName')
      .populate('markedBy', 'firstName lastName')
      .populate('editedBy', 'firstName lastName')
      .lean();

    if (!attendance) {
      return res.status(404).json({
        error: 'Anwesenheit nicht gefunden'
      });
    }

    // Authorization: Coaches can only view their own courses
    if (userRole === 'trainer' && attendance.coach._id.toString() !== userId.toString()) {
      return res.status(403).json({
        error: 'Keine Berechtigung',
        message: 'Sie können nur Ihre eigenen Kurse ansehen'
      });
    }

    res.json(attendance);

  } catch (error) {
    logger.error("[Attendance] Error fetching attendance", { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Fehler beim Laden der Anwesenheit',
      message: error.message
    });
  }
});

/**
 * DELETE /api/attendance/:id
 *
 * Delete an attendance record (admin only).
 * Coaches cannot delete attendance records.
 */
router.delete('/:id', requireAuth, requireRole(['admin']), async (req, res) => {
  try {
    const attendanceId = req.params.id;

    const attendance = await Attendance.findByIdAndDelete(attendanceId);

    if (!attendance) {
      return res.status(404).json({
        error: 'Anwesenheit nicht gefunden'
      });
    }


    res.json({
      message: 'Anwesenheit erfolgreich gelöscht',
      _id: attendanceId
    });

  } catch (error) {
    logger.error("[Attendance] Error deleting attendance", { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Fehler beim Löschen der Anwesenheit',
      message: error.message
    });
  }
});

export default router;
