import express from "express";
import SavedSchedule from "../models/SavedSchedule.js";
import Student from "../models/Student.js";
import Coach from "../models/Coach.js";
import Schedule from "../models/Schedule.js";
import { getAuth } from "@clerk/express";

const router = express.Router();

// GET all saved schedules
router.get("/", async (req, res) => {
  try {
    const savedSchedules = await SavedSchedule.find().sort({ createdAt: -1 });
    res.json(savedSchedules);
  } catch (error) {
    console.error("Error fetching saved schedules:", error);
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
    console.error("Error fetching saved schedule:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST - Save current schedule state
router.post("/", async (req, res) => {
  try {
    const { name, description } = req.body;
    const { userId } = getAuth(req);

    // Get user email from Clerk (available in req.auth)
    const userEmail = req.auth.sessionClaims?.email || "unknown@example.com";

    // Fetch current state from database
    const students = await Student.find();
    const coaches = await Coach.find();
    const schedule = await Schedule.find();

    // Calculate unassigned students
    const studentsNotSet = students.filter(
      (s) => !s.day || s.hour === null || s.hour === undefined
    );

    // Create saved schedule
    const savedSchedule = new SavedSchedule({
      name,
      description,
      createdBy: userId,
      createdByEmail: userEmail,
      students: students,
      coaches: coaches,
      schedule: schedule,
      studentsNotSet: studentsNotSet,
      metadata: {
        studentCount: students.length,
        coachCount: coaches.length,
        courseCount: schedule.length,
        unassignedCount: studentsNotSet.length,
      },
    });

    await savedSchedule.save();

    res.status(201).json(savedSchedule);
  } catch (error) {
    console.error("Error saving schedule:", error);
    res.status(500).json({ error: error.message });
  }
});

// PUT - Update saved schedule (rename/edit description)
router.put("/:id", async (req, res) => {
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
    console.error("Error updating saved schedule:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE - Remove saved schedule
router.delete("/:id", async (req, res) => {
  try {
    const savedSchedule = await SavedSchedule.findByIdAndDelete(req.params.id);

    if (!savedSchedule) {
      return res.status(404).json({ error: "Saved schedule not found" });
    }

    res.json({ message: "Saved schedule deleted successfully" });
  } catch (error) {
    console.error("Error deleting saved schedule:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST - Load saved schedule (replace current DB state)
router.post("/:id/load", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const userEmail = req.auth.sessionClaims?.email || "unknown@example.com";

    // Get the saved schedule
    const savedSchedule = await SavedSchedule.findById(req.params.id);
    if (!savedSchedule) {
      return res.status(404).json({ error: "Saved schedule not found" });
    }

    // Step 1: Create automatic backup of current state
    const currentStudents = await Student.find();
    const currentCoaches = await Coach.find();
    const currentSchedule = await Schedule.find();
    const currentUnassigned = currentStudents.filter(
      (s) => !s.day || s.hour === null || s.hour === undefined
    );

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
        courseCount: currentSchedule.length,
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

      // Update coach reference if it exists
      if (student.coach && coachIdMap.has(String(student.coach))) {
        student.coach = coachIdMap.get(String(student.coach));
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
      message: "Schedule loaded successfully",
      backupId: backup._id,
      backupName: backup.name,
      studentsRestored: savedSchedule.students.length,
      coachesRestored: savedSchedule.coaches.length,
      coursesRestored: savedSchedule.schedule.length,
    });
  } catch (error) {
    console.error("Error loading saved schedule:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
