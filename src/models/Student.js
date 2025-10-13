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
  birthDate: String,                    // Geburtsdatum im Format "YYYY-MM-DD"
  comment: String,                      // Notiz / Kommentar zum Schüler (allgemein)
  comment2: String,                     // Trainingsziel für Erwachsene (z.B. "Freizeit, Fitness, Turniere")

  // ===== Mitgliedschaft & Training =====
  member: Boolean,                      // Mitglied im Verein (true) oder Gastspieler (false)
  adult: Boolean,                       // Erwachsenen-Training (true) oder Kinder-Training (false)
  frequence: String,                    // Trainingshäufigkeit pro Woche ("1", "2", "3")

  // ===== Erwachsenen-spezifisch (nur wenn adult = true) =====
  skillLevel: String,                   // Spielstärke: "Anfänger", "wenig Fortgeschritten", "Fortgeschritten", "gute:r Spieler:in", "Leistungsspieler:in"
  sex: String,                          // Geschlecht: "männlich" oder "weiblich"

  // ===== Kinder-spezifisch (nur wenn adult = false) =====
  trainigGroup: String,                 // Trainingsgruppe: "Kinderland", "Rot", "Grün", "Orange", "Gelb Team", "Gelb Hobby"
  team: Boolean,                        // Mannschaftsspieler (true) oder Hobby-Spieler (false)
  groupSize: String,                    // Gruppengröße (1er, 2er, 3er, 4er) - Legacy-Feld

  // ===== Zeitplanung =====
  availableTimes: [String],             // Liste verfügbarer Trainingszeiten im Format "Tag Stunde" (z.B. ["Montag 14", "Mittwoch 16"])
  day: String,                          // Aktuell zugewiesener Wochentag im Schedule (z.B. "Montag")
  hour: Number,                         // Aktuell zugewiesene Stunde im Schedule (10-21)

  // ===== Trainer-Zuweisung =====
  coach: {
    type: mongoose.Schema.Types.ObjectId,  // Referenz zum zugewiesenen Trainer (Coach-Modell)
    ref: 'Coach',
    default: null,                         // null = kein Trainer zugewiesen
    validate: {
      validator: function(value) {
        if (!value) return true;            // null/undefined ist erlaubt
        return mongoose.Types.ObjectId.isValid(value);  // Ansonsten muss gültige ObjectId sein
      },
      message: 'Coach must be a valid ObjectId or null'
    }
  }
});

export default mongoose.model("Student", studentSchema);
