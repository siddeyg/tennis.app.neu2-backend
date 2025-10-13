import express from "express";
import User from "../models/User.js";
import bcrypt from "bcryptjs";

const router = express.Router();

/**
 * GET /api/users
 * Get all users (admin only - will be protected in server.js)
 */
router.get("/", async (req, res) => {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Fehler beim Abrufen der Benutzer" });
  }
});

/**
 * GET /api/users/:id
 * Get specific user (admin only)
 */
router.get("/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");

    if (!user) {
      return res.status(404).json({ error: "Benutzer nicht gefunden" });
    }

    res.json(user);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "Fehler beim Abrufen des Benutzers" });
  }
});

/**
 * PUT /api/users/:id
 * Update user details (admin only)
 */
router.put("/:id", async (req, res) => {
  try {
    const { firstName, lastName, email, role, isActive } = req.body;

    // Find user
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ error: "Benutzer nicht gefunden" });
    }

    // Check if email is being changed and if it's already taken
    if (email && email.toLowerCase() !== user.email) {
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        return res.status(400).json({ error: "E-Mail bereits vergeben" });
      }
      user.email = email.toLowerCase();
    }

    // Update fields
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (role) user.role = role;
    if (typeof isActive === "boolean") user.isActive = isActive;

    await user.save();

    res.json({
      message: "Benutzer erfolgreich aktualisiert",
      user: user.toJSON(),
    });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ error: "Fehler beim Aktualisieren des Benutzers" });
  }
});

/**
 * PUT /api/users/:id/password
 * Change user password
 * Admin can change any password, users can change their own
 */
router.put("/:id/password", async (req, res) => {
  try {
    const { newPassword, currentPassword } = req.body;
    const userId = req.params.id;
    const requestingUser = req.user; // Set by requireAuth middleware

    // Validation
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: "Neues Passwort muss mindestens 8 Zeichen lang sein" });
    }

    // Find user
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: "Benutzer nicht gefunden" });
    }

    // Check permissions: users can only change their own password unless they're admin
    if (requestingUser.role !== "admin" && requestingUser._id.toString() !== userId) {
      return res.status(403).json({ error: "Keine Berechtigung" });
    }

    // If user is changing their own password, verify current password
    if (requestingUser._id.toString() === userId && requestingUser.role !== "admin") {
      if (!currentPassword) {
        return res.status(400).json({ error: "Aktuelles Passwort erforderlich" });
      }

      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        return res.status(401).json({ error: "Aktuelles Passwort ist falsch" });
      }
    }

    // Update password (will be hashed by pre-save hook)
    user.password = newPassword;
    await user.save();

    res.json({ message: "Passwort erfolgreich geändert" });
  } catch (error) {
    console.error("Error changing password:", error);
    res.status(500).json({ error: "Fehler beim Ändern des Passworts" });
  }
});

/**
 * DELETE /api/users/:id
 * Deactivate user (soft delete - admin only)
 */
router.delete("/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ error: "Benutzer nicht gefunden" });
    }

    // Prevent admin from deactivating themselves
    if (req.user._id.toString() === req.params.id) {
      return res.status(400).json({ error: "Sie können sich nicht selbst deaktivieren" });
    }

    // Soft delete: set isActive to false instead of deleting
    user.isActive = false;
    await user.save();

    res.json({ message: "Benutzer erfolgreich deaktiviert" });
  } catch (error) {
    console.error("Error deactivating user:", error);
    res.status(500).json({ error: "Fehler beim Deaktivieren des Benutzers" });
  }
});

/**
 * POST /api/users/:id/activate
 * Reactivate deactivated user (admin only)
 */
router.post("/:id/activate", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ error: "Benutzer nicht gefunden" });
    }

    user.isActive = true;
    await user.save();

    res.json({
      message: "Benutzer erfolgreich aktiviert",
      user: user.toJSON(),
    });
  } catch (error) {
    console.error("Error activating user:", error);
    res.status(500).json({ error: "Fehler beim Aktivieren des Benutzers" });
  }
});

export default router;
