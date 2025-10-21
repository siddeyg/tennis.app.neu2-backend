import Schedule from "../models/Schedule.js";
import Student from "../models/Student.js";

export const getSchedule = async (req, res) => {
  try {
    // Use lean() to get plain JavaScript objects (not Mongoose documents)
    // This ensures consistent behavior across MongoDB versions
    const schedule = await Schedule.find().lean();

    // Debug logging
    console.log('[scheduleController] GET /api/schedule');
    console.log('  - Total schedule entries:', schedule.length);

    const withStudents = schedule.filter(s => s.students && s.students.length > 0);
    console.log('  - Entries with students:', withStudents.length);

    // Check a sample entry
    if (withStudents.length > 0) {
      const first = withStudents[0];
      console.log(`  - Sample: ${first.day} ${first.hour} has ${first.students.length} students`);
      console.log('    students[0]:', first.students[0]);
    }

    // Return raw schedule data without populate
    // Frontend doesn't need full student objects for the count
    // This avoids MongoDB version issues with populate
    res.json(schedule);
  } catch (err) {
    console.error('[scheduleController] Error:', err);
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

