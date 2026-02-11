// CRITICAL: Load environment variables FIRST before any other imports
// This ensures env vars are available when other modules initialize
import { envInfo } from "./loadEnv.js";

import express from "express";
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
logger.info(`🛢️ MongoDB connection configured: ${!!process.env.MONGO_URI}`);

// Now import modules that depend on env variables (loaded via loadEnv.js above)
import passport, { configurePassport } from "./config/passport.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { requireRole } from "./middleware/requireRole.js";
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
import announcementsRoutes from "./routes/announcements.js";
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

// Import models that are referenced by other models (e.g., Counter used by SupportTicket pre-save hook)
import Counter from "./models/Counter.js";

const app = express();

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
    if (req.header('x-forwarded-proto') !== 'https') {
      logger.warn(`HTTP request redirected to HTTPS: ${req.method} ${req.originalUrl}`);
      return res.redirect(`https://${req.header('host')}${req.url}`);
    }
    next();
  });
}

// 3. CORS configuration - Strict whitelist validation
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // In production, only allow explicitly configured origins
    if (isProduction) {
      const allowedOrigins = [
        process.env.CORS_ORIGIN || "https://mondo.suwar.de",
        process.env.CORS_ORIGIN_ADMIN2 || "https://mondo2.suwar.de", // New admin portal
        process.env.CORS_ORIGIN_STUDENT || "https://user.suwar.de", // Student portal (NEW domain - www)
        process.env.CORS_ORIGIN_STUDENT_ROOT || "https://mondo-tennis.de", // Student portal (NEW domain - root)
        "https://user.suwar.de", // Student portal (OLD domain - 30-day transition, remove after 2026-03-08)
        "https://www.mondo-tennis.de", // Student portal (NEW domain with www - during transition)
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

app.use(express.json({ limit: '10mb' })); // Middleware für JSON-Daten (increased limit for large schedule imports)
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
      return isProduction && req.originalUrl === '/';
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

// Auth routes (public - no authentication required)
app.use("/api/auth", authRoutes);
app.use("/api/portal/auth", portalAuthRoutes);

// Student portal routes (uses custom portal auth middleware in route file)
// verifyPortalAuth middleware updates lastActivity timestamp every 5 minutes
app.use("/api/portal", portalScheduleRoutes);
app.use("/api/portal/seasonal-registrations", portalSeasonalRegistrationsRoutes);
app.use("/api/portal/children", portalChildrenRoutes);
app.use("/api/portal/camps", portalCampsRoutes);

// Protected routes - require authentication
// updateActivity middleware updates lastActivity timestamp every 5 minutes
app.use("/api/students", requireAuth, updateActivity, studentRoutes);
app.use("/api/schedule", requireAuth, updateActivity, scheduleRoutes);
app.use("/api/coaches", requireAuth, updateActivity, coachRoutes);
app.use("/api/saved-schedules", requireAuth, updateActivity, savedScheduleRoutes);
app.use("/api/settings", requireAuth, updateActivity, settingsRoutes);
app.use("/api/user-settings", requireAuth, updateActivity, userSettingsRoutes);

// Coach portal routes - trainer role required (handled in route file)
app.use("/api/coach", coachPortalRoutes);

// Attendance routes - coaches and admins (authorization in route file)
app.use("/api/attendance", attendanceRoutes);

// User management routes - admin only
app.use("/api/users", requireAuth, updateActivity, requireRole(["admin"]), userRoutes);

// Announcements routes - admin only
app.use("/api/announcements", requireAuth, updateActivity, requireRole(["admin"]), announcementsRoutes);

// Schedule change requests routes - admin only
app.use("/api/schedule-change-requests", requireAuth, updateActivity, requireRole(["admin"]), scheduleChangeRequestsRoutes);

// Registration periods routes - admin only
app.use("/api/registration-periods", requireAuth, updateActivity, requireRole(["admin"]), registrationPeriodsRoutes);

// Seasonal registrations routes - admin only
app.use("/api/seasonal-registrations", requireAuth, updateActivity, requireRole(["admin"]), seasonalRegistrationsRoutes);

// Portal users management routes - admin only
app.use("/api/portal-users", requireAuth, updateActivity, requireRole(["admin"]), portalUsersRoutes);

// Camps routes - admin only (auth handled in route file)
app.use("/api/camps", campsRoutes);

// Metrics routes - admin only
app.use("/api/metrics", requireAuth, updateActivity, requireRole(["admin"]), metricsRoutes);

// Support tickets routes - admin only
app.use("/api/support-tickets", supportTicketsRoutes);

// Portal support tickets routes - student portal (auth handled in route file)
app.use("/api/portal/support-tickets", portalSupportTicketsRoutes);

// Audit logs routes - admin only
app.use("/api/audit-logs", requireAuth, updateActivity, requireRole(["admin"]), auditLogsRoutes);

// ========================================
// Error Handler Middleware (MUST BE LAST)
// ========================================
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => logger.info(`🚀 Server running on port ${PORT} (${process.env.NODE_ENV} mode)`));
