import express from "express";
import Settings from "../models/Settings.js";
import logger from '../utils/logger.js';
import auditLogMiddleware from '../middleware/auditLog.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';

const router = express.Router();

// All settings routes require admin authentication
router.use(requireAuth, requireRole(['admin']));

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
      // Use toObject() to ensure Mongoose subdoc defaults are serialized to plain JS
      const existingCapacity = settings.courseCapacity?.toObject
        ? settings.courseCapacity.toObject()
        : (settings.courseCapacity || {});
      settings.courseCapacity = {
        ...existingCapacity,
        ...req.body.courseCapacity
      };

      if (req.body.courseCapacity.capacityByGroup) {
        const existingByGroup = existingCapacity.capacityByGroup || {};
        settings.courseCapacity.capacityByGroup = {
          ...existingByGroup,
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

    if (req.body.notificationEmails) {
      // Only set emails that are non-empty (Mongoose validation requires valid email format)
      const email1 = req.body.notificationEmails.email1?.trim();
      const email2 = req.body.notificationEmails.email2?.trim();
      const email3 = req.body.notificationEmails.email3?.trim();

      settings.notificationEmails = {
        email1: email1 || undefined,
        email2: email2 || undefined,
        email3: email3 || undefined
      };
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
