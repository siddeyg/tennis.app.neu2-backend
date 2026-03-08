// CRITICAL: Load environment variables FIRST before any other imports
// This ensures env vars are available when other modules initialize
import { envInfo } from "./loadEnv.js";

import express from "express";
import { createServer } from "http";
import mongoose from "mongoose";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import helmet from "helmet";
import mongoSanitize from "express-mongo-sanitize";
import morgan from "morgan";
import logger from "./utils/logger.js";
import errorHandler from "./middleware/errorHandler.js";

// Get directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Log startup info (sanitized - no sensitive data)
const { activeEnvFile, envPath, isProduction } = envInfo;
logger.info(`🌱 Environment: ${process.env.NODE_ENV}`);
logger.info(`📄 Config file: ${activeEnvFile}`);
logger.info(`📍 Config path: ${envPath}`);
logger.info(`${activeEnvFile} exists: ${fs.existsSync(envPath)}`);
logger.info(`🔑 JWT_SECRET configured: ${!!process.env.JWT_SECRET}`);
logger.info(`🔑 PORTAL_JWT_SECRET configured: ${!!process.env.PORTAL_JWT_SECRET}`);

// Fail fast if portal JWT secrets are absent or share a value with admin secrets.
// A shared secret would allow portal tokens to be accepted by admin-portal routes.
if (!process.env.PORTAL_JWT_SECRET) {
  logger.error('FATAL: PORTAL_JWT_SECRET is not set. Refusing to start.');
  process.exit(1);
}
if (process.env.PORTAL_JWT_SECRET === process.env.JWT_SECRET) {
  logger.error('FATAL: PORTAL_JWT_SECRET must differ from JWT_SECRET. Shared secrets allow portal tokens to authenticate admin routes. Refusing to start.');
  process.exit(1);
}
if (!process.env.PORTAL_REFRESH_TOKEN_SECRET) {
  logger.error('FATAL: PORTAL_REFRESH_TOKEN_SECRET is not set. Refusing to start.');
  process.exit(1);
}
if (process.env.PORTAL_REFRESH_TOKEN_SECRET === process.env.REFRESH_TOKEN_SECRET) {
  logger.error('FATAL: PORTAL_REFRESH_TOKEN_SECRET must differ from REFRESH_TOKEN_SECRET. Refusing to start.');
  process.exit(1);
}
logger.info(`🛢️ MongoDB connection configured: ${!!process.env.MONGO_URI}`);

// Now import modules that depend on env variables (loaded via loadEnv.js above)
import passport, { configurePassport } from "./config/passport.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { requireRole, requireAdminOrSupermod } from "./middleware/requireRole.js";
import updateActivity from "./middleware/updateActivity.js";
import authRoutes from "./routes/auth.js";
import portalAuthRoutes from "./routes/portalAuth.js";
import portalScheduleRoutes from "./routes/portalSchedule.js";
import portalSeasonalRegistrationsRoutes from "./routes/portalSeasonalRegistrations.js";
import portalChildrenRoutes from "./routes/portalChildren.js";
import userRoutes from "./routes/users.js";
import userSettingsRoutes from "./routes/userSettings.js";
import studentRoutes from "./routes/students.js";
import scheduleRoutes from "./routes/schedule.js";
import coachRoutes from "./routes/coaches.js";
import savedScheduleRoutes from "./routes/savedSchedules.js";
import settingsRoutes from "./routes/settings.js";
import announcementsRoutes, { serveAnnouncementImage } from "./routes/announcements.js";
import scheduleChangeRequestsRoutes from "./routes/scheduleChangeRequests.js";
import coachPortalRoutes from "./routes/coachPortal.js";
import attendanceRoutes from "./routes/attendance.js";
import registrationPeriodsRoutes from "./routes/registrationPeriods.js";
import seasonalRegistrationsRoutes from "./routes/seasonalRegistrations.js";
import portalUsersRoutes from "./routes/portalUsers.js";
import campsRoutes from "./routes/camps.js";
import portalCampsRoutes from "./routes/portalCamps.js";
import metricsRoutes from "./routes/metrics.js";
import supportTicketsRoutes from "./routes/supportTickets.js";
import portalSupportTicketsRoutes from "./routes/portalSupportTickets.js";
import auditLogsRoutes from "./routes/auditLogs.js";
import documentRoutes from "./routes/documents.js";
import portalDocumentsRoutes from "./routes/portalDocuments.js";
import portalNotificationsRoutes from "./routes/portalNotifications.js";
import scheduleNotificationsRouter from "./routes/scheduleNotifications.js";

// Import Socket.io notification setup
import { initializeNotificationSocket } from "./socket/notificationSocket.js";

// Import models that are referenced by other models (e.g., Counter used by SupportTicket pre-save hook)
import Counter from "./models/Counter.js";

const app = express();
const httpServer = createServer(app);

// Trust proxy - required when behind reverse proxy (Caddy/nginx)
// Set to 1 to trust the first proxy (Caddy in production, none in development)
// This allows rate limiters and IP detection to work correctly
app.set('trust proxy', 1);

// ========================================
// Security Middleware
// ========================================

// 1. Helmet - Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for React
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
    frameguard: { action: 'deny' },
    noSniff: true,
    xssFilter: true,
  })
);

// 2. Force HTTPS in production
if (isProduction) {
  app.use((req, res, next) => {
    const proto = req.header('x-forwarded-proto');
    if (proto && proto !== 'https') {
      logger.warn(`HTTP request redirected to HTTPS: ${req.method} ${req.originalUrl}`);
      return res.redirect(`https://${req.header('host')}${req.url}`);
    }
    next();
  });
}

// 3. CORS configuration - Strict whitelist validation
const corsOptions = {
  origin: function (origin, callback) {
    // Allow same-origin requests (no Origin header sent by browser for same-domain API calls)
    if (!origin) return callback(null, true);

    // In production, only allow explicitly configured origins
    if (isProduction) {
      const allowedOrigins = [
        process.env.CORS_ORIGIN || "https://mondo.suwar.de",
        process.env.CORS_ORIGIN_ADMIN2 || "https://mondo2.suwar.de", // New admin portal
        process.env.CORS_ORIGIN_STUDENT || "https://user.suwar.de", // Student portal
        process.env.CORS_ORIGIN_STUDENT_ROOT || "https://mondo-tennis.de", // Student portal (root domain)
        process.env.CORS_ORIGIN_COACH || "https://coach.suwar.de", // Coach portal
      ];

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        logger.warn(`CORS blocked request from origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    } else {
      // In development, allow localhost on all three portal ports + backend (for proxy origin rewrite)
      const allowedOrigins = [
        'http://localhost:3000', // Admin portal
        'http://127.0.0.1:3000',
        'http://localhost:3001', // Student portal
        'http://127.0.0.1:3001',
        'http://localhost:3002', // Coach portal
        'http://127.0.0.1:3002',
        'http://localhost:5000', // Backend (proxy rewrites origin to this)
        'http://127.0.0.1:5000'
      ];

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        logger.warn(`CORS blocked request from origin: ${origin} (development mode)`);
        callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

app.use(express.json({ limit: '100kb' })); // Default limit — routes that need more override with their own middleware
app.use(cookieParser()); // Middleware für Cookies

// 4. MongoDB sanitization - Prevent NoSQL injection
app.use(
  mongoSanitize({
    replaceWith: '_', // Replace prohibited characters with underscore
    onSanitize: ({ req, key }) => {
      logger.warn(`MongoDB injection attempt detected: ${key} in ${req.method} ${req.originalUrl}`);
    },
  })
);

// 5. Request logging with Morgan
app.use(
  morgan('combined', {
    stream: {
      write: (message) => logger.http(message.trim()),
    },
    skip: (req) => {
      // Skip logging health check endpoints in production
      return isProduction && (req.originalUrl === '/' || req.originalUrl === '/api/health');
    },
  })
);

// Configure and initialize Passport AFTER env is loaded
configurePassport();
app.use(passport.initialize());

// MongoDB connection with optimized pool size for production load
mongoose
  .connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 30000,
    maxPoolSize: 50,  // Support up to 50 concurrent database operations
    minPoolSize: 5    // Keep minimum 5 connections ready
  })
  .then(() => logger.info("✅ MongoDB connected successfully"))
  .catch((err) => {
    logger.error(`❌ MongoDB connection error: ${err.message}`);
    process.exit(1); // Exit if database connection fails
  });

// Public routes
app.get("/", (req, res) => {
  res.send("Willkommen zur Tennis App API");
});

// Health check endpoint (used by Uptime Kuma / external monitoring)
app.get("/api/health", (req, res) => {
  const mongoState = mongoose.connection.readyState; // 1 = connected
  const healthy = mongoState === 1;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    mongo: mongoState === 1 ? "connected" : "disconnected",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Auth routes (public - no authentication required)
app.use("/api/auth", authRoutes);
app.use("/api/portal/auth", portalAuthRoutes);

// Student portal routes (uses custom portal auth middleware in route file)
// verifyPortalAuth middleware updates lastActivity timestamp every 5 minutes
app.use("/api/portal", portalScheduleRoutes);
app.use("/api/portal/seasonal-registrations", portalSeasonalRegistrationsRoutes);
app.use("/api/portal/children", portalChildrenRoutes);
app.use("/api/portal/camps", portalCampsRoutes);

// Admin + Supermod routes (operational — chief coach has full access)
app.use("/api/students", requireAuth, updateActivity, requireAdminOrSupermod, studentRoutes);
app.use("/api/schedule", requireAuth, updateActivity, requireAdminOrSupermod, scheduleRoutes);
app.use("/api/coaches", requireAuth, updateActivity, requireAdminOrSupermod, coachRoutes);
app.use("/api/saved-schedules", requireAuth, updateActivity, requireAdminOrSupermod, savedScheduleRoutes);
app.use("/api/user-settings", requireAuth, updateActivity, userSettingsRoutes);

// Admin-only system routes (supermod BLOCKED)
app.use("/api/settings", requireAuth, updateActivity, requireRole(["admin"]), settingsRoutes);

// Coach portal routes - trainer role required (handled in route file)
app.use("/api/coach", coachPortalRoutes);

// Attendance routes - coaches and admins (authorization in route file)
app.use("/api/attendance", attendanceRoutes);

// User management routes - admin only (supermod BLOCKED)
app.use("/api/users", requireAuth, updateActivity, requireRole(["admin"]), userRoutes);

// Public image serve for inline announcement images (no auth — UUIDs are unguessable)
app.get("/api/announcements/images/:filename", serveAnnouncementImage);

// Announcements routes - admin + supermod
app.use("/api/announcements", requireAuth, updateActivity, requireAdminOrSupermod, announcementsRoutes);

// Schedule change requests routes - admin + supermod
app.use("/api/schedule-change-requests", requireAuth, updateActivity, requireAdminOrSupermod, scheduleChangeRequestsRoutes);

// Registration periods routes - admin + supermod
app.use("/api/registration-periods", requireAuth, updateActivity, requireAdminOrSupermod, registrationPeriodsRoutes);

// Seasonal registrations routes - admin + supermod
app.use("/api/seasonal-registrations", requireAuth, updateActivity, requireAdminOrSupermod, seasonalRegistrationsRoutes);

// Portal users management routes - admin + supermod
app.use("/api/portal-users", requireAuth, updateActivity, requireAdminOrSupermod, portalUsersRoutes);

// Camps routes - admin + supermod
app.use("/api/camps", requireAuth, updateActivity, requireAdminOrSupermod, campsRoutes);

// Metrics routes - admin only (supermod BLOCKED)
app.use("/api/metrics", requireAuth, updateActivity, requireRole(["admin"]), metricsRoutes);

// Support tickets routes - admin + supermod
app.use("/api/support-tickets", requireAuth, updateActivity, requireAdminOrSupermod, supportTicketsRoutes);

// Portal support tickets routes - student portal (auth handled in route file)
app.use("/api/portal/support-tickets", portalSupportTicketsRoutes);

// Audit logs routes - admin only (supermod BLOCKED)
app.use("/api/audit-logs", requireAuth, updateActivity, requireRole(["admin"]), auditLogsRoutes);

// Documents routes - admin + coach (auth handled in route file)
app.use("/api/documents", documentRoutes);

// Portal documents routes - student portal (auth handled in route file)
app.use("/api/portal/documents", portalDocumentsRoutes);

// Portal notifications routes - student portal (auth handled in route file)
app.use("/api/portal/notifications", portalNotificationsRoutes);

// Schedule notifications routes - admin/supermod only
app.use("/api/schedule-notifications", requireAuth, updateActivity, requireAdminOrSupermod, scheduleNotificationsRouter);

// ========================================
// Error Handler Middleware (MUST BE LAST)
// ========================================
app.use(errorHandler);

// ========================================
// Initialize Socket.io for Real-time Notifications
// ========================================
// Pass corsOptions to Socket.io for consistent CORS configuration
initializeNotificationSocket(httpServer, corsOptions);

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => logger.info(`🚀 Server running on port ${PORT} (${process.env.NODE_ENV} mode)`));

// Graceful shutdown handlers for Docker stop signals
const shutdown = async (signal) => {
  logger.info(`${signal} received - shutting down gracefully`);
  httpServer.close(async () => {
    await mongoose.connection.close();
    logger.info('Server and DB connections closed');
    process.exit(0);
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
