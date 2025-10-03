import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import { clerkMiddleware } from "@clerk/express";
import { requireAuth } from "./middleware/requireAuth.js";
import studentRoutes from "./routes/students.js";
import scheduleRoutes from "./routes/schedule.js"; // Importiere die Routen für den Zeitplan
import coachRoutes from "./routes/coaches.js"; // Importiere die Routen für Coaches
import savedScheduleRoutes from "./routes/savedSchedules.js"; // Importiere die Routen für gespeicherte Zeitpläne
import fs from "fs";

console.log(".env existiert:", fs.existsSync("./.env")); // Sollte true zurückgeben

dotenv.config();
console.log("MongoDB URI:", process.env.MONGO_URI);

const app = express();
app.use(cors());
app.use(express.json()); // Middleware für JSON-Daten

// Clerk middleware - must come before routes
app.use(clerkMiddleware());

// MongoDB-Verbindung
mongoose
  .connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30000 })
  .then(() => console.log("MongoDB verbunden"))
  .catch((err) => console.error("Fehler bei der MongoDB-Verbindung:", err));

// Public route
app.get("/", (req, res) => {
  res.send("Willkommen zur Tennis App API");
});

// Development-only: Get your current auth info
// Remove this in production!
app.get("/api/dev/auth-info", requireAuth, (req, res) => {
  res.json({
    message: "You are authenticated!",
    userId: req.auth.userId,
    sessionId: req.auth.sessionId,
    tip: "Copy your token from browser console: await window.Clerk.session.getToken()"
  });
});

// Protected routes - require authentication
app.use("/api/students", requireAuth, studentRoutes); // Routen für die Studenten
app.use("/api/schedule", requireAuth, scheduleRoutes); // Routen für den Zeitplan
app.use("/api/coaches", requireAuth, coachRoutes); // Routen für Coaches
app.use("/api/saved-schedules", requireAuth, savedScheduleRoutes); // Routen für gespeicherte Zeitpläne
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
