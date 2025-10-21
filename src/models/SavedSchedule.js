import mongoose from "mongoose";

/**
 * SavedSchedule (Gespeicherter Trainingsplan) Model
 *
 * Speichert einen vollständigen Snapshot des Trainingsplans zu einem bestimmten Zeitpunkt.
 * Enthält alle Schüler, Trainer und Kurszuweisungen als Backup/Archiv.
 * Ermöglicht das Wiederherstellen früherer Planungszustände.
 */
const savedScheduleSchema = new mongoose.Schema({
  // ===== Identifikation =====
  name: {
    type: String,
    required: true,
    trim: true,                         // Name des gespeicherten Plans (z.B. "Plan vom 15.01.2025 14:30")
  },
  description: {
    type: String,
    default: "",                        // Optional: Beschreibung/Notiz zum Plan
  },

  // ===== Zeitstempel & Autor =====
  createdAt: {
    type: Date,
    default: Date.now,                  // Zeitpunkt der Speicherung
  },
  createdBy: {
    type: String,                       // Clerk User ID des Erstellers
    required: true,
  },
  createdByEmail: {
    type: String,                       // E-Mail des Erstellers
    required: true,
  },

  // ===== Snapshot-Daten =====
  students: {
    type: Array,                        // Vollständiger Snapshot aller Schüler zum Speicherzeitpunkt
    default: [],
  },
  coaches: {
    type: Array,                        // Vollständiger Snapshot aller Trainer zum Speicherzeitpunkt
    default: [],
  },
  schedule: {
    type: Array,                        // Vollständiger Snapshot des Kursplans zum Speicherzeitpunkt
    default: [],
  },
  studentsNotSet: {
    type: Array,                        // Liste der Schüler die nicht zugeordnet werden konnten
    default: [],
  },

  // ===== Metadaten (für schnelle Anzeige ohne Array-Durchlauf) =====
  metadata: {
    studentCount: {
      type: Number,
      default: 0,                       // Anzahl gespeicherter Schüler
    },
    coachCount: {
      type: Number,
      default: 0,                       // Anzahl gespeicherter Trainer
    },
    courseCount: {
      type: Number,
      default: 0,                       // Anzahl Kurse mit mindestens 1 Schüler
    },
    possibleCourseCount: {
      type: Number,
      default: 0,                       // Anzahl möglicher Kurse (basierend auf Trainer-Verfügbarkeit)
    },
    unassignedCount: {
      type: Number,
      default: 0,                       // Anzahl nicht zugewiesener Schüler
    },
  },
});

const SavedSchedule = mongoose.model("SavedSchedule", savedScheduleSchema);

export default SavedSchedule;
