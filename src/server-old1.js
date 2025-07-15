import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB-Verbindung
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB verbunden"))
  .catch((err) => console.error("Fehler bei der MongoDB-Verbindung:", err));

// **Schüler Schema**
const studentSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  birthDate: String,
  skillLevel: String,
  availableTimes: [String], // Liste mit erlaubten Zeiten
  day: String,
  hour: Number,
});

const Student = mongoose.model("Student", studentSchema);

// **Routen**
app.get("/api/students", async (req, res) => {
  const students = await Student.find();
  res.json(students);
});

app.post("/api/students", async (req, res) => {
  const student = new Student(req.body);
  await student.save();
  res.json(student);
});

app.put("/api/students/:id", async (req, res) => {
  const { day, hour } = req.body;
  const student = await Student.f
