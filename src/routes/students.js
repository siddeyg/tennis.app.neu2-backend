import express from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import mongoose from "mongoose";
import Student from "../models/Student.js";
import logger from "../utils/logger.js";
import auditLogMiddleware from "../middleware/auditLog.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdminOrSupermod } from "../middleware/requireRole.js";

const router = express.Router();

// All student routes require admin or supermod authentication
router.use(requireAuth, requireAdminOrSupermod);

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

// Validation helper for student data
function validateStudentData(data) {
  const errors = [];

  // Name validation
  if (data.firstName && data.firstName.length > 100) {
    errors.push('Vorname zu lang (max 100 Zeichen)');
  }
  if (data.lastName && data.lastName.length > 100) {
    errors.push('Nachname zu lang (max 100 Zeichen)');
  }

  // Email validation (if provided)
  if (data.email && data.email.trim()) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      errors.push('Ungültige E-Mail-Adresse');
    }
  }

  // Birthdate validation
  if (data.birthdate || data.birthDate) {
    const dateStr = data.birthdate || data.birthDate;
    const birthDate = new Date(dateStr);
    const today = new Date();
    if (birthDate > today) {
      errors.push('Geburtsdatum darf nicht in der Zukunft liegen');
    }
    if (birthDate < new Date('1900-01-01')) {
      errors.push('Geburtsdatum zu weit in der Vergangenheit');
    }
    // Check for invalid date
    if (isNaN(birthDate.getTime())) {
      errors.push('Ungültiges Geburtsdatum-Format');
    }
  }

  // Phone validation (if provided)
  if (data.phone && data.phone.length > 20) {
    errors.push('Telefonnummer zu lang (max 20 Zeichen)');
  }

  // Frequency validation
  if (data.frequence && !['1', '2', '3'].includes(String(data.frequence))) {
    errors.push('Frequenz muss 1, 2 oder 3 sein');
  }

  // Skill level validation
  const validSkillLevels = ['Anfänger', 'Fortgeschritten', 'Fortgeschrittene', 'Turnierspieler', 'Anfänger mit Grundkenntnissen', 'Erfahrene Spieler:innen / Mannschaftsspieler:innen', 'Leistungsspieler:innen / Turnierspieler:innen', 'gute:r Spieler:in', 'wenig Fortgeschritten', 'Leistungsspieler:in'];
  if (data.skillLevel && !validSkillLevels.includes(data.skillLevel)) {
    errors.push('Ungültiges Spielniveau');
  }

  // Address validation (if provided)
  if (data.adress && data.adress.length > 200) {
    errors.push('Adresse zu lang (max 200 Zeichen)');
  }

  // Comment validation (if provided)
  if (data.comment && data.comment.length > 500) {
    errors.push('Kommentar zu lang (max 500 Zeichen)');
  }

  // Training group validation (if provided)
  if (data.trainigGroup && data.trainigGroup.length > 50) {
    errors.push('Trainingsgruppe zu lang (max 50 Zeichen)');
  }

  return errors;
}

// Multer configuration with file size and type validation
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
    files: 1 // Only 1 file at a time
  },
  fileFilter: (req, file, cb) => {
    // Only allow CSV files
    if (file.mimetype !== 'text/csv' && !file.originalname.endsWith('.csv')) {
      return cb(new Error('Nur CSV-Dateien erlaubt'), false);
    }
    cb(null, true);
  }
});

// Alle Schüler abrufen
router.get("/", async (req, res) => {
  const students = await Student.find();
  res.json(students);
});

// Schüler hinzufügen
router.post("/", auditLogMiddleware({ action: 'CREATE', resource: 'Student' }), async (req, res) => {
  try {
    // Validate required fields
    if (!req.body.firstName || !req.body.lastName) {
      return res.status(400).json({ error: "Vorname und Nachname sind erforderlich" });
    }

    // Validate input data
    const validationErrors = validateStudentData(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join(', ') });
    }

    // Note: Duplicate email check removed - families can share emails (parent email for multiple children)
    // Duplicate detection is handled on frontend with firstName + lastName + birthDate matching

    // Whitelist allowed fields — never pass req.body directly to the constructor
    // (mass assignment: attacker could set internal fields like assignments, priorityTime, iban)
    const {
      firstName, lastName, birthDate, adress, email, phone,
      member, adult, sex, team, trainigGroup, groupSize,
      skillLevel, availableTimes, comment, comment2, frequence,
    } = req.body;

    const student = new Student({
      firstName, lastName, birthDate, adress, email, phone,
      member, adult, sex, team, trainigGroup, groupSize,
      skillLevel, availableTimes, comment, comment2, frequence,
    });
    await student.save();
    res.status(201).json(student);
  } catch (error) {
    logger.error("Fehler beim Hinzufügen des Schülers", { error: error.message, stack: error.stack });
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: "Ungültige Eingabedaten", details: error.message });
    }
    res.status(500).json({ error: "Fehler beim Hinzufügen des Schülers" });
  }
});

// Alle Schüler löschen (muss vor /:id Route sein!)
router.delete("/all", auditLogMiddleware({ action: 'DELETE', resource: 'Student', metadata: { critical: true, operation: 'DELETE_ALL' } }), async (req, res) => {
  try {
    const result = await Student.deleteMany({});
    res.json({
      message: "Alle Schüler gelöscht",
      deletedCount: result.deletedCount
    });
  } catch (error) {
    logger.error("Fehler beim Löschen aller Schüler", { error: error.message, stack: error.stack });
    res.status(500).json({ error: "Fehler beim Löschen aller Schüler" });
  }
});

// ===== ASSIGNMENT ROUTES - MUST COME BEFORE GENERIC /:id ROUTES =====

// Add assignment to student (for multiple course assignments)
router.post("/:id/assignments", auditLogMiddleware({ action: 'CREATE', resource: 'StudentAssignment' }), async (req, res) => {
  try {
    const { day, coach, duration, isPinned } = req.body;
    const hour = Number(req.body.hour); // Always store hour as Number for consistent $pull matching
    const assignmentDuration = [60, 90].includes(Number(duration)) ? Number(duration) : 60;

    if (!day || isNaN(hour)) {
      return res.status(400).json({ error: "Tag und Stunde sind erforderlich" });
    }

    // No capacity cap on manual placement — admin can overfill a slot intentionally.
    // The algorithm enforces its own max-4 cap in resetScheduleOptimized.js.

    const student = await Student.findByIdAndUpdate(
      req.params.id,
      { $push: { assignments: { day, hour, coach: coach || null, duration: assignmentDuration, isPinned: !!isPinned } } },
      { new: true, lean: true }
    ).populate({ path: 'portalUser', strictPopulate: false });

    if (!student) {
      return res.status(404).json({ error: "Schüler nicht gefunden" });
    }

    res.json(student);
  } catch (error) {
    logger.error("Fehler beim Hinzufügen der Zuweisung", {
      error: error.message,
      studentId: req.params.id,
      stack: error.stack
    });
    if (error.name === 'BSONError' || error.name === 'CastError') {
      return res.status(400).json({ error: "Ungültige Schüler-ID", details: error.message });
    }
    res.status(500).json({ error: "Fehler beim Hinzufügen der Zuweisung" });
  }
});

// Remove specific assignment from student
router.delete("/:id/assignments", auditLogMiddleware({ action: 'DELETE', resource: 'StudentAssignment' }), async (req, res) => {
  try {
    const { day, hour } = req.body;
    // Coerce hour to Number — MongoDB $pull is type-strict, and hour may be stored as Number
    const numericHour = Number(hour);

    if (!day || isNaN(numericHour)) {
      return res.status(400).json({ error: "Tag und Stunde sind erforderlich" });
    }

    const student = await Student.findByIdAndUpdate(
      req.params.id,
      {
        $pull: { assignments: { day, hour: numericHour } }
      },
      { new: true, lean: true }
    ).populate({ path: 'portalUser', strictPopulate: false });

    if (!student) {
      return res.status(404).json({ error: "Schüler nicht gefunden" });
    }

    res.json(student);
  } catch (error) {
    logger.error("Fehler beim Entfernen der Zuweisung", {
      error: error.message,
      studentId: req.params.id,
      stack: error.stack
    });
    if (error.name === 'BSONError' || error.name === 'CastError') {
      return res.status(400).json({ error: "Ungültige Schüler-ID", details: error.message });
    }
    res.status(500).json({ error: "Fehler beim Entfernen der Zuweisung" });
  }
});

// Replace specific assignment (move student - update one assignment, preserve others)
router.put("/:id/assignments/replace", auditLogMiddleware({ action: 'UPDATE', resource: 'StudentAssignment' }), async (req, res) => {
  try {
    const { day, coach, fromDay, duration, isPinned } = req.body;
    // Coerce hours to Number for consistent storage and $pull matching
    const hour = req.body.hour !== null && req.body.hour !== undefined ? Number(req.body.hour) : req.body.hour;
    const fromHour = req.body.fromHour !== null && req.body.fromHour !== undefined ? Number(req.body.fromHour) : req.body.fromHour;
    const assignmentDuration = [60, 90].includes(Number(duration)) ? Number(duration) : 60;

    // Allow null values for clearing assignments (algorithm reset)
    if (day === null && hour === null) {
      const student = await Student.findByIdAndUpdate(
        req.params.id,
        { assignments: [], scheduleVisible: false },
        { new: true, lean: true }
      );

      if (!student) {
        return res.status(404).json({ error: "Schüler nicht gefunden" });
      }

      return res.json(student);
    }

    if (!day || hour === null || hour === undefined) {
      return res.status(400).json({ error: "Tag und Stunde sind erforderlich" });
    }

    // If fromDay/fromHour provided, update specific assignment (multi-assignment mode)
    // Otherwise, replace all assignments (legacy single-assignment mode)
    let student;

    if (fromDay && fromHour) {
      // Atomic replace: fetch → splice old → push new → save within transaction (if supported)
      const useTransactions = process.env.USE_TRANSACTIONS === 'true';

      let session = null;
      if (useTransactions) {
        session = await mongoose.startSession();
        await session.startTransaction();
      }

      try {
        const doc = useTransactions && session
          ? await Student.findById(req.params.id).session(session)
          : await Student.findById(req.params.id);

        if (!doc) {
          if (useTransactions && session) await session.abortTransaction();
          return res.status(404).json({ error: "Schüler nicht gefunden", searchedId: req.params.id });
        }

        const oldIndex = doc.assignments.findIndex(
          a => a.day === fromDay && Number(a.hour) === Number(fromHour)
        );
        
        let originalIsPinned = false;
        if (oldIndex !== -1) {
          originalIsPinned = doc.assignments[oldIndex].isPinned;
          doc.assignments.splice(oldIndex, 1);
        }

        const finalIsPinned = isPinned !== undefined ? !!isPinned : !!originalIsPinned;

        doc.assignments.push({ day, hour, coach: coach || null, duration: assignmentDuration, isPinned: finalIsPinned });

        await (useTransactions && session ? doc.save({ session }) : doc.save());

        if (useTransactions && session) {
          await session.commitTransaction();
        }

        student = doc.toObject();
      } catch (txError) {
        if (useTransactions && session) {
          await session.abortTransaction();
        }
        throw txError;
      } finally {
        if (useTransactions && session) {
          session.endSession();
        }
      }
    } else {
      // Replace all assignments
      student = await Student.findByIdAndUpdate(
        req.params.id,
        { assignments: [{ day, hour, coach: coach || null, duration: assignmentDuration, isPinned: !!isPinned }] },
        { new: true, lean: true }
      );
    }

    if (!student) {
      return res.status(404).json({ error: "Schüler nicht gefunden", searchedId: req.params.id });
    }

    res.json(student);
  } catch (error) {
    logger.error("[assignments/replace] EXCEPTION", { error: error.message, stack: error.stack });
    if (error.name === 'CastError' || error.name === 'BSONError') {
      return res.status(400).json({ error: "Ungültige Schüler-ID", details: error.message });
    }
    res.status(500).json({ error: "Fehler beim Ersetzen der Zuweisungen", details: error.message });
  }
});

// ===== GENERIC /:id ROUTES - MUST COME AFTER SPECIFIC ROUTES =====

// Schüler löschen
router.delete("/:id", auditLogMiddleware({ action: 'DELETE', resource: 'Student' }), async (req, res) => {
  try {
    const studentId = req.params.id;

    // 1. Reset linked seasonal registrations back to pending (orphan prevention)
    const SeasonalRegistration = mongoose.model('SeasonalRegistration');
    const linkedRegistrations = await SeasonalRegistration.find({ studentId });

    if (linkedRegistrations.length > 0) {
      await SeasonalRegistration.updateMany(
        { studentId },
        {
          $set: {
            status: 'pending',
            processedAt: null,
            processedBy: null
          },
          $unset: { studentId: "" }
        }
      );
      logger.info(`Reset ${linkedRegistrations.length} seasonal registration(s) to pending after student deletion`, {
        studentId,
        registrationIds: linkedRegistrations.map(r => r._id)
      });
    }

    // 2. Nullify StudentPortalUser.studentId (prevents broken portal logins)
    const StudentPortalUser = mongoose.model('StudentPortalUser');
    const portalUsers = await StudentPortalUser.find({ studentId });
    if (portalUsers.length > 0) {
      await StudentPortalUser.updateMany(
        { studentId },
        { $unset: { studentId: "" } }
      );
      logger.info(`Unlinked studentId from ${portalUsers.length} portal user(s)`, {
        studentId,
        portalUserIds: portalUsers.map(u => u._id)
      });
    }

    // 3. Nullify familyMembers[].studentId references (prevents broken family management)
    const usersWithFamilyLink = await StudentPortalUser.find({ 'familyMembers.studentId': studentId });
    for (const user of usersWithFamilyLink) {
      user.familyMembers.forEach(member => {
        if (member.studentId && member.studentId.toString() === studentId.toString()) {
          member.studentId = null;
        }
      });
      await user.save();
    }
    if (usersWithFamilyLink.length > 0) {
      logger.info(`Unlinked familyMember.studentId in ${usersWithFamilyLink.length} portal user(s)`, { studentId });
    }

    // 4. Delete student
    const student = await Student.findByIdAndDelete(studentId);

    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    const message = linkedRegistrations.length > 0
      ? `Student deleted and ${linkedRegistrations.length} registration(s) reset to pending`
      : "Student deleted";

    res.json({
      message,
      resetRegistrations: linkedRegistrations.length,
      portalUsersUnlinked: portalUsers.length,
      familyMembersUnlinked: usersWithFamilyLink.length
    });
  } catch (error) {
    logger.error("Fehler beim Löschen des Schülers", { error: error.message, stack: error.stack });
    if (error.name === 'CastError') {
      return res.status(400).json({ error: "Ungültige Schüler-ID" });
    }
    res.status(500).json({ error: "Fehler beim Löschen des Schülers" });
  }
});

// Schüler-Daten aktualisieren
router.put("/:id", auditLogMiddleware({ action: 'UPDATE', resource: 'Student' }), async (req, res) => {
  try {
    const studentId = req.params.id;

    // Capture BEFORE state
    const beforeState = await Student.findById(studentId).lean();
    if (!beforeState) {
      return res.status(404).json({ error: "Schüler nicht gefunden" });
    }

    const {
      firstName,
      lastName,
      birthDate,
      adress,
      email,
      member,
      adult,
      sex,
      team,
      trainigGroup,
      groupSize,
      phone,
      skillLevel,
      availableTimes,
      comment,
      frequence,
      assignments,
    } = req.body;

    // Validate input data
    const validationErrors = validateStudentData(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join(', ') });
    }

    // Note: Duplicate email check removed - families can share emails
    // Duplicate detection is handled on frontend

    const updateData = {
      adress,
      email,
      phone,
      member,
      adult,
      sex,
      team,
      trainigGroup,
      groupSize,
      firstName,
      lastName,
      birthDate,
      skillLevel,
      availableTimes,
      comment,
      frequence,
    };

    // Only update assignments if explicitly provided in request body
    // Omitting the field must never clear existing assignments
    if (req.body.assignments !== undefined) {
      updateData.assignments = Array.isArray(assignments) ? assignments : [];
      // Reset per-student schedule visibility when algorithm overwrites assignments
      // Only reset if assignments actually changed (avoid resetting on admin profile edits
      // where StudentForm spreads the whole object including unchanged assignments)
      const oldAssignments = JSON.stringify((beforeState.assignments || []).map(a => ({ day: a.day, hour: a.hour, coach: String(a.coach || ''), duration: a.duration || 60 })));
      const newAssignments = JSON.stringify((updateData.assignments || []).map(a => ({ day: a.day, hour: Number(a.hour), coach: String(a.coach || ''), duration: a.duration || 60 })));
      if (oldAssignments !== newAssignments) {
        updateData.scheduleVisible = false;
      }
    }

    const student = await Student.findByIdAndUpdate(
      studentId,
      updateData,
      { new: true, lean: true }
    );

    if (!student) {
      return res.status(404).json({ error: "Schüler nicht gefunden" });
    }

    // Attach before/after to req for audit log
    req.auditMetadata = {
      before: beforeState,
      after: student,
      changes: getChangedFields(beforeState, student)
    };

    res.json(student);
  } catch (error) {
    logger.error("Fehler beim Aktualisieren des Schülers", { error: error.message, stack: error.stack });
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: "Ungültige Eingabedaten", details: error.message });
    }
    if (error.name === 'CastError') {
      return res.status(400).json({ error: "Ungültige Schüler-ID" });
    }
    res.status(500).json({ error: "Fehler beim Aktualisieren des Schülers" });
  }
});

// CSV Import
router.post("/import", upload.single('file'), auditLogMiddleware({ action: 'CREATE', resource: 'Student', metadata: { bulk: true, operation: 'CSV_IMPORT' } }), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Keine Datei hochgeladen" });
    }

    // Validate file size (additional check beyond multer limits)
    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ error: "Datei zu groß (max 5MB)" });
    }

    // Parse CSV with proper library
    let csvText = req.file.buffer.toString('utf-8');

    // Remove BOM if present
    if (csvText.charCodeAt(0) === 0xFEFF) {
      csvText = csvText.substring(1);
    }

    // Parse CSV using csv-parse library (properly handles quoted fields with commas)
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true
    });

    if (records.length === 0) {
      return res.status(400).json({ error: "CSV-Datei ist leer" });
    }

    // Convert CSV records to student objects with validation
    const students = [];
    const validationIssues = [];

    records.forEach((row, index) => {
      const studentData = {};

      // Map CSV columns to student model fields
      studentData.firstName = (row['Vorname'] || '').trim();
      studentData.lastName = (row['Nachname'] || '').trim();
      studentData.birthDate = (row['Geburtsdatum'] || '').trim();
      studentData.email = (row['Email'] || '').trim();
      studentData.phone = (row['Telefon'] || '').trim();
      studentData.adress = (row['Adresse'] || '').trim();
      studentData.adult = row['Erwachsen'] === 'Ja';
      studentData.member = row['Mitglied'] === 'Ja';
      studentData.team = row['Teamspieler'] === 'Ja';
      studentData.skillLevel = (row['Spielstärke'] || '').trim();
      studentData.trainigGroup = (row['Trainingsgruppe'] || '').trim();
      studentData.sex = (row['Geschlecht'] || '').trim();
      studentData.frequence = (row['Häufigkeit'] || '').trim();
      studentData.comment = (row['Kommentar'] || '').trim();

      // Parse available times from day columns
      studentData.availableTimes = [];
      const days = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
      days.forEach(day => {
        const hoursString = row[day];
        if (hoursString && hoursString.trim()) {
          const hours = hoursString.split(',').map(h => h.trim()).filter(h => h);
          hours.forEach(hour => {
            studentData.availableTimes.push({ day, hour, venue: '' });
          });
        }
      });

      // Validate each student record
      const errors = validateStudentData(studentData);
      if (errors.length > 0) {
        validationIssues.push({
          row: index + 1,
          student: `${studentData.firstName} ${studentData.lastName}`,
          errors: errors
        });
      } else if (studentData.firstName && studentData.lastName) {
        // Only add if first and last name are present
        students.push(studentData);
      } else {
        validationIssues.push({
          row: index + 1,
          student: '<Unbekannt>',
          errors: ['Vorname und Nachname sind erforderlich']
        });
      }
    });

    // If there are validation issues, report them instead of importing
    if (validationIssues.length > 0) {
      logger.warn("CSV Import - Validation issues detected", { issues: validationIssues });
      return res.status(400).json({
        error: "CSV-Datei enthält ungültige Einträge",
        validationIssues: validationIssues,
        validCount: students.length,
        invalidCount: validationIssues.length
      });
    }

    // Use transaction to ensure atomic delete+insert (all-or-nothing, if supported)
    const useTransactions = process.env.USE_TRANSACTIONS === 'true';

    let session = null;
    if (useTransactions) {
      session = await mongoose.startSession();
      await session.startTransaction();
    }

    try {
      // Delete all existing students (within transaction if supported)
      await Student.deleteMany({}, useTransactions ? { session } : {});

      // Insert new students (within transaction if supported)
      const insertedStudents = await Student.insertMany(
        students,
        useTransactions ? { session } : {}
      );

      // Commit transaction - both operations succeed
      if (useTransactions && session) {
        await session.commitTransaction();
        logger.info("CSV Import - Transaction committed successfully", { count: insertedStudents.length });
      } else {
        logger.info("CSV Import - Completed (no transaction support)", { count: insertedStudents.length });
      }

      res.json({
        message: "Import erfolgreich",
        imported: insertedStudents.length
      });
    } catch (transactionError) {
      // Rollback transaction - restore all deleted students (if transaction was used)
      if (useTransactions && session) {
        await session.abortTransaction();
        console.error("CSV Import - Transaction aborted, all changes rolled back");
        transactionError.isTransactionRollback = true;
      } else {
        console.error("CSV Import - Failed (no transaction, database may be inconsistent!)");
      }
      throw transactionError; // Re-throw to outer catch block
    } finally {
      if (useTransactions && session) {
        session.endSession();
      }
    }

  } catch (error) {
    logger.error("Fehler beim CSV-Import", { error: error.message, stack: error.stack });

    // Distinguish between multer file validation errors and other errors
    if (error.message.includes('Nur CSV-Dateien erlaubt')) {
      return res.status(400).json({ error: "Nur CSV-Dateien erlaubt" });
    }
    if (error.message.includes('File too large')) {
      return res.status(400).json({ error: "Datei zu groß (max 5MB)" });
    }

    // If transaction rollback occurred, reassure user their data is safe
    if (error.isTransactionRollback) {
      return res.status(500).json({
        error: "CSV-Import fehlgeschlagen",
        details: error.message,
        dataSafe: true,
        message: "Alle bestehenden Daten wurden wiederhergestellt. Keine Daten verloren."
      });
    }

    res.status(500).json({ error: "Fehler beim CSV-Import", details: error.message });
  }
});

// GET gender detection results
router.get("/gender-detection-results", async (req, res) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    // Path to detection results (generated by detect-gender-enhanced.mjs)
    const resultsPath = path.join(__dirname, '../../gender-detection-enhanced-results.json');

    if (!fs.existsSync(resultsPath)) {
      return res.status(404).json({
        error: "Detection results not found. Please run: node detect-gender-enhanced.mjs"
      });
    }

    const resultsData = fs.readFileSync(resultsPath, 'utf-8');
    const results = JSON.parse(resultsData);

    res.json(results);
  } catch (error) {
    logger.error("Error loading gender detection results", { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

export default router;
