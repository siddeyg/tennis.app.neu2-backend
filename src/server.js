import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import studentRoutes from "./routes/students.js";
import scheduleRoutes from "./routes/schedule.js"; // Importiere die Routen für den Zeitplan
import coachRoutes from "./routes/coaches.js"; // Importiere die Routen für Coaches
import fs from "fs";

console.log(".env existiert:", fs.existsSync("./.env")); // Sollte true zurückgeben

dotenv.config();
console.log("MongoDB URI:", process.env.MONGO_URI);

const app = express();
app.use(cors());
app.use(express.json()); // Middleware für JSON-Daten

// MongoDB-Verbindung
mongoose
  .connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30000 })
  .then(() => console.log("MongoDB verbunden"))
  .catch((err) => console.error("Fehler bei der MongoDB-Verbindung:", err));

// Routen einbinden
app.use("/api/students", studentRoutes); // Routen für die Studenten
app.use("/api/schedule", scheduleRoutes); // Routen für den Zeitplan
app.use("/api/coaches", coachRoutes); // Routen für Coaches
app.get("/", (req, res) => {
  res.send("Willkommen zur Tennis App API");
});
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
