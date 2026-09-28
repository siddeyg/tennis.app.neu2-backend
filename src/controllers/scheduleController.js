import Schedule from "../models/Schedule.js";
import Student from "../models/Student.js";

export const getSchedule = async (req, res) => {
  try {
    const { periodId } = req.query;
    const filter = periodId ? { periodId } : {};

    // Use lean() to get plain JavaScript objects (not Mongoose documents)
    const schedule = await Schedule.find(filter).lean();

    res.json(schedule);
  } catch (err) {
    console.error('[scheduleController] Error:', err);
    res.status(500).json({ message: err.message });
  }
};

export const updateSchedule = async (req, res) => {
  try {
    const { schedule, periodId } = req.body;

    if (!periodId) {
      return res.status(400).json({ message: "periodId ist zwingend erforderlich (Multi-Season Period Isolation)" });
    }

    // Nur Kurse DIESER spezifischen Periode aktualisieren (Saison-Isolation)
    await Schedule.deleteMany({ periodId });
    const scheduleWithPeriod = (schedule || []).map(s => ({ ...s, periodId }));
    if (scheduleWithPeriod.length > 0) {
      await Schedule.insertMany(scheduleWithPeriod);
    }

    res.json({ message: "Zeitplan erfolgreich aktualisiert!" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

