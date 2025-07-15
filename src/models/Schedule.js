import mongoose from "mongoose";

const ScheduleSchema = new mongoose.Schema({
  day: String, // Montag - Samstag
  hour: String, // z.B. "10"
  students: [{ type: mongoose.Schema.Types.ObjectId, ref: "Student" }],
}); // Referenziert auf Studenten mit dem Modell-Schema "Student"

const Schedule = mongoose.model("Schedule", ScheduleSchema);

export default Schedule;