import mongoose from "mongoose";

/**
 * Schedule (Trainingsplan) Model
 *
 * Repräsentiert einen Kurstermin im Wochenplan.
 * Jedes Dokument ist ein einzelner Kurs zu einer bestimmten Zeit.
 */
const ScheduleSchema = new mongoose.Schema({
  day: {
    type: String,
    required: true,
    enum: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
  },
  hour: {
    type: String,
    required: true
    // String format for flexibility (e.g., "10", "14", "18")
  },
  students: [{                          // Array von Schülern die diesem Kurs zugeordnet sind
    type: mongoose.Schema.Types.ObjectId,
    ref: "Student"
  }],
  coach: {                              // Zugewiesener Trainer für diesen Kurs
    type: mongoose.Schema.Types.ObjectId,
    ref: "Coach"
  },
});

const Schedule = mongoose.model("Schedule", ScheduleSchema);

export default Schedule;