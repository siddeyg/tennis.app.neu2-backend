import Schedule from "../models/Schedule.js";
import Student from "../models/Student.js";

export const getSchedule = async (req, res) => {
  try {
    const schedule = await Schedule.find().populate("students");
    res.json(schedule);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/*export const updateSchedule = async (req, res) => {
  try {
    const { day, hour, students } = req.body;

    let session = await Schedule.findOne({ day, hour });
    if (!session) {
      session = new Schedule({ day, hour, students });
    } else {
      session.students = students;
    }

    await session.save();
    res.json(session);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};*/

export const updateSchedule = async (req, res) => {
  try {
    const { schedule } = req.body; // Neuer Zeitplan (gesamter Zustand) aus der Anfrage

    // Alle bestehenden Zeitpläne löschen, um sie komplett neu zu schreiben
    await Schedule.deleteMany({});

    // Den neuen Zeitplan speichern
    await Schedule.insertMany(schedule);

    res.json({ message: "Zeitplan erfolgreich aktualisiert!" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

