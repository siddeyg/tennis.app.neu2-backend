import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

// Get directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// load env based on NODE_ENV - MUST BE BEFORE OTHER IMPORTS THAT USE process.env
const activeEnvFile =
  process.env.NODE_ENV === "production"
    ? ".env.production"
    : ".env.development";

// Load .env from project root (one level up from src/)
const envPath = path.resolve(__dirname, "..", activeEnvFile);
dotenv.config({ path: envPath });

console.log(`🌱 NODE_ENV=${process.env.NODE_ENV}`);
console.log(`📄 Geladene .env-Datei: ${activeEnvFile}`);
console.log(`📍 .env path: ${envPath}`);
console.log(`${activeEnvFile} existiert:`, fs.existsSync(envPath));
console.log(`🔑 JWT_SECRET exists: ${!!process.env.JWT_SECRET}`);
console.log(`🛢️ MongoDB URI: ${process.env.MONGO_URI}`);

// Now import modules that depend on env variables
import passport, { configurePassport } from "./config/passport.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { requireRole } from "./middleware/requireRole.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import studentRoutes from "./routes/students.js";
import scheduleRoutes from "./routes/schedule.js";
import coachRoutes from "./routes/coaches.js";
import savedScheduleRoutes from "./routes/savedSchedules.js";
import settingsRoutes from "./routes/settings.js";

const app = express();

// Trust proxy - required when behind reverse proxy (Caddy/nginx)
// This allows rate limiters and IP detection to work correctly
app.set('trust proxy', true);

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // In production, only allow the configured origin
    if (process.env.NODE_ENV === 'production') {
      const allowedOrigin = process.env.CORS_ORIGIN || "https://mondo.suwar.de";
      if (origin === allowedOrigin) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    } else {
      // In development, allow both localhost and 127.0.0.1
      const allowedOrigins = [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:3001',
        'http://127.0.0.1:3001'
      ];
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

app.use(express.json()); // Middleware für JSON-Daten
app.use(cookieParser()); // Middleware für Cookies

// Configure and initialize Passport AFTER env is loaded
configurePassport();
app.use(passport.initialize());

// MongoDB-Verbindung
mongoose
  .connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30000 })
  .then(() => console.log("MongoDB verbunden"))
  .catch((err) => console.error("Fehler bei der MongoDB-Verbindung:", err));

// Public routes
app.get("/", (req, res) => {
  res.send("Willkommen zur Tennis App API");
});

// Auth routes (public - no authentication required)
app.use("/api/auth", authRoutes);

// Protected routes - require authentication
app.use("/api/students", requireAuth, studentRoutes);
app.use("/api/schedule", requireAuth, scheduleRoutes);
app.use("/api/coaches", requireAuth, coachRoutes);
app.use("/api/saved-schedules", requireAuth, savedScheduleRoutes);
app.use("/api/settings", requireAuth, settingsRoutes);

// User management routes - admin only
app.use("/api/users", requireAuth, requireRole(["admin"]), userRoutes);
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
