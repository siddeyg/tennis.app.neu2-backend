import mongoose from "mongoose";

const coachSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  email: String,
  phone: String,
  birthday: String,
  adress: String,
  comment: String, // Notiz
  availableTimes: [String], // Liste mit erlaubten Zeiten
  isCoachingAdult: Boolean, // Ist der Coach für Erwachsenen-Training zuständig
  isCoachingChildren: Boolean, // Ist der Coach für Kinder-Training zuständig
  CoachingAdultLevels: [],
  CoachingChildrenLevels: [],
});

export default mongoose.model("Coach", coachSchema);
