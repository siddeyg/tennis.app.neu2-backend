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
  /**
   * availableTimes — OBJECT ARRAY format (Student model)
   *
   * ⚠️ FORMAT DIFFERS FROM Coach.availableTimes (which uses STRING array)!
   *
   * Structure: [{ day: String, hour: Number|String, venue: String }]
   * Examples:
   *   Kids:   { day: "Montag",  hour: 14,          venue: "BTHV" }
   *   Adults: { day: "Montag",  hour: "10:00",      venue: "BTHV" }
   *   Adults: { day: "Montag",  hour: "15:00 - 16:30 (Duisdorf)", venue: "" }
   *
   * hour type is Mixed (Number for kids, String for adults with time-range labels).
   * assignments[].hour is ALWAYS Number — these two fields are independent.
   *
   * Set during seasonal registration processing. Code that reads this field
   * must handle both Number and String hours. See StudentCell.js for reference.
   */
  availableTimes: [
    {
      day: { type: String },
      hour: { type: mongoose.Schema.Types.Mixed }, // Number for kids, String for adults
      venue: { type: String, default: '' },
    }
  ],

  // ===== Kurs-Zuweisungen (Course Assignments) =====
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
