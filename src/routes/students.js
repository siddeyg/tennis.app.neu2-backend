import express from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import mongoose from "mongoose";
import Student from "../models/Student.js";
import logger from "../utils/logger.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Alle Schüler abrufen
router.get("/", async (req, res) => {
  const students = await Student.find();
  res.json(students);
});

// Schüler hinzufügen
router.post("/", async (req, res) => {
  try {
    // Validate required fields
    if (!req.body.firstName || !req.body.lastName) {
      return res.status(400).json({ error: "Vorname und Nachname sind erforderlich" });
    }

    // Note: Duplicate email check removed - families can share emails (parent email for multiple children)
    // Duplicate detection is handled on frontend with firstName + lastName + birthDate matching

    // Sanitize coach field: convert empty string to null (Mongoose expects ObjectId or null, not "")
    const studentData = { ...req.body };
    if (studentData.coach === "" || studentData.coach === undefined) {
      studentData.coach = null;
    }

    const student = new Student(studentData);
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
router.delete("/all", async (req, res) => {
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
router.post("/:id/assignments", async (req, res) => {
  try {
    const { day, hour, coach } = req.body;

    if (!day || !hour) {
      return res.status(400).json({ error: "Tag und Stunde sind erforderlich" });
    }

    // Try both string ID and ObjectId format for compatibility
    // Local DB may use ObjectId, server DB may use string IDs
    const result = await Student.collection.findOneAndUpdate(
      { _id: req.params.id },
      {
        $push: { assignments: { day, hour, coach: coach || null } },
        $set: { day, hour, coach: coach || null }
      },
      { returnDocument: 'after' }
    );

    const student = result.value;

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
router.delete("/:id/assignments", async (req, res) => {
  try {
    const { day, hour } = req.body;

    if (!day || !hour) {
      return res.status(400).json({ error: "Tag und Stunde sind erforderlich" });
    }

    // Step 1: Remove the assignment
    let result = await Student.collection.findOneAndUpdate(
      { _id: req.params.id },
      {
        $pull: { assignments: { day, hour } }
      },
      { returnDocument: 'after' }
    );

    const student = result.value;

    if (!student) {
      return res.status(404).json({ error: "Schüler nicht gefunden" });
    }

    // Step 2: Update legacy fields based on remaining assignments
    const updateLegacy = {};
    if (student.assignments && student.assignments.length > 0) {
      updateLegacy.day = student.assignments[0].day;
      updateLegacy.hour = student.assignments[0].hour;
      updateLegacy.coach = student.assignments[0].coach;
    } else {
      updateLegacy.day = null;
      updateLegacy.hour = null;
      updateLegacy.coach = null;
    }

    // Update legacy fields
    await Student.collection.findOneAndUpdate(
      { _id: req.params.id },
      { $set: updateLegacy },
      { returnDocument: 'after' }
    );

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
router.put("/:id/assignments/replace", async (req, res) => {
  try {
    const { day, hour, coach, fromDay, fromHour } = req.body;


    // Allow null values for clearing assignments (algorithm reset)
    if (day === null && hour === null) {

      // Clear all assignments
      const updateOperation = {
        $set: {
          assignments: [],
          day: null,
          hour: null,
          coach: null
        }
      };

      const result = await Student.collection.findOneAndUpdate(
        { _id: req.params.id },
        updateOperation,
        { returnDocument: 'after' }
      );

      const student = result.value;

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
    let result;

    if (fromDay && fromHour) {

      // Step 1: Remove old assignment
      const updateOperation = {
        $pull: { assignments: { day: fromDay, hour: Number(fromHour) } }
      };

      result = await Student.collection.findOneAndUpdate(
        { _id: req.params.id },
        updateOperation,
        { returnDocument: 'after' }
      );

      // Step 2: Add new assignment
      if (result.value) {
        const addOperation = {
          $push: { assignments: { day, hour, coach: coach || null } },
          $set: { day, hour, coach: coach || null }
        };

        result = await Student.collection.findOneAndUpdate(
          { _id: req.params.id },
          addOperation,
          { returnDocument: 'after' }
        );
      }
    } else {

      // Replace all assignments
      const updateOperation = {
        $set: {
          assignments: [{ day, hour, coach: coach || null }],
          day,
          hour,
          coach: coach || null
        }
      };

      result = await Student.collection.findOneAndUpdate(
        { _id: req.params.id },
        updateOperation,
        { returnDocument: 'after' }
      );
    }

    const student = result.value;

    if (!student) {
      const samples = await Student.find({}, { _id: 1, firstName: 1, lastName: 1 }).limit(3);
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
router.delete("/:id", async (req, res) => {
  try {

    const result = await Student.collection.findOneAndDelete(
      { _id: req.params.id }
    );

    const student = result.value;


    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }
    res.json({ message: "Student deleted" });
  } catch (error) {
    logger.error("Fehler beim Löschen des Schülers", { error: error.message, stack: error.stack });
    if (error.name === 'CastError') {
      return res.status(400).json({ error: "Ungültige Schüler-ID" });
    }
    res.status(500).json({ error: "Fehler beim Löschen des Schülers" });
  }
});

// Schüler-Daten aktualisieren
router.put("/:id", async (req, res) => {
  try {
    const {
      day,
      hour,
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
      coach,
      frequence,
      assignments,
    } = req.body;

    // Note: Duplicate email check removed - families can share emails
    // Duplicate detection is handled on frontend

    // Sanitize coach field: convert empty string to null (Mongoose expects ObjectId or null, not "")
    const sanitizedCoach = (coach === "" || coach === undefined) ? null : coach;

    if (assignments && assignments.length > 0) {
    }

    const updateData = {
      $set: {
        day,
        hour,
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
        coach: sanitizedCoach,
        frequence,
        assignments: assignments || [],
      }
    };

    const result = await Student.collection.findOneAndUpdate(
      { _id: req.params.id },
      updateData,
      { returnDocument: 'after' }
    );

    const student = result.value;

    if (!student) {
      return res.status(404).json({ error: "Schüler nicht gefunden" });
    }


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
router.post("/import", upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Keine Datei hochgeladen" });
    }

    // Parse CSV with proper library
    let csvText = req.file.buffer.toString('utf-8');

    // Remove BOM if present
    if (csvText.charCodeAt(0) === 0xFEFF) {
      csvText = csvText.substring(1);
    }

    console.log("CSV Import - Parsing with csv-parse library...");

    // Parse CSV using csv-parse library (properly handles quoted fields with commas)
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true
    });

    console.log(`CSV Import - Parsed ${records.length} records`);

    if (records.length === 0) {
      return res.status(400).json({ error: "CSV-Datei ist leer" });
    }

    // Convert CSV records to student objects
    const students = records.map(row => {
      const studentData = {};

      // Map CSV columns to student model fields
      studentData.firstName = row['Vorname'] || '';
      studentData.lastName = row['Nachname'] || '';
      studentData.birthDate = row['Geburtsdatum'] || '';
      studentData.email = row['Email'] || '';
      studentData.phone = row['Telefon'] || '';
      studentData.adress = row['Adresse'] || '';
      studentData.adult = row['Erwachsen'] === 'Ja';
      studentData.member = row['Mitglied'] === 'Ja';
      studentData.team = row['Teamspieler'] === 'Ja';
      studentData.skillLevel = row['Spielstärke'] || '';
      studentData.trainigGroup = row['Trainingsgruppe'] || '';
      studentData.sex = row['Geschlecht'] || '';
      studentData.frequence = row['Häufigkeit'] || '';
      studentData.day = row['Zugewiesener Tag'] || '';
      studentData.hour = row['Zugewiesene Stunde'] ? parseInt(row['Zugewiesene Stunde']) : null;
      // Coach field requires ObjectId, but CSV has names - set to null for now
      // TODO: Look up coach by name and store their ObjectId
      studentData.coach = null;
      studentData.comment = row['Kommentar'] || '';

      // Parse available times from day columns
      studentData.availableTimes = [];
      const days = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
      days.forEach(day => {
        const hoursString = row[day];
        if (hoursString && hoursString.trim()) {
          const hours = hoursString.split(',').map(h => h.trim()).filter(h => h);
          hours.forEach(hour => {
            studentData.availableTimes.push(`${day} ${hour}`);
          });
        }
      });

      return studentData;
    });

    console.log(`CSV Import - Converted to ${students.length} student objects`);
    console.log("Sample student:", students[0]);

    // Delete all existing students
    await Student.deleteMany({});
    console.log("CSV Import - Deleted existing students");

    // Insert new students
    const insertedStudents = await Student.insertMany(students);
    console.log(`CSV Import - Inserted ${insertedStudents.length} students`);

    res.json({
      message: "Import erfolgreich",
      imported: insertedStudents.length
    });

  } catch (error) {
    logger.error("Fehler beim CSV-Import", { error: error.message, stack: error.stack });
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
