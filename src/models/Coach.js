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
  availableTimes: [String],             // Liste verfügbarer Zeiten im Format "Tag Stunde" (z.B. ["Montag 14", "Mittwoch 16"])

  // ===== Qualifikationen & Training =====
  isCoachingAdult: Boolean,             // Kann Erwachsene trainieren (true/false)
  isCoachingChildren: Boolean,          // Kann Kinder trainieren (true/false)
  CoachingAdultLevels: [],              // Array der Erwachsenen-Levels die trainiert werden können (derzeit ungenutzt)
  CoachingChildrenLevels: [],           // Array der Kinder-Trainingsgruppen die trainiert werden können
                                        // Mögliche Werte: ["Kinderland", "Rot", "Orange", "Grün", "Gelb Hobby", "Gelb Team"]
});

export default mongoose.model("Coach", coachSchema);
