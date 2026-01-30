import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import studentRoutes from "./routes/students.js";
import scheduleRoutes from "./routes/schedule.js"; // Importiere die Routen für den Zeitplan

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json()); // Middleware für JSON-Daten

// MongoDB-Verbindung
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB verbunden"))
  .catch((err) => console.error("Fehler bei der MongoDB-Verbindung:", err));

// Routen einbinden
app.use("/api/students", studentRoutes); // Routen für die Studenten
app.use("/api/schedule", scheduleRoutes); // Routen für den Zeitplan

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
