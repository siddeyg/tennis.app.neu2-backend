import express from "express";
import { getSchedule, updateSchedule } from "../controllers/scheduleController.js";
import auditLogMiddleware from "../middleware/auditLog.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdminOrSupermod } from "../middleware/requireRole.js";

const router = express.Router();

// All schedule routes require admin or supermod authentication
router.use(requireAuth, requireAdminOrSupermod);

router.get("/", getSchedule);
router.put("/", auditLogMiddleware({ action: 'BULK_OPERATION', resource: 'Schedule', metadata: { critical: true, operation: 'BULK_ALGORITHM' } }), updateSchedule);

export default router;
