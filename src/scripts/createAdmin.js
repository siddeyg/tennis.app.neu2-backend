import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../models/User.js";
import fs from "fs";

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
    console.log("✅ MongoDB verbunden");

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: "info@diemachtderworte.de" });

    if (existingAdmin) {
      console.log("⚠️  Admin-Benutzer existiert bereits!");
      console.log(`Email: ${existingAdmin.email}`);
      console.log(`Name: ${existingAdmin.firstName} ${existingAdmin.lastName}`);
      console.log(`Rolle: ${existingAdmin.role}`);
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

    console.log("\n🎉 Admin-Benutzer erfolgreich erstellt!");
    console.log("=====================================");
    console.log(`📧 Email: info@diemachtderworte.de`);
    console.log(`🔑 Passwort: ${adminPassword}`);
    console.log(`👤 Name: Markus Lawrenz`);
    console.log(`🛡️  Rolle: admin`);
    console.log("=====================================");
    console.log("\n⚠️  WICHTIG: Bitte ändern Sie das Passwort nach dem ersten Login!");
    console.log("📝 Sie können sich jetzt unter http://localhost:3000 anmelden\n");

    process.exit(0);
  } catch (error) {
    console.error("❌ Fehler beim Erstellen des Admin-Benutzers:", error);
    process.exit(1);
  }
}

// Run the script
createAdmin();
