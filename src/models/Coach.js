import mongoose from "mongoose";

/**
 * Coach (Trainer) Model
 *
 * Repräsentiert einen Tennistrainer in der Trainingsplan-Verwaltung.
 * Enthält persönliche Daten, Verfügbarkeit und Qualifikationen für
 * verschiedene Altersgruppen und Leistungsniveaus.
 */
const coachSchema = new mongoose.Schema({
  // ===== Authentifizierung =====
  clerkUserId: {
    type: String,
    unique: true,
    sparse: true                        // Verknüpfung mit Clerk Authentifizierung (optional)
  },

  // ===== Stammdaten =====
  firstName: String,                    // Vorname des Trainers
  lastName: String,                     // Nachname des Trainers
  email: String,                        // E-Mail-Adresse (optional, aber unique wenn gesetzt)
  phone: String,                        // Telefonnummer
  birthday: String,                     // Geburtsdatum
  adress: String,                       // Adresse des Trainers
  comment: String,                      // Notiz / Kommentar zum Trainer

  // ===== Verfügbarkeit =====
  /**
   * availableTimes — OBJECT ARRAY format (Coach model)
   *
   * Structure: [{day: String, hour: Number}, ...]
   * Examples:  [{day: "Montag", hour: 14}, {day: "Mittwoch", hour: 16}]
   *
   * Same format as Student.availableTimes (without venue field).
   * Used by getSuitableCoaches() and schedule grid rendering.
   */
  availableTimes: [{ day: String, hour: Number }],

  // ===== Qualifikationen & Training =====
  isCoachingAdult: Boolean,             // Kann Erwachsene trainieren (true/false)
  isCoachingChildren: Boolean,          // Kann Kinder trainieren (true/false)
  CoachingAdultLevels: [],              // Array der Erwachsenen-Levels die trainiert werden können (derzeit ungenutzt)
  CoachingChildrenLevels: [],           // Array der Kinder-Trainingsgruppen die trainiert werden können
                                        // Mögliche Werte: ["Kinderland", "Rot", "Orange", "Grün", "Gelb Hobby", "Gelb Team"]
});

export default mongoose.model("Coach", coachSchema);
