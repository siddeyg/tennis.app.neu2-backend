import express from "express";
import Coach from "../models/Coach.js";
import logger from '../utils/logger.js';
import auditLogMiddleware from '../middleware/auditLog.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdminOrSupermod } from '../middleware/requireRole.js';

import RegistrationPeriod from "../models/RegistrationPeriod.js";
import Student from "../models/Student.js";

const router = express.Router();

// All coach routes require admin or supermod authentication
router.use(requireAuth, requireAdminOrSupermod);

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

// Alle Trainer abrufen (unterstützt periodId Scoping)
router.get("/", async (req, res) => {
  try {
    const { periodId } = req.query;

    if (!periodId) {
      const coaches = await Coach.find();
      return res.json(coaches);
    }

    const period = await RegistrationPeriod.findById(periodId).lean();
    if (!period) {
      return res.status(404).json({ error: "Trainingsperiode nicht gefunden" });
    }

    // Falls die Periode spezifisch konfigurierte Trainer hat
    if (period.hasConfiguredCoaches && Array.isArray(period.activeCoaches)) {
      const activeCoachMap = new Map();
      period.activeCoaches.forEach(ac => {
        if (ac.coachId) {
          activeCoachMap.set(String(ac.coachId), ac);
        }
      });

      const coachIds = Array.from(activeCoachMap.keys());
      const baseCoaches = await Coach.find({ _id: { $in: coachIds } }).lean();

      const enrichedCoaches = baseCoaches.map(c => {
        const override = activeCoachMap.get(String(c._id));
        return {
          ...c,
          availableTimes: Array.isArray(override?.availableTimes)
            ? override.availableTimes
            : [],
          isCoachingAdult: override?.isCoachingAdult !== undefined ? override.isCoachingAdult : c.isCoachingAdult,
          isCoachingChildren: override?.isCoachingChildren !== undefined ? override.isCoachingChildren : c.isCoachingChildren,
          isActiveInPeriod: true,
        };
      });

      return res.json(enrichedCoaches);
    }

    // Fallback für unkonfigurierte Perioden: alle Coaches liefern
    const coaches = await Coach.find();
    res.json(coaches);
  } catch (error) {
    logger.error("Fehler beim Abrufen der Trainer", { error: error.message, stack: error.stack });
    res.status(500).json({ error: "Fehler beim Abrufen der Trainer" });
  }
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

// Trainer löschen (mit Schutz vor Zerstörung bestehender Kurszuweisungen)
router.delete("/:id", auditLogMiddleware({ action: 'DELETE', resource: 'Coach' }), async (req, res) => {
  try {
    const coachId = req.params.id;

    // Schutz: Prüfe ob dieser Trainer noch Zuweisungen in bestehenden Plänen hat
    const assignedCount = await Student.countDocuments({
      $or: [
        { 'assignments.coach': coachId },
        { coach: coachId }
      ]
    });

    if (assignedCount > 0) {
      return res.status(409).json({
        error: `Trainer kann nicht gelöscht werden: Es existieren noch ${assignedCount} Schüler-Zuweisung(en) in Trainingsplänen. Bitte entfernen Sie den Trainer zuerst aus den jeweiligen Plänen oder deaktivieren Sie ihn für die entsprechende Saison.`
      });
    }

    const coach = await Coach.findByIdAndDelete(coachId);
    if (!coach) {
      return res.status(404).json({ error: "Coach not found" });
    }

    // Bereinige auch Verweise in aktiven Perioden
    await RegistrationPeriod.updateMany(
      { 'activeCoaches.coachId': coachId },
      { $pull: { activeCoaches: { coachId: coachId } } }
    );

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
    };

    const coach = await Coach.findByIdAndUpdate(
      coachId,
      updateData,
      { new: true, lean: true }
    );
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
