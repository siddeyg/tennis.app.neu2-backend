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
import settingsRoutes from "./routes/settings.js"; // Importiere die Routen für Einstellungen
import fs from "fs";

// load env based on NODE_ENV
// load env based on NODE_ENV
const activeEnvFile =
  process.env.NODE_ENV === "production"
    ? ".env.production"
    : ".env.development";

dotenv.config({ path: activeEnvFile });

console.log(`🌱 NODE_ENV=${process.env.NODE_ENV}`);
console.log(`📄 Geladene .env-Datei: ${activeEnvFile}`);
console.log(`${activeEnvFile} existiert:`, fs.existsSync(`./${activeEnvFile}`));
console.log(`🔑 Clerk Publishable Key: ${process.env.CLERK_PUBLISHABLE_KEY}`);
console.log(`🔐 Clerk Secret Key: ${process.env.CLERK_SECRET_KEY}`);
console.log(`🛢️ MongoDB URI: ${process.env.MONGO_URI}`);

const app = express();

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN || "http://localhost:3000",
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

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
if (process.env.NODE_ENV !== "production") {
  app.get("/api/dev/auth-info", requireAuth, (req, res) => {
    res.json({
      message: "You are authenticated!",
      userId: req.auth.userId,
      sessionId: req.auth.sessionId,
      tip: "Copy your token from browser console: await window.Clerk.session.getToken()",
    });
  });
}

// Protected routes - require authentication
app.use("/api/students", requireAuth, studentRoutes); // Routen für die Studenten
app.use("/api/schedule", requireAuth, scheduleRoutes); // Routen für den Zeitplan
app.use("/api/coaches", requireAuth, coachRoutes); // Routen für Coaches
app.use("/api/saved-schedules", requireAuth, savedScheduleRoutes); // Routen für gespeicherte Zeitpläne
app.use("/api/settings", requireAuth, settingsRoutes); // Routen für Einstellungen
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
