const mongoose = require("mongoose");

const ScheduleSchema = new mongoose.Schema({
  day: String, // Montag - Samstag
  hour: String, // z.B. "10"
  students: [{ type: mongoose.Schema.Types.ObjectId, ref: "Student" }],
}); //refereziert auf Studenten mit dem Modell-Schema "Student"

module.exports = mongoose.model("Schedule", ScheduleSchema);
