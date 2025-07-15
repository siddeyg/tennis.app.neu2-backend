// controllers/scheduleController.js
const Schedule = require("../models/Schedule");
const Student = require("../models/Student");

exports.getSchedule = async (req, res) => {
  try {
    const schedule = await Schedule.find().populate("students");
    res.json(schedule);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateSchedule = async (req, res) => {
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
};
