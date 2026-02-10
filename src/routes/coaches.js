import express from "express";
import mongoose from "mongoose";
import Coach from "../models/Coach.js";
import logger from '../utils/logger.js';
import auditLogMiddleware from '../middleware/auditLog.js';

const router = express.Router();

// Helper function to identify changed fields
function getChangedFields(before, after) {
  const changes = {};
  for (const key in after) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = {
        old: before[key],
        new: after[key]
      };
    }
  }
  return changes;
}

// Alle Trainer abrufen
router.get("/", async (req, res) => {
  const coaches = await Coach.find();
  res.json(coaches);
});

// Trainer hinzufügen
router.post("/", auditLogMiddleware({ action: 'CREATE', resource: 'Coach' }), async (req, res) => {
  try {
    // Validate required fields
    if (!req.body.firstName || !req.body.lastName) {
      return res.status(400).json({ error: "Vorname und Nachname sind erforderlich" });
    }

    // Note: Duplicate email check removed - coaches can share emails (same as students)
    // Multiple coaches might use the same club email address

    const coach = new Coach(req.body);
    await coach.save();
    res.status(201).json(coach);
  } catch (error) {
    logger.error("Fehler beim Hinzufügen des Trainers", { error: error.message, stack: error.stack });
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: "Ungültige Eingabedaten", details: error.message });
    }
    res.status(500).json({ error: "Fehler beim Hinzufügen des Trainers" });
  }
});

// Trainer löschen
router.delete("/:id", auditLogMiddleware({ action: 'DELETE', resource: 'Coach' }), async (req, res) => {
  try {
    const result = await Coach.collection.findOneAndDelete(
      { _id: req.params.id }
    );

    const coach = result.value;

    if (!coach) {
      return res.status(404).json({ error: "Coach not found" });
    }
    res.json({ message: "Coach deleted" });
  } catch (error) {
    logger.error("Fehler beim Löschen des Trainers", { error: error.message, stack: error.stack });
    if (error.name === 'CastError') {
      return res.status(400).json({ error: "Ungültige Trainer-ID" });
    }
    res.status(500).json({ error: "Fehler beim Löschen des Trainers" });
  }
});

// Trainer-Daten aktualisieren
router.put("/:id", auditLogMiddleware({ action: 'UPDATE', resource: 'Coach' }), async (req, res) => {
  try {
    const coachId = req.params.id;

    // Capture BEFORE state
    const beforeState = await Coach.findById(coachId).lean();
    if (!beforeState) {
      return res.status(404).json({ error: "Trainer nicht gefunden" });
    }

    const {
      firstName,
      lastName,
      birthday,
      adress,
      email,
      phone,
      availableTimes,
      isCoachingAdult,
      isCoachingChildren,
      CoachingAdultLevels,
      CoachingChildrenLevels,
      comment,
    } = req.body;

    // Note: Duplicate email check removed - coaches can share emails (same as students)
    // Multiple coaches might use the same club email address

    const updateData = {
      $set: {
        firstName,
        lastName,
        birthday,
        adress,
        email,
        phone,
        availableTimes,
        isCoachingAdult,
        isCoachingChildren,
        CoachingAdultLevels,
        CoachingChildrenLevels,
        comment,
      }
    };

    const result = await Coach.collection.findOneAndUpdate(
      { _id: coachId },
      updateData,
      { returnDocument: 'after' }
    );

    const coach = result.value;

    if (!coach) {
      return res.status(404).json({ error: "Trainer nicht gefunden" });
    }

    // Attach before/after to req for audit log
    req.auditMetadata = {
      before: beforeState,
      after: coach,
      changes: getChangedFields(beforeState, coach)
    };

    res.json(coach);
  } catch (error) {
    logger.error("Fehler beim Aktualisieren des Trainers", { error: error.message, stack: error.stack });
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: "Ungültige Eingabedaten", details: error.message });
    }
    if (error.name === 'CastError') {
      return res.status(400).json({ error: "Ungültige Trainer-ID" });
    }
    res.status(500).json({ error: "Fehler beim Aktualisieren des Trainers" });
  }
});

export default router;
