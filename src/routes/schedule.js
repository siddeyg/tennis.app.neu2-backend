import express from "express";
import { getSchedule, updateSchedule } from "../controllers/scheduleController.js";
import auditLogMiddleware from "../middleware/auditLog.js";

const router = express.Router();

router.get("/", getSchedule);
router.put("/", auditLogMiddleware({ action: 'BULK_OPERATION', resource: 'Schedule', metadata: { critical: true, operation: 'BULK_ALGORITHM' } }), updateSchedule);

export default router;
