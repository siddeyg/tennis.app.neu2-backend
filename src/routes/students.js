import express from "express";
import Student from "../models/Student.js";

const router = express.Router();

// Alle Schüler abrufen
router.get("/", async (req, res) => {
  const students = await Student.find();
  res.json(students);
});

// Schüler hinzufügen
router.post("/", async (req, res) => {
  const student = new Student(req.body);
  await student.save();
  res.json(student);
});

// Schüler löschen
router.delete("/:id", async (req, res) => {
  await Student.findByIdAndDelete(req.params.id);
  res.json({ message: "Schüler gelöscht" });
});

// Schüler-Daten aktualisieren
router.put("/:id", async (req, res) => {
  const {
    day,
    hour,
    firstName,
    lastName,
    birthDate,
    adress,
    email,
    member,
    adult,
    team,
    trainigGroup,
    groupSize,
    phone,
    skillLevel,
    availableTimes,
    comment,
    coach,
    frequence,
  } = req.body;
  const student = await Student.findByIdAndUpdate(
    req.params.id,
    {
      day,
      hour,
      adress,
      email,
      phone,
      member,
      adult,
      team,
      trainigGroup,
      groupSize,
      firstName,
      lastName,
      birthDate,
      skillLevel,
      availableTimes,
      comment,
      coach,
      frequence,
    },
    { new: true }
  );
  res.json(student);
});

export default router;
