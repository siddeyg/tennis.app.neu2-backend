import mongoose from "mongoose";

const studentSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  adress: String,
  email: String,
  phone: String,
  member: Boolean, // Mitglied ja/nein
  adult: Boolean, //Erwachsenen-Training
  team: String, // Mannschaft Nein, oder Farbcode
  trainigGroup: String, // Trainingsgruppe
  birthDate: String,
  skillLevel: String, // Trainingsart
  availableTimes: [String], // Liste mit erlaubten Zeiten
  comment: String, // Notiz
  day: String, //aktuell zugeordnete Tag
  hour: Number, //aktuell zugeordnete Stunde
  coach: String,
  frequence: String,
});

export default mongoose.model("Student", studentSchema);
