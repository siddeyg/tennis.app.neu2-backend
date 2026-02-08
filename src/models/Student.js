import mongoose from "mongoose";

/**
 * Student (Schüler) Model
 *
 * Repräsentiert einen Tennisschüler in der Trainingsplan-Verwaltung.
 * Unterstützt sowohl Erwachsene als auch Kinder mit unterschiedlichen
 * Eigenschaften und Trainingsgruppen.
 */
const studentSchema = new mongoose.Schema({
  // ===== Stammdaten =====
  firstName: String,                    // Vorname des Schülers
  lastName: String,                     // Nachname des Schülers
  adress: String,                       // Adresse des Schülers
  email: String,                        // E-Mail-Adresse (optional, aber unique wenn gesetzt)
  phone: String,                        // Telefonnummer
  iban: String,                         // IBAN (encrypted, AES-256-CBC) for SEPA payments
  birthDate: String,                    // Geburtsdatum im Format "YYYY-MM-DD"
  comment: String,                      // Notiz / Kommentar zum Schüler (allgemein)
  comment2: String,                     // Trainingsziel für Erwachsene (z.B. "Freizeit, Fitness, Turniere")

  // ===== Mitgliedschaft & Training =====
  member: Boolean,                      // Mitglied im Verein (true) oder Gastspieler (false)
  adult: Boolean,                       // Erwachsenen-Training (true) oder Kinder-Training (false)
  frequence: String,                    // Trainingshäufigkeit pro Woche ("1", "2", "3")

  // ===== Geschlecht (für alle Schüler) =====
  sex: String,                          // Geschlecht: "männlich" oder "weiblich" (für Erwachsene UND Kinder)

  // ===== Erwachsenen-spezifisch (nur wenn adult = true) =====
  skillLevel: String,                   // Spielstärke: "Anfänger", "wenig Fortgeschritten", "Fortgeschritten", "gute:r Spieler:in", "Leistungsspieler:in"

  // ===== Kinder-spezifisch (nur wenn adult = false) =====
  trainigGroup: String,                 // Trainingsgruppe: "Kinderland", "Rot", "Grün", "Orange", "Gelb Team", "Gelb Hobby"
  team: Boolean,                        // Mannschaftsspieler (true) oder Hobby-Spieler (false)
  groupSize: String,                    // Gruppengröße (1er, 2er, 3er, 4er) - Legacy-Feld

  // ===== Zeitplanung =====
  availableTimes: [String],             // Liste verfügbarer Trainingszeiten im Format "Tag Stunde" (z.B. ["Montag 14", "Mittwoch 16"])

  // ===== DEPRECATED (Legacy fields for backward compatibility) =====
  day: String,                          // DEPRECATED: Use assignments array instead
  hour: Number,                         // DEPRECATED: Use assignments array instead
  coach: {                              // DEPRECATED: Use assignments array instead
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Coach',
    default: null,
    validate: {
      validator: function(value) {
        if (!value) return true;
        return mongoose.Types.ObjectId.isValid(value);
      },
      message: 'Coach must be a valid ObjectId or null'
    }
  },

  // ===== NEUE Mehrfach-Zuweisung (Multiple Course Assignments) =====
  assignments: [{
    day: {
      type: String,
      required: true
    },
    hour: {
      type: Number,
      required: true,
      min: 10,
      max: 21
    },
    coach: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User', // References User model (role: 'trainer')
      default: null,
      validate: {
        validator: function(value) {
          if (!value) return true;
          return mongoose.Types.ObjectId.isValid(value);
        },
        message: 'Coach must be a valid ObjectId or null'
      }
    }
  }]
});

// Performance indexes for load testing and production optimization
studentSchema.index({ email: 1 });  // Critical for login and user lookups
studentSchema.index({ 'assignments.day': 1, 'assignments.hour': 1 });  // Schedule queries

export default mongoose.model("Student", studentSchema);
