import express from "express";
import Settings from "../models/Settings.js";
import logger from '../utils/logger.js';
import auditLogMiddleware from '../middleware/auditLog.js';

const router = express.Router();

// Helper function to identify changed fields
function getChangedFields(before, after) {
  const changes = {};
  for (const key in after) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = {
        old: before[key],
        new: after[key]
      };
    }
  }
  return changes;
}

// GET settings
router.get("/", async (req, res) => {
  try {
    let settings = await Settings.findOne({ singleton: true });

    if (!settings) {
      settings = new Settings({ singleton: true });
      await settings.save();
    }

    res.json(settings);
  } catch (error) {
    logger.error("Error fetching settings", { error: error.message, stack: error.stack });
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

// PUT settings
router.put("/", auditLogMiddleware({ action: 'UPDATE', resource: 'Settings' }), async (req, res) => {
  try {
    let settings = await Settings.findOne({ singleton: true });

    if (!settings) {
      settings = new Settings({ singleton: true });
    }

    // Capture BEFORE state
    const beforeState = settings.toObject();

    if (req.body.courseCapacity) {
      settings.courseCapacity = {
        ...settings.courseCapacity,
        ...req.body.courseCapacity
      };

      if (req.body.courseCapacity.capacityByGroup) {
        settings.courseCapacity.capacityByGroup = {
          ...settings.courseCapacity.capacityByGroup,
          ...req.body.courseCapacity.capacityByGroup
        };
      }
    }

    if (req.body.timeRanges) {
      settings.timeRanges = {
        students: {
          ...settings.timeRanges?.students,
          ...req.body.timeRanges.students
        },
        coaches: {
          ...settings.timeRanges?.coaches,
          ...req.body.timeRanges.coaches
        }
      };
    }

    if (req.body.portalRegistrationEnabled !== undefined) {
      settings.portalRegistrationEnabled = req.body.portalRegistrationEnabled;
    }

    await settings.save();

    // Attach before/after to req for audit log
    const afterState = settings.toObject();
    req.auditMetadata = {
      before: beforeState,
      after: afterState,
      changes: getChangedFields(beforeState, afterState)
    };

    res.json(settings);
  } catch (error) {
    logger.error("Error updating settings", { error: error.message, stack: error.stack });
    res.status(500).json({ error: "Failed to update settings" });
  }
});

export default router;
