import mongoose from "mongoose";

const studentSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  adress: String,
  email: String,
  phone: String,
  member: Boolean, // Mitglied ja/nein
  adult: Boolean, //Erwachsenen-Training
  sex: String, // Geschlecht: "männlich" oder "weiblich" (nur für Erwachsene relevant)
  team: Boolean, // Mannschaftsspieler ja/nein (nur für Kinder relevant)
  groupSize: String, // Gruppengröße (1er, 2er, 3er, 4er)
  trainigGroup: String, // Trainingsgruppe Kinder: ["Kinderland", "Grün", "Orange", "Gelb Team", "Gelb Hobby"]
  birthDate: String,
  skillLevel: String, // Erwachsene: ["Anfänger","wenig Fortgeschritten","Fortgeschritten","gute:r Spieler:in"]
  availableTimes: [String], // Liste mit erlaubten Zeiten
  comment: String, // Notiz
  day: String, //aktuell zugeordnete Tag im Schedule
  hour: Number, //aktuell zugeordnete Stunde im Schedule
  coach: String,
  frequence: String, // Trainingshäufigkeit pro Woche (1x, 2x, 3x)
});

export default mongoose.model("Student", studentSchema);
