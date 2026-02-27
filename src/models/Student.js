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
  firstName: {
    type: String,
    required: true,
    trim: true,
    minlength: 1
  },
  lastName: {
    type: String,
    required: true,
    trim: true,
    minlength: 1
  },
  adress: {
    type: String,
    trim: true
  },
  email: {
    type: String,
    lowercase: true,
    trim: true,
    sparse: true  // Allow multiple nulls, but unique if set
  },
  phone: {
    type: String,
    trim: true
  },
  iban: {
    type: String,
    trim: true
    // Encrypted AES-256-CBC for SEPA payments
  },
  birthDate: {
    type: String,
    trim: true
    // Format: "YYYY-MM-DD"
  },
  comment: {
    type: String,
    trim: true
  },
  comment2: {
    type: String,
    trim: true
    // Trainingsziel für Erwachsene (z.B. "Freizeit, Fitness, Turniere")
  },

  // ===== Mitgliedschaft & Training =====
  member: {
    type: Boolean,
    default: false
  },
  adult: {
    type: Boolean,
    default: false
  },
  frequence: {
    type: String,
    enum: ['1', '2', '3', null],
    default: null
  },

  // ===== Geschlecht (für alle Schüler) =====
  sex: {
    type: String,
    enum: ['männlich', 'weiblich', null],
    default: null
  },

  // ===== Erwachsenen-spezifisch (nur wenn adult = true) =====
  skillLevel: {
    type: String,
    enum: [
      // Admin portal values (legacy)
      'Anfänger',
      'wenig Fortgeschritten',
      'Fortgeschritten',
      'gute:r Spieler:in',
      'Leistungsspieler:in',
      // Student portal seasonal registration values (spielstärke)
      'Anfänger mit Grundkenntnissen',
      'Fortgeschrittene',
      'Erfahrene Spieler:innen / Mannschaftsspieler:innen',
      'Leistungsspieler:innen / Turnierspieler:innen',
      null
    ],
    default: null
  },

  // ===== Kinder-spezifisch (nur wenn adult = false) =====
  trainigGroup: {
    type: String,
    enum: [
      'Kinderland',
      'Rot',
      'Grün',
      'Orange',
      'Gelb Team',
      'Gelb Hobby',
      null
    ],
    default: null
  },
  team: {
    type: Boolean,
    default: false
  },
  groupSize: {
    type: String,
    trim: true
    // Legacy field: "1er", "2er", "3er", "4er"
  },

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

  // Optional: Student's preferred training time (set during seasonal registration)
  // Used by resetScheduleOptimized.js Phase P pre-pass
  priorityTime: {
    day: { type: String },
    hour: { type: mongoose.Schema.Types.Mixed }, // Number for kids, String for adults
    venue: { type: String, default: '' },
  },

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
studentSchema.index({ 'assignments.coach': 1 });  // Coach-specific schedule lookups

export default mongoose.model("Student", studentSchema);
