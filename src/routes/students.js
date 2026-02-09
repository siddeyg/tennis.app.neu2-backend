import express from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import mongoose from "mongoose";
import Student from "../models/Student.js";

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
    console.error("Fehler beim Hinzufügen des Schülers:", error);
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
    console.error("Fehler beim Löschen aller Schüler:", error);
    res.status(500).json({ error: "Fehler beim Löschen aller Schüler" });
  }
});

// ===== ASSIGNMENT ROUTES - MUST COME BEFORE GENERIC /:id ROUTES =====

// Add assignment to student (for multiple course assignments)
router.post("/:id/assignments", async (req, res) => {
  try {
    const { day, hour, coach } = req.body;

    console.log(`[POST /assignments] Adding assignment to student ${req.params.id}`);
    console.log(`[POST /assignments] Assignment: ${day} ${hour}, Coach: ${coach}`);

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
      console.log(`[POST /assignments] ERROR: Student ${req.params.id} NOT FOUND`);
      return res.status(404).json({ error: "Schüler nicht gefunden" });
    }

    console.log(`[POST /assignments] SUCCESS: Added assignment to ${student.firstName} ${student.lastName}`);
    res.json(student);
  } catch (error) {
    console.error("[POST /assignments] EXCEPTION:", error);
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

    console.log(`[DELETE /assignments] Removing assignment from student ${req.params.id}`);
    console.log(`[DELETE /assignments] Assignment: ${day} ${hour}`);

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
      console.log(`[DELETE /assignments] ERROR: Student ${req.params.id} NOT FOUND`);
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

    console.log(`[DELETE /assignments] SUCCESS: Removed assignment from ${student.firstName} ${student.lastName}`);
    res.json(student);
  } catch (error) {
    console.error("[DELETE /assignments] EXCEPTION:", error);
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

    console.log(`[assignments/replace] ===== DRAG AND DROP START =====`);
    console.log(`[assignments/replace] Received student ID: ${req.params.id}`);
    console.log(`[assignments/replace] Target: ${day} ${hour}, Coach: ${coach}`);
    console.log(`[assignments/replace] From: ${fromDay} ${fromHour}`);

    // Allow null values for clearing assignments (algorithm reset)
    if (day === null && hour === null) {
      console.log(`[assignments/replace] Clear mode: removing all assignments`);

      // Clear all assignments
      const updateOperation = {
        $set: {
          assignments: [],
          day: null,
          hour: null,
          coach: null
        }
      };

      // Try string ID first
      let result = await Student.collection.findOneAndUpdate(
        { _id: req.params.id },
        updateOperation,
        { returnDocument: 'after' }
      );

      // If not found with string, try ObjectId format
      if (!result?.value && !result?._id) {
        console.log(`[assignments/replace] String ID not found, trying ObjectId format`);
        try {
          const objectId = new mongoose.Types.ObjectId(req.params.id);
          result = await Student.collection.findOneAndUpdate(
            { _id: objectId },
            updateOperation,
            { returnDocument: 'after' }
          );
        } catch (err) {
          console.log(`[assignments/replace] ObjectId conversion failed:`, err.message);
        }
      }

      const student = result?.value || result;

      if (!student) {
        console.log(`[assignments/replace] ERROR: Student ${req.params.id} NOT FOUND`);
        return res.status(404).json({ error: "Schüler nicht gefunden" });
      }

      console.log(`[assignments/replace] SUCCESS: Cleared assignments for ${student.firstName} ${student.lastName}`);
      console.log(`[assignments/replace] ===== END =====`);
      return res.json(student);
    }

    if (!day || hour === null || hour === undefined) {
      return res.status(400).json({ error: "Tag und Stunde sind erforderlich" });
    }

    // If fromDay/fromHour provided, update specific assignment (multi-assignment mode)
    // Otherwise, replace all assignments (legacy single-assignment mode)
    let result;

    if (fromDay && fromHour) {
      console.log(`[assignments/replace] Multi-assignment mode: updating specific assignment`);

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
      console.log(`[assignments/replace] Legacy mode: replacing all assignments`);

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
      console.log(`[assignments/replace] ERROR: Student ${req.params.id} NOT FOUND in database`);
      const samples = await Student.find({}, { _id: 1, firstName: 1, lastName: 1 }).limit(3);
      console.log(`[assignments/replace] First 3 IDs in database for comparison:`);
      samples.forEach(s => console.log(`  ${s._id} - ${s.firstName} ${s.lastName}`));
      return res.status(404).json({ error: "Schüler nicht gefunden", searchedId: req.params.id });
    }

    console.log(`[assignments/replace] SUCCESS: Updated ${student.firstName} ${student.lastName}`);
    console.log(`[assignments/replace] Final assignments:`, student.assignments);
    console.log(`[assignments/replace] ===== END =====`);
    res.json(student);
  } catch (error) {
    console.error("[assignments/replace] EXCEPTION:", error);
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
    console.log(`[DELETE /:id] Deleting student with ID: ${req.params.id}`);

    const result = await Student.collection.findOneAndDelete(
      { _id: req.params.id }
    );

    const student = result.value;

    console.log(`[DELETE /:id] Student found: ${!!student}`);

    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }
    res.json({ message: "Student deleted" });
  } catch (error) {
    console.error("Fehler beim Löschen des Schülers:", error);
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

    console.log(`[PUT /:id] Updating student ${req.params.id}`);
    console.log(`[PUT /:id] Assignments to save: ${assignments ? assignments.length : 0}`);
    if (assignments && assignments.length > 0) {
      console.log(`[PUT /:id] Assignments:`, JSON.stringify(assignments, null, 2));
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

    console.log(`[PUT /:id] SUCCESS: Updated student ${student.firstName} ${student.lastName}`);
    console.log(`[PUT /:id] Saved assignments count: ${student.assignments ? student.assignments.length : 0}`);

    res.json(student);
  } catch (error) {
    console.error("Fehler beim Aktualisieren des Schülers:", error);
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
    console.error("Fehler beim CSV-Import:", error);
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
    console.error("Error loading gender detection results:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
