import express from "express";
import multer from "multer";
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
  const student = new Student(req.body);
  await student.save();
  res.json(student);
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
  await Student.findByIdAndDelete(req.params.id);
  res.json({ message: "Schüler gelöscht" });
});

// Schüler-Daten aktualisieren
router.put("/:id", async (req, res) => {
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
    { new: true }
  );
  res.json(student);
});

// CSV Import
router.post("/import", upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Keine Datei hochgeladen" });
    }

    // Parse CSV
    let csvText = req.file.buffer.toString('utf-8');

    // Remove BOM if present
    if (csvText.charCodeAt(0) === 0xFEFF) {
      csvText = csvText.substring(1);
    }

    const lines = csvText.split('\n').filter(line => line.trim());

    if (lines.length < 2) {
      return res.status(400).json({ error: "CSV-Datei ist leer" });
    }

    // Parse header
    const headers = lines[0].match(/("(?:[^"]|"")*"|[^,]+)/g).map(h =>
      h.replace(/^"|"$/g, '').replace(/""/g, '"').trim()
    );

    console.log("CSV Import - Headers found:", headers);
    console.log("CSV Import - Total lines:", lines.length);

    // Helper function to parse CSV row
    const parseRow = (line) => {
      const matches = line.match(/("(?:[^"]|"")*"|[^,]+)/g);
      return matches ? matches.map(m => m.replace(/^"|"$/g, '').replace(/""/g, '"').trim()) : [];
    };

    // Parse all rows
    const students = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseRow(lines[i]);
      if (values.length < headers.length) continue;

      const studentData = {};
      headers.forEach((header, index) => {
        const value = values[index];

        // Map CSV headers to model fields
        switch(header) {
          case 'Vorname':
            studentData.firstName = value;
            break;
          case 'Nachname':
            studentData.lastName = value;
            break;
          case 'Geburtsdatum':
            studentData.birthDate = value;
            break;
          case 'Email':
            studentData.email = value;
            break;
          case 'Telefon':
            studentData.phone = value;
            break;
          case 'Adresse':
            studentData.adress = value;
            break;
          case 'Erwachsen':
            studentData.adult = value === 'Ja';
            break;
          case 'Mitglied':
            studentData.member = value === 'Ja';
            break;
          case 'Teamspieler':
            studentData.team = value === 'Ja';
            break;
          case 'Spielstärke':
            studentData.skillLevel = value;
            break;
          case 'Trainingsgruppe':
            studentData.trainigGroup = value;
            break;
          case 'Geschlecht':
            studentData.sex = value;
            break;
          case 'Montag':
          case 'Dienstag':
          case 'Mittwoch':
          case 'Donnerstag':
          case 'Freitag':
          case 'Samstag':
            if (!studentData.availableTimes) studentData.availableTimes = [];
            if (value) {
              const hours = value.split(',').map(h => h.trim());
              hours.forEach(hour => {
                if (hour) studentData.availableTimes.push(`${header} ${hour}`);
              });
            }
            break;
          case 'Häufigkeit':
            studentData.frequence = value;
            break;
          case 'Zugewiesener Tag':
            studentData.day = value;
            break;
          case 'Zugewiesene Stunde':
            studentData.hour = value ? parseInt(value) : null;
            break;
          case 'Trainer':
            studentData.coach = value;
            break;
          case 'Kommentar':
            studentData.comment = value;
            break;
        }
      });

      students.push(studentData);
    }

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
