import mongoose from "mongoose";
import Schedule from "../models/Schedule.js";
import Student from "../models/Student.js";
import logger from "../utils/logger.js";

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

export const lockAllSchedule = async (req, res) => {
  try {
    const { periodId } = req.body;
    if (!periodId || !mongoose.Types.ObjectId.isValid(periodId)) {
      return res.status(400).json({ error: "periodId ist zwingend erforderlich und muss eine valide ObjectId sein." });
    }

    const result = await Student.updateMany(
      { periodId, "assignments.0": { $exists: true } },
      { $set: { "assignments.$[].isPinned": true } }
    );

    res.json({
      success: true,
      message: "Alle belegten Gruppen erfolgreich fixiert",
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount
    });
  } catch (err) {
    logger.error("Fehler beim Fixieren des Plans", { error: err.message });
    res.status(500).json({ error: "Fehler beim Fixieren des Plans" });
  }
};

export const unlockAllSchedule = async (req, res) => {
  try {
    const { periodId } = req.body;
    if (!periodId || !mongoose.Types.ObjectId.isValid(periodId)) {
      return res.status(400).json({ error: "periodId ist zwingend erforderlich und muss eine valide ObjectId sein." });
    }

    const result = await Student.updateMany(
      { periodId, "assignments.0": { $exists: true } },
      { $set: { "assignments.$[].isPinned": false } }
    );

    res.json({
      success: true,
      message: "Alle Gruppensperren erfolgreich aufgehoben",
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount
    });
  } catch (err) {
    logger.error("Fehler beim Entsperren des Plans", { error: err.message });
    res.status(500).json({ error: "Fehler beim Entsperren des Plans" });
  }
};

