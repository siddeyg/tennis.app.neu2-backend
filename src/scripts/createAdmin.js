import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../models/User.js";
import fs from "fs";
import logger from "../utils/logger.js";

// Load environment variables
const activeEnvFile =
  process.env.NODE_ENV === "production"
    ? ".env.production"
    : ".env.development";

dotenv.config({ path: activeEnvFile });

/**
 * Create initial admin user
 * Admin credentials:
 * Email: info@diemachtderworte.de
 * Password: 20F622353D2D3B3B
 */
async function createAdmin() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    logger.info("MongoDB verbunden");

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: "info@diemachtderworte.de" });

    if (existingAdmin) {
      logger.warn("Admin-Benutzer existiert bereits!", {
        email: existingAdmin.email,
        name: `${existingAdmin.firstName} ${existingAdmin.lastName}`,
        role: existingAdmin.role
      });
      process.exit(0);
    }

    // Create admin user
    const adminPassword = "20F622353D2D3B3B";

    const admin = new User({
      email: "info@diemachtderworte.de",
      password: adminPassword,
      firstName: "Markus",
      lastName: "Lawrenz",
      role: "admin",
      isActive: true,
    });

    await admin.save();

    logger.info("Admin-Benutzer erfolgreich erstellt", {
      email: "info@diemachtderworte.de",
      password: adminPassword, // Note: Acceptable for one-time setup script output
      name: "Markus Lawrenz",
      role: "admin",
      message: "WICHTIG: Bitte ändern Sie das Passwort nach dem ersten Login!",
      loginUrl: "http://localhost:3000"
    });

    process.exit(0);
  } catch (error) {
    logger.error("Fehler beim Erstellen des Admin-Benutzers", {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Run the script
createAdmin();
