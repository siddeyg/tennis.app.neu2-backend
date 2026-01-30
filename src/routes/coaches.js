import express from "express";
import mongoose from "mongoose";
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

    // Note: Duplicate email check removed - coaches can share emails (same as students)
    // Multiple coaches might use the same club email address

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
  try {
    // Try both string ID and ObjectId format for compatibility
    // Local DB may use ObjectId, server DB may use string IDs
    let result = await Coach.collection.findOneAndDelete(
      { _id: req.params.id } // Try string first
    );

    // If not found with string, try ObjectId format
    if (!result?.value && !result?._id) {
      try {
        const objectId = new mongoose.Types.ObjectId(req.params.id);
        result = await Coach.collection.findOneAndDelete(
          { _id: objectId }
        );
      } catch (err) {
        // ObjectId conversion failed, continue with original result
      }
    }

    // MongoDB native driver returns { value: document } not document directly
    const coach = result?.value || result;

    if (!coach) {
      return res.status(404).json({ error: "Coach not found" });
    }
    res.json({ message: "Coach deleted" });
  } catch (error) {
    console.error("Fehler beim Löschen des Trainers:", error);
    if (error.name === 'CastError') {
      return res.status(400).json({ error: "Ungültige Trainer-ID" });
    }
    res.status(500).json({ error: "Fehler beim Löschen des Trainers" });
  }
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

    // Try both string ID and ObjectId format for compatibility
    // Local DB may use ObjectId, server DB may use string IDs
    let result = await Coach.collection.findOneAndUpdate(
      { _id: req.params.id }, // Try string first
      updateData,
      { returnDocument: 'after' }
    );

    // If not found with string, try ObjectId format
    if (!result?.value && !result?._id) {
      try {
        const objectId = new mongoose.Types.ObjectId(req.params.id);
        result = await Coach.collection.findOneAndUpdate(
          { _id: objectId },
          updateData,
          { returnDocument: 'after' }
        );
      } catch (err) {
        // ObjectId conversion failed, continue with original result
      }
    }

    // MongoDB native driver returns { value: document } not document directly
    const coach = result?.value || result;

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
