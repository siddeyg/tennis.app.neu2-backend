import express from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
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

    const student = new Student(req.body);
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

// Schüler löschen
router.delete("/:id", async (req, res) => {
  const student = await Student.findByIdAndDelete(req.params.id);
  if (!student) {
    return res.status(404).json({ error: "Student not found" });
  }
  res.json({ message: "Student deleted" });
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
    } = req.body;

    // Note: Duplicate email check removed - families can share emails
    // Duplicate detection is handled on frontend

    const student = await Student.findByIdAndUpdate(
      req.params.id,
      {
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
        coach,
        frequence,
      },
      { new: true, runValidators: true }
    );
    if (!student) {
      return res.status(404).json({ error: "Schüler nicht gefunden" });
    }
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

// Add assignment to student (for multiple course assignments)
router.post("/:id/assignments", async (req, res) => {
  try {
    const { day, hour, coach } = req.body;

    if (!day || !hour) {
      return res.status(400).json({ error: "Tag und Stunde sind erforderlich" });
    }

    const student = await Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ error: "Schüler nicht gefunden" });
    }

    // Initialize assignments array if it doesn't exist
    if (!student.assignments) {
      student.assignments = [];
    }

    // Check if assignment already exists
    const exists = student.assignments.some(
      a => a.day === day && a.hour === hour
    );

    if (exists) {
      return res.status(400).json({ error: "Schüler ist bereits zu dieser Zeit zugewiesen" });
    }

    // Add new assignment
    student.assignments.push({ day, hour, coach: coach || null });

    // Also update legacy fields (for backward compatibility)
    // Keep the first assignment in the legacy fields
    if (student.assignments.length === 1) {
      student.day = day;
      student.hour = hour;
      student.coach = coach || null;
    }

    await student.save();
    res.json(student);
  } catch (error) {
    console.error("Fehler beim Hinzufügen der Zuweisung:", error);
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

    const student = await Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ error: "Schüler nicht gefunden" });
    }

    if (!student.assignments || student.assignments.length === 0) {
      return res.status(400).json({ error: "Schüler hat keine Zuweisungen" });
    }

    // Remove the assignment
    student.assignments = student.assignments.filter(
      a => !(a.day === day && a.hour === hour)
    );

    // Update legacy fields
    if (student.assignments.length > 0) {
      // Keep first assignment in legacy fields
      student.day = student.assignments[0].day;
      student.hour = student.assignments[0].hour;
      student.coach = student.assignments[0].coach;
    } else {
      // No assignments left, clear legacy fields
      student.day = null;
      student.hour = null;
      student.coach = null;
    }

    await student.save();
    res.json(student);
  } catch (error) {
    console.error("Fehler beim Entfernen der Zuweisung:", error);
    res.status(500).json({ error: "Fehler beim Entfernen der Zuweisung" });
  }
});

// Replace all assignments (move student - remove old, add new)
router.put("/:id/assignments/replace", async (req, res) => {
  try {
    const { day, hour, coach } = req.body;

    if (!day || !hour) {
      return res.status(400).json({ error: "Tag und Stunde sind erforderlich" });
    }

    const student = await Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ error: "Schüler nicht gefunden" });
    }

    // Replace all assignments with single new assignment
    student.assignments = [{ day, hour, coach: coach || null }];

    // Update legacy fields
    student.day = day;
    student.hour = hour;
    student.coach = coach || null;

    await student.save();
    res.json(student);
  } catch (error) {
    console.error("Fehler beim Ersetzen der Zuweisungen:", error);
    res.status(500).json({ error: "Fehler beim Ersetzen der Zuweisungen" });
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

export default router;
