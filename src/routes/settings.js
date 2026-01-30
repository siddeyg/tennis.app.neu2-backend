import express from "express";
import Settings from "../models/Settings.js";

const router = express.Router();

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
    console.error("Error fetching settings:", error);
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

// PUT settings
router.put("/", async (req, res) => {
  try {
    let settings = await Settings.findOne({ singleton: true });

    if (!settings) {
      settings = new Settings({ singleton: true });
    }

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

    await settings.save();
    res.json(settings);
  } catch (error) {
    console.error("Error updating settings:", error);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

export default router;
