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
  const coach = new Coach(req.body);
  await coach.save();
  res.json(coach);
});

// Trainer löschen
router.delete("/:id", async (req, res) => {
  await Coach.findByIdAndDelete(req.params.id);
  res.json({ message: "Trainer gelöscht" });
});

// Trainer-Daten aktualisieren
router.put("/:id", async (req, res) => {
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
    { new: true }
  );
  res.json(coach);
});

export default router;
