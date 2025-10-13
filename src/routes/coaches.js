import express from "express";
import Coach from "../models/Coach.js";

const router = express.Router();

// Alle Trainer abrufen
router.get("/", async (req, res) => {
  const coaches = await Coach.find();
  res.json(coaches);
});

// Trainer hinzufügen
router.post("/", async (req, res) => {
  try {
    // Validate required fields
    if (!req.body.firstName || !req.body.lastName) {
      return res.status(400).json({ error: "Vorname und Nachname sind erforderlich" });
    }

    // Check for duplicate email if provided
    if (req.body.email) {
      const existingCoach = await Coach.findOne({ email: req.body.email });
      if (existingCoach) {
        return res.status(409).json({ error: "E-Mail-Adresse bereits vorhanden" });
      }
    }

    const coach = new Coach(req.body);
    await coach.save();
    res.status(201).json(coach);
  } catch (error) {
    console.error("Fehler beim Hinzufügen des Trainers:", error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: "Ungültige Eingabedaten", details: error.message });
    }
    res.status(500).json({ error: "Fehler beim Hinzufügen des Trainers" });
  }
});

// Trainer löschen
router.delete("/:id", async (req, res) => {
  const coach = await Coach.findByIdAndDelete(req.params.id);
  if (!coach) {
    return res.status(404).json({ error: "Coach not found" });
  }
  res.json({ message: "Coach deleted" });
});

// Trainer-Daten aktualisieren
router.put("/:id", async (req, res) => {
  try {
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

    // Check for duplicate email if changed
    if (email) {
      const existingCoach = await Coach.findOne({ email, _id: { $ne: req.params.id } });
      if (existingCoach) {
        return res.status(409).json({ error: "E-Mail-Adresse bereits vorhanden" });
      }
    }

    const coach = await Coach.findByIdAndUpdate(
      req.params.id,
      {
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
      },
      { new: true, runValidators: true }
    );
    if (!coach) {
      return res.status(404).json({ error: "Trainer nicht gefunden" });
    }
    res.json(coach);
  } catch (error) {
    console.error("Fehler beim Aktualisieren des Trainers:", error);
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
