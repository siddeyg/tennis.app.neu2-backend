import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../models/User.js";
import readline from "readline";

// Load environment variables
const activeEnvFile =
  process.env.NODE_ENV === "production"
    ? ".env.production"
    : ".env.development";

dotenv.config({ path: activeEnvFile });

// Create readline interface for interactive input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

/**
 * Create a new user interactively
 */
async function createUser() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB verbunden");
    console.log("");

    // Get user details
    console.log("📝 Neuen Benutzer erstellen");
    console.log("═══════════════════════════════");
    console.log("");

    const email = await question("📧 Email: ");

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log("");
      console.log(`❌ Fehler: Benutzer mit Email '${email}' existiert bereits!`);
      rl.close();
      process.exit(1);
    }

    const firstName = await question("👤 Vorname: ");
    const lastName = await question("👤 Nachname: ");
    const password = await question("🔑 Passwort: ");

    console.log("");
    console.log("🛡️  Rolle auswählen:");
    console.log("  1) admin     - Voller Zugriff (erstellen, bearbeiten, löschen)");
    console.log("  2) trainer   - Kann eigene Daten bearbeiten");
    console.log("  3) viewer    - Nur Lesezugriff");
    console.log("");

    const roleChoice = await question("Auswahl (1-3): ");

    let role;
    switch (roleChoice) {
      case "1":
        role = "admin";
        break;
      case "2":
        role = "trainer";
        break;
      case "3":
        role = "viewer";
        break;
      default:
        console.log("❌ Ungültige Auswahl. Standard 'viewer' wird verwendet.");
        role = "viewer";
    }

    // Create user
    const user = new User({
      email,
      password,
      firstName,
      lastName,
      role,
      isActive: true,
    });

    await user.save();

    console.log("");
    console.log("🎉 Benutzer erfolgreich erstellt!");
    console.log("═══════════════════════════════════");
    console.log(`📧 Email: ${email}`);
    console.log(`👤 Name: ${firstName} ${lastName}`);
    console.log(`🛡️  Rolle: ${role}`);
    console.log("═══════════════════════════════════");
    console.log("");

    rl.close();
    process.exit(0);
  } catch (error) {
    console.error("❌ Fehler beim Erstellen des Benutzers:", error);
    rl.close();
    process.exit(1);
  }
}

// Run the script
createUser();
