import express from "express";
import UserSettings from "../models/UserSettings.js";
import logger from '../utils/logger.js';
import auditLogMiddleware from '../middleware/auditLog.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

// All user settings routes require authentication (any role)
router.use(requireAuth);

/**
 * GET /api/user-settings
 * Get settings for currently logged-in user
 * Protected route - requires authentication
 */
router.get("/", async (req, res) => {
  try {
    const userId = req.user._id;

    let settings = await UserSettings.findOne({ userId });

    // If settings don't exist yet, create them with defaults
    if (!settings) {
      settings = await UserSettings.create({
        userId,
        allowResetSchedule: true,
        allowNotifyStudents: true,
      });
    }

    res.json(settings);
  } catch (error) {
    logger.error("Error fetching user settings", { error: error.message, stack: error.stack });
    res.status(500).json({ error: "Fehler beim Abrufen der Benutzereinstellungen" });
  }
});

/**
 * PUT /api/user-settings
 * Update settings for currently logged-in user
 * Protected route - requires authentication
 */
router.put("/", auditLogMiddleware({ action: 'UPDATE', resource: 'UserSettings' }), async (req, res) => {
  try {
    const userId = req.user._id;
    const { allowResetSchedule, allowNotifyStudents } = req.body;

    // Find existing settings or create new ones
    let settings = await UserSettings.findOne({ userId });

    if (!settings) {
      // Create new settings
      settings = await UserSettings.create({
        userId,
        allowResetSchedule: allowResetSchedule ?? true,
        allowNotifyStudents: allowNotifyStudents ?? true,
      });
    } else {
      // Update existing settings
      if (typeof allowResetSchedule === "boolean") {
        settings.allowResetSchedule = allowResetSchedule;
      }
      if (typeof allowNotifyStudents === "boolean") {
        settings.allowNotifyStudents = allowNotifyStudents;
      }
      await settings.save();
    }

    res.json({
      message: "Einstellungen erfolgreich gespeichert",
      settings,
    });
  } catch (error) {
    logger.error("Error updating user settings", { error: error.message, stack: error.stack });
    res.status(500).json({ error: "Fehler beim Speichern der Einstellungen" });
  }
});

export default router;
