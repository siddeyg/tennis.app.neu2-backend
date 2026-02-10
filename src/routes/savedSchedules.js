import express from "express";
import SavedSchedule from "../models/SavedSchedule.js";
import RegistrationPeriod from "../models/RegistrationPeriod.js";
import Student from "../models/Student.js";
import Coach from "../models/Coach.js";
import Schedule from "../models/Schedule.js";
import logger from '../utils/logger.js';
import auditLogMiddleware from '../middleware/auditLog.js';

const router = express.Router();

// GET all saved schedules
router.get("/", async (req, res) => {
  try {
    const savedSchedules = await SavedSchedule.find().sort({ createdAt: -1 });
    res.json(savedSchedules);
  } catch (error) {
    logger.error("Error fetching saved schedules", { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

// GET specific saved schedule by ID
router.get("/:id", async (req, res) => {
  try {
    const savedSchedule = await SavedSchedule.findById(req.params.id);
    if (!savedSchedule) {
      return res.status(404).json({ error: "Saved schedule not found" });
    }
    res.json(savedSchedule);
  } catch (error) {
    logger.error("Error fetching saved schedule", { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

// POST - Save current schedule state
router.post("/", auditLogMiddleware({ action: 'CREATE', resource: 'SavedSchedule' }), async (req, res) => {
  try {
    const { name, description, periodId } = req.body;

    // Validate periodId is provided
    if (!periodId) {
      return res.status(400).json({
        error: "periodId is required. Plans must be linked to a registration period."
      });
    }

    // Validate period exists
    const period = await RegistrationPeriod.findById(periodId);
    if (!period) {
      return res.status(404).json({
        error: "Registration period not found"
      });
    }

    // Validate period is not closed/archived (can't save to closed periods)
    if (period.status === 'closed' || period.status === 'archived') {
      return res.status(403).json({
        error: "Cannot save plan to a closed or archived registration period"
      });
    }

    // User info (will be replaced by new auth system)
    const userId = "system-user";
    const userEmail = "system@example.com";

    // Calculate version number (count existing plans for this period + 1)
    const existingPlansCount = await SavedSchedule.countDocuments({ periodId });
    const version = existingPlansCount + 1;

    // Fetch current state from database
    const students = await Student.find();
    const coaches = await Coach.find();
    const schedule = await Schedule.find();

    // Calculate unassigned students
    const studentsNotSet = students.filter(
      (s) => !s.day || s.hour === null || s.hour === undefined
    );

    // Calculate actual course count (only count time slots with at least 1 student)
    const actualCourseCount = schedule.filter(
      (course) => course.students && course.students.length > 0
    ).length;

    // Calculate possible courses (count each coach-time combination)
    // Each coach at each time slot = one possible course
    let possibleCourseCount = 0;

    coaches.forEach(coach => {
      if (Array.isArray(coach.availableTimes)) {
        possibleCourseCount += coach.availableTimes.length;
      }
    });

    // Create saved schedule
    const savedSchedule = new SavedSchedule({
      name,
      description,
      periodId,
      version,
      createdBy: userId,
      createdByEmail: userEmail,
      students: students,
      coaches: coaches,
      schedule: schedule,
      studentsNotSet: studentsNotSet,
      metadata: {
        studentCount: students.length,
        coachCount: coaches.length,
        courseCount: actualCourseCount,
        possibleCourseCount: possibleCourseCount,
        unassignedCount: studentsNotSet.length,
      },
    });

    await savedSchedule.save();

    // Auto-update period's currentPlanId to this new plan
    period.currentPlanId = savedSchedule._id;
    await period.save();

    logger.info('Saved schedule for period', { periodName: period.name, version, scheduleId: savedSchedule._id });

    res.status(201).json(savedSchedule);
  } catch (error) {
    logger.error("Error saving schedule", { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

// POST /import - Create saved schedule from imported JSON data
router.post("/import", auditLogMiddleware({ action: 'IMPORT', resource: 'SavedSchedule', metadata: { critical: true } }), async (req, res) => {
  try {
    const { name, description, students, coaches, schedule } = req.body;

    // Validate required fields
    if (!students || !coaches || !schedule) {
      return res.status(400).json({
        error: "Invalid import data: missing required fields (students, coaches, schedule)"
      });
    }

    // User info (will be replaced by new auth system)
    const userId = "system-user";
    const userEmail = "system@example.com";

    // Calculate unassigned students from imported data
    const studentsNotSet = students.filter(
      (s) => !s.day || s.hour === null || s.hour === undefined
    );

    // Calculate actual course count from imported data
    const actualCourseCount = schedule.filter(
      (course) => course.students && course.students.length > 0
    ).length;

    // Calculate possible courses from imported coaches
    let possibleCourseCount = 0;
    coaches.forEach(coach => {
      if (Array.isArray(coach.availableTimes)) {
        possibleCourseCount += coach.availableTimes.length;
      }
    });

    // Create saved schedule with imported data
    const savedSchedule = new SavedSchedule({
      name,
      description: description || "Importiert aus JSON-Datei",
      createdBy: userId,
      createdByEmail: userEmail,
      students: students,
      coaches: coaches,
      schedule: schedule,
      studentsNotSet: studentsNotSet,
      metadata: {
        studentCount: students.length,
        coachCount: coaches.length,
        courseCount: actualCourseCount,
        possibleCourseCount: possibleCourseCount,
        unassignedCount: studentsNotSet.length,
      },
    });

    await savedSchedule.save();

    res.status(201).json(savedSchedule);
  } catch (error) {
    logger.error("Error importing schedule", { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

// PUT - Update saved schedule (rename/edit description)
router.put("/:id", auditLogMiddleware({ action: 'UPDATE', resource: 'SavedSchedule' }), async (req, res) => {
  try {
    const { name, description } = req.body;

    const savedSchedule = await SavedSchedule.findByIdAndUpdate(
      req.params.id,
      { name, description },
      { new: true, runValidators: true }
    );

    if (!savedSchedule) {
      return res.status(404).json({ error: "Saved schedule not found" });
    }

    res.json(savedSchedule);
  } catch (error) {
    logger.error("Error updating saved schedule", { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

// DELETE - Remove saved schedule
router.delete("/:id", auditLogMiddleware({ action: 'DELETE', resource: 'SavedSchedule', metadata: { critical: true } }), async (req, res) => {
  try {
    const savedSchedule = await SavedSchedule.findByIdAndDelete(req.params.id);

    if (!savedSchedule) {
      return res.status(404).json({ error: "Saved schedule not found" });
    }

    res.json({ message: "Saved schedule deleted successfully" });
  } catch (error) {
    logger.error("Error deleting saved schedule", { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

// POST - Load saved schedule (replace current DB state)
router.post("/:id/load", auditLogMiddleware({ action: 'UPDATE', resource: 'Schedule', metadata: { critical: true, action: 'load_saved_schedule' } }), async (req, res) => {
  try {
    // User info (will be replaced by new auth system)
    const userId = "system-user";
    const userEmail = "system@example.com";

    // Get the saved schedule with populated period
    const savedSchedule = await SavedSchedule.findById(req.params.id)
      .populate('periodId');
    if (!savedSchedule) {
      return res.status(404).json({ error: "Saved schedule not found" });
    }

    // Check if period is closed/archived → view-only mode
    let viewOnly = false;
    if (savedSchedule.periodId) {
      const periodStatus = savedSchedule.periodId.status;
      if (periodStatus === 'closed' || periodStatus === 'archived') {
        viewOnly = true;

        // Return view-only response (don't actually load into DB)
        return res.json({
          success: true,
          viewOnly: true,
          message: "This plan belongs to a closed period and is read-only",
          period: savedSchedule.periodId,
          plan: savedSchedule,
          // Send plan data but don't modify DB
          studentsPreview: savedSchedule.students.length,
          coachesPreview: savedSchedule.coaches.length,
          coursesPreview: savedSchedule.schedule.length
        });
      }
    }

    // Step 1: Create automatic backup of current state
    const currentStudents = await Student.find();
    const currentCoaches = await Coach.find();
    const currentSchedule = await Schedule.find();
    const currentUnassigned = currentStudents.filter(
      (s) => !s.day || s.hour === null || s.hour === undefined
    );

    // Calculate actual course count for backup
    const backupCourseCount = currentSchedule.filter(
      (course) => course.students && course.students.length > 0
    ).length;

    // Calculate possible courses for backup (count each coach-time combination)
    let backupPossibleCourseCount = 0;
    currentCoaches.forEach(coach => {
      if (Array.isArray(coach.availableTimes)) {
        backupPossibleCourseCount += coach.availableTimes.length;
      }
    });

    const backupName = `Backup vor Laden - ${new Date().toLocaleString("de-DE")}`;
    const backup = new SavedSchedule({
      name: backupName,
      description: `Automatisches Backup vor Laden von "${savedSchedule.name}"`,
      createdBy: userId,
      createdByEmail: userEmail,
      students: currentStudents,
      coaches: currentCoaches,
      schedule: currentSchedule,
      studentsNotSet: currentUnassigned,
      metadata: {
        studentCount: currentStudents.length,
        coachCount: currentCoaches.length,
        courseCount: backupCourseCount,
        possibleCourseCount: backupPossibleCourseCount,
        unassignedCount: currentUnassigned.length,
      },
    });
    await backup.save();

    // Step 2: Clear current database
    await Student.deleteMany({});
    await Coach.deleteMany({});
    await Schedule.deleteMany({});

    // Step 3: Restore from saved schedule
    // Insert coaches first (students reference them)
    const coachIdMap = new Map(); // old ID -> new ID mapping

    for (const coach of savedSchedule.coaches) {
      const oldId = coach._id;
      delete coach._id; // Remove old ID to generate new one

      const newCoach = new Coach(coach);
      await newCoach.save();

      coachIdMap.set(String(oldId), String(newCoach._id));
    }

    // Insert students with updated coach references
    const studentIdMap = new Map();

    for (const student of savedSchedule.students) {
      const oldId = student._id;
      delete student._id;

      // Update coach reference if it exists (legacy field)
      if (student.coach && coachIdMap.has(String(student.coach))) {
        student.coach = coachIdMap.get(String(student.coach));
      }

      // Update coach references in assignments array
      if (Array.isArray(student.assignments)) {
        student.assignments = student.assignments.map(assignment => {
          if (assignment.coach && coachIdMap.has(String(assignment.coach))) {
            return {
              ...assignment,
              coach: coachIdMap.get(String(assignment.coach))
            };
          }
          return assignment;
        });
      }

      const newStudent = new Student(student);
      await newStudent.save();

      studentIdMap.set(String(oldId), String(newStudent._id));
    }

    // Insert schedule with updated student references
    for (const scheduleItem of savedSchedule.schedule) {
      delete scheduleItem._id;

      // Update student references in course
      if (Array.isArray(scheduleItem.students)) {
        scheduleItem.students = scheduleItem.students.map((s) => {
          const oldStudentId = s._id || s;
          return studentIdMap.get(String(oldStudentId)) || s;
        });
      }

      const newScheduleItem = new Schedule(scheduleItem);
      await newScheduleItem.save();
    }

    res.json({
      success: true,
      viewOnly: false,
      message: "Schedule loaded successfully",
      period: savedSchedule.periodId,
      plan: savedSchedule,
      backupId: backup._id,
      backupName: backup.name,
      studentsRestored: savedSchedule.students.length,
      coachesRestored: savedSchedule.coaches.length,
      coursesRestored: savedSchedule.schedule.length,
    });
  } catch (error) {
    logger.error("Error loading saved schedule", { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

export default router;
