import express from "express";
import { getSchedule, updateSchedule } from "../controllers/scheduleController.js";

const router = express.Router();

router.get("/", getSchedule);
router.put("/", updateSchedule);

export default router;
