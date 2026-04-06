import express from 'express';
import mongoose from 'mongoose';

const router = express.Router();

// Models for collection counts
import Student from '../models/Student.js';
import User from '../models/User.js';
import Camp from '../models/Camp.js';
import Coach from '../models/Coach.js';
import StudentPortalUser from '../models/StudentPortalUser.js';
import SeasonalRegistration from '../models/SeasonalRegistration.js';
import CampRegistration from '../models/CampRegistration.js';
import logger from '../utils/logger.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';

// All metrics routes require admin authentication
router.use(requireAuth, requireRole(['admin']));

/**
 * GET /api/metrics
 * Returns comprehensive server metrics
 * Admin-only
 */
router.get('/', async (req, res) => {
  try {
    // 1. Server Health (Node.js Process)
    const serverHealth = {
      uptime: process.uptime(), // seconds
      memory: {
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024), // MB
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024), // MB (Resident Set Size)
        external: Math.round(process.memoryUsage().external / 1024 / 1024), // MB
        heapPercent: Math.round(
          (process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100
        )
      },
      cpu: {
        user: Math.round(process.cpuUsage().user / 1000000 * 10) / 10, // Convert to seconds, 1 decimal
        system: Math.round(process.cpuUsage().system / 1000000 * 10) / 10
      }
    };

    // 2. Database Status (MongoDB)
    const dbState = mongoose.connection.readyState;
    const connectionStateMap = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };

    // Get connection pool stats (available in MongoDB driver)
    let poolStats = {
      current: 0,
      max: 50,
      min: 5
    };

    try {
      // Try to access pool stats (structure varies by MongoDB driver version)
      const pool = mongoose.connection?.client?.topology?.s?.pool;
      if (pool) {
        poolStats.current = pool.totalConnectionCount || 0;
      }
    } catch (e) {
      // Gracefully handle if pool stats unavailable
      logger.warn('Pool stats unavailable', { error: e.message });
    }

    // Collection counts (run in parallel)
    const [
      studentsCount,
      usersCount,
      campsCount,
      coachesCount,
      portalUsersCount,
      seasonalRegsCount,
      campRegsCount
    ] = await Promise.all([
      Student.countDocuments(),
      User.countDocuments(),
      Camp.countDocuments(),
      Coach.countDocuments(),
      StudentPortalUser.countDocuments(),
      SeasonalRegistration.countDocuments(),
      CampRegistration.countDocuments()
    ]);

    const databaseStatus = {
      connected: dbState === 1,
      state: connectionStateMap[dbState] || 'unknown',
      pool: poolStats,
      collections: {
        students: studentsCount,
        users: usersCount,
        camps: campsCount,
        coaches: coachesCount,
        portalUsers: portalUsersCount,
        seasonalRegistrations: seasonalRegsCount,
        campRegistrations: campRegsCount
      }
    };

    // 3. User Activity
    // Note: LoginSession model not yet implemented, using placeholder
    // When implemented, query active sessions by lastActivity timestamp
    const now = new Date();
    const oneHourAgo = new Date(now - 60 * 60 * 1000);
    const fifteenMinAgo = new Date(now - 15 * 60 * 1000);

    let userActivity = {
      activeSessions: 0, // Placeholder - implement when LoginSession model ready
      activeStudents: await StudentPortalUser.countDocuments({
        lastActivity: { $gte: fifteenMinAgo }
      }),
      recentLogins: 0, // Placeholder - implement when LoginSession model ready
      note: 'Session tracking to be implemented'
    };

    // Assemble complete metrics response
    const metrics = {
      timestamp: new Date(),
      server: serverHealth,
      database: databaseStatus,
      users: userActivity
    };

    res.json(metrics);
  } catch (error) {
    logger.error("Metrics collection error", { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Failed to collect metrics',
      message: error.message
    });
  }
});

export default router;
