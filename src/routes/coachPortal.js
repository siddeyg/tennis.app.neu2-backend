/**
 * Coach Portal Routes
 *
 * API endpoints for the Coach Portal mobile app.
 * Coaches can view today's schedule, mark attendance, and view statistics.
 *
 * All routes require authentication + trainer role.
 *
 * Created: 2025-11-10 (Phase 3 - Coach Portal)
 */

import express from 'express';
import Student from '../models/Student.js';
import Attendance from '../models/Attendance.js';
import Absence from '../models/Absence.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireCoach } from '../middleware/requireRole.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Apply authentication + coach role check to all routes
router.use(requireAuth);
router.use(requireCoach);

/**
 * GET /api/coach/schedule/today
 *
 * Get today's courses for the logged-in coach.
 * Returns courses with student lists, attendance status, and absence notifications.
 *
 * Response:
 * {
 *   date: "2025-11-10",
 *   dayName: "Montag",
 *   courses: [{
 *     hour: 14,
 *     trainingGroup: "Gelb Team",
 *     studentCount: 4,
 *     attendanceMarked: false,
 *     absenceNotifications: 1,
 *     students: [{ _id, firstName, lastName, age, hasAbsence }]
 *   }]
 * }
 */
router.get('/schedule/today', async (req, res) => {
  try {
    const coachId = req.user._id;

    // Get today's date
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    // Get day name in German
    const dayNames = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
    const dayName = dayNames[today.getDay()];


    // Find all students assigned to this coach for today
    const students = await Student.find({
      'assignments.coach': coachId,
      'assignments.day': dayName
    }).lean();


    // Group students by hour
    const coursesByHour = {};

    students.forEach(student => {
      // Find assignments for this coach on today's day
      const todayAssignments = student.assignments.filter(
        a => a.day === dayName && a.coach.toString() === coachId.toString()
      );

      todayAssignments.forEach(assignment => {
        const hour = assignment.hour;

        if (!coursesByHour[hour]) {
          coursesByHour[hour] = {
            hour,
            students: []
          };
        }

        // Calculate student age
        const birthDate = new Date(student.birthDate);
        const age = today.getFullYear() - birthDate.getFullYear();

        coursesByHour[hour].students.push({
          _id: student._id,
          firstName: student.firstName,
          lastName: student.lastName,
          age,
          trainigGroup: student.trainigGroup,
          skillLevel: student.skillLevel,
          adult: student.adult
        });
      });
    });

    // Check for attendance records and absence notifications
    const hours = Object.keys(coursesByHour).map(Number).sort((a, b) => a - b);

    const courses = await Promise.all(
      hours.map(async (hour) => {
        const course = coursesByHour[hour];

        // Check if attendance already marked
        const attendance = await Attendance.findOne({
          coach: coachId,
          courseDate: {
            $gte: today,
            $lt: tomorrow
          },
          day: dayName,
          hour
        }).lean();

        // Get absence notifications for today for these students
        const studentIds = course.students.map(s => s._id);
        const absences = await Absence.find({
          studentId: { $in: studentIds },
          absenceDate: {
            $gte: today,
            $lt: tomorrow
          }
        }).lean();

        // Mark which students have reported absence
        course.students.forEach(student => {
          const hasAbsence = absences.some(
            abs => abs.studentId.toString() === student._id.toString()
          );
          student.hasAbsence = hasAbsence;
        });

        // Determine training group (most common among students)
        const trainingGroups = {};
        course.students.forEach(s => {
          const group = s.adult ? s.skillLevel : s.trainigGroup;
          trainingGroups[group] = (trainingGroups[group] || 0) + 1;
        });
        const trainingGroup = Object.keys(trainingGroups).reduce((a, b) =>
          trainingGroups[a] > trainingGroups[b] ? a : b
        );

        return {
          hour,
          trainingGroup,
          studentCount: course.students.length,
          attendanceMarked: !!attendance,
          absenceNotifications: absences.length,
          students: course.students,
          // Include attendance ID if already marked (for editing)
          attendanceId: attendance ? attendance._id : null
        };
      })
    );

    res.json({
      date: today.toISOString().split('T')[0],
      dayName,
      courses
    });

  } catch (error) {
    logger.error('Coach Portal - Error getting today\'s schedule', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Fehler beim Laden des Stundenplans',
      message: error.message
    });
  }
});

/**
 * GET /api/coach/students
 *
 * Get all students in courses taught by this coach.
 * Used for viewing student profiles and contact information.
 *
 * Response:
 * [{
 *   _id, firstName, lastName, birthDate, age,
 *   trainigGroup, skillLevel, adult,
 *   phone, email,
 *   attendanceRate: 85
 * }]
 */
router.get('/students', async (req, res) => {
  try {
    const coachId = req.user._id;

    // Find all students assigned to this coach
    const students = await Student.find({
      'assignments.coach': coachId
    })
      .populate('assignments.coach', 'firstName lastName')
      .lean();

    // Get attendance statistics for each student
    const studentsWithStats = await Promise.all(
      students.map(async (student) => {
        const stats = await Attendance.getStudentStatistics(student._id);

        const birthDate = new Date(student.birthDate);
        const age = new Date().getFullYear() - birthDate.getFullYear();

        return {
          _id: student._id,
          firstName: student.firstName,
          lastName: student.lastName,
          birthDate: student.birthDate,
          age,
          trainigGroup: student.trainigGroup,
          skillLevel: student.skillLevel,
          adult: student.adult,
          phone: student.phone,
          email: student.email,
          adress: student.adress,
          assignments: student.assignments, // Include assignments with populated coach
          attendanceRate: stats.attendanceRate
        };
      })
    );

    res.json(studentsWithStats);

  } catch (error) {
    logger.error("[Coach Portal] Error getting students", { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Fehler beim Laden der Schülerliste',
      message: error.message
    });
  }
});

/**
 * GET /api/coach/stats
 *
 * Get attendance statistics for the coach.
 * Defaults to current week, supports date range query params.
 *
 * Query params:
 * - startDate: ISO date string (default: start of week)
 * - endDate: ISO date string (default: end of week)
 *
 * Response:
 * {
 *   totalCourses: 12,
 *   totalStudents: 45,
 *   totalPresent: 42,
 *   attendanceRate: 93,
 *   studentStats: [{
 *     studentId, firstName, lastName,
 *     present, absent, total, rate
 *   }],
 *   lowAttendanceStudents: [...]  // Students with rate < 70%
 * }
 */
router.get('/stats', async (req, res) => {
  try {
    const coachId = req.user._id;

    // Parse date range (default: this week)
    let startDate, endDate;
    if (req.query.startDate && req.query.endDate) {
      startDate = new Date(req.query.startDate);
      endDate = new Date(req.query.endDate);
    } else if (req.query.range) {
      // Handle range parameter (week or month)
      const today = new Date();
      const range = req.query.range;

      if (range === 'week') {
        // This week (Monday to Sunday)
        const dayOfWeek = today.getDay();
        const monday = new Date(today);
        monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
        monday.setHours(0, 0, 0, 0);

        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        sunday.setHours(23, 59, 59, 999);

        startDate = monday;
        endDate = sunday;
      } else if (range === 'month') {
        // This month (1st to last day)
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        firstDay.setHours(0, 0, 0, 0);

        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        lastDay.setHours(23, 59, 59, 999);

        startDate = firstDay;
        endDate = lastDay;
      } else {
        // Default to week if invalid range
        const dayOfWeek = today.getDay();
        const monday = new Date(today);
        monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
        monday.setHours(0, 0, 0, 0);

        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        sunday.setHours(23, 59, 59, 999);

        startDate = monday;
        endDate = sunday;
      }
    } else {
      // Default: Start of this week (Monday) to end of week (Sunday)
      const today = new Date();
      const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
      const monday = new Date(today);
      monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7)); // Go back to Monday
      monday.setHours(0, 0, 0, 0);

      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      sunday.setHours(23, 59, 59, 999);

      startDate = monday;
      endDate = sunday;
    }


    // Get all attendance records for this coach in date range
    const records = await Attendance.find({
      coach: coachId,
      courseDate: { $gte: startDate, $lte: endDate }
    })
      .populate('students.studentId', 'firstName lastName')
      .lean();

    // Calculate statistics
    let totalCourses = records.length;
    let totalStudents = 0;
    let totalPresent = 0;
    let totalAbsent = 0;
    let totalAbsentNotified = 0;
    let totalExcused = 0;

    const studentStats = {}; // studentId -> {present, absent, total, rate, firstName, lastName}

    records.forEach(record => {
      record.students.forEach(student => {
        const studentId = student.studentId._id.toString();

        // Initialize student stats if not exists
        if (!studentStats[studentId]) {
          studentStats[studentId] = {
            studentId: student.studentId._id,
            firstName: student.studentId.firstName,
            lastName: student.studentId.lastName,
            present: 0,
            absent: 0,
            absentNotified: 0,
            excused: 0,
            total: 0,
            rate: 0
          };
        }

        // Update counts
        totalStudents++;
        studentStats[studentId].total++;

        if (student.status === 'present') {
          totalPresent++;
          studentStats[studentId].present++;
        } else if (student.status === 'absent') {
          totalAbsent++;
          studentStats[studentId].absent++;
        } else if (student.status === 'absent_notified') {
          totalAbsentNotified++;
          studentStats[studentId].absentNotified++;
        } else if (student.status === 'excused') {
          totalExcused++;
          studentStats[studentId].excused++;
        }
      });
    });

    // Calculate attendance rate (2 decimal places)
    const attendanceRate = totalStudents > 0
      ? Math.round((totalPresent / totalStudents) * 10000) / 100
      : 0;

    // Calculate per-student rates and identify low attendance students
    const studentStatsList = Object.values(studentStats);
    studentStatsList.forEach(stat => {
      if (stat.total > 0) {
        stat.rate = Math.round((stat.present / stat.total) * 100);
      }
    });

    // Sort by rate (lowest first) and get students with < 70% attendance
    const lowAttendanceStudents = studentStatsList
      .filter(s => s.rate < 70 && s.total >= 3) // At least 3 sessions to be meaningful
      .sort((a, b) => a.rate - b.rate)
      .slice(0, 10); // Top 10 lowest

    res.json({
      range: req.query.range || 'week', // Include range parameter
      dateRange: {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0]
      },
      totalCourses,
      totalStudents,
      presentCount: totalPresent, // Match test expectations
      absentCount: totalAbsent,   // Match test expectations
      absentNotifiedCount: totalAbsentNotified,
      excusedCount: totalExcused,
      attendanceRate,
      studentStats: studentStatsList.sort((a, b) => a.rate - b.rate), // Sort by rate
      lowAttendanceStudents
    });

  } catch (error) {
    logger.error("[Coach Portal] Error getting stats", { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Fehler beim Laden der Statistiken',
      message: error.message
    });
  }
});

export default router;
