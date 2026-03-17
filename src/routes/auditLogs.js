import express from 'express';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';
import AuditLog from '../models/AuditLog.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Escape regex metacharacters to prevent ReDoS on user-supplied search strings
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Validation schemas
const listQuerySchema = Joi.object({
  startDate: Joi.date().iso().optional(),
  endDate: Joi.date().iso().min(Joi.ref('startDate')).optional(),
  action: Joi.string().valid('CREATE', 'READ', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'ACCESS', 'EXPORT', 'IMPORT', 'BULK_OPERATION', 'BULK_DELETE', 'ALGORITHM_RUN', 'PASSWORD_RESET', 'EMAIL_VERIFY', 'DENIED').optional(),
  excludeAction: Joi.string().valid('ACCESS', 'READ').optional(),
  resource: Joi.string().max(50).optional(),
  status: Joi.string().valid('SUCCESS', 'ERROR', 'DENIED').optional(),
  userId: Joi.string().pattern(/^[a-f\d]{24}$/i).optional(),
  ip: Joi.string().ip({ version: ['ipv4', 'ipv6'] }).optional(),
  search: Joi.string().max(100).optional(),
  limit: Joi.number().integer().min(1).max(100).default(50),
  page: Joi.number().integer().min(1).default(1)
});

const deleteOldLogsSchema = Joi.object({
  days: Joi.number().integer().min(1).max(365).required()
});

// Rate limiter for list endpoint
const listLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,  // 1 minute
  max: 60,  // 60 requests per minute
  message: { error: 'Zu viele Anfragen. Bitte warten Sie eine Minute.' },
  keyGenerator: (req) => req.user.id,
  skip: (req) => process.env.NODE_ENV === 'test'
});

// Rate limiter for export endpoint
const exportLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,  // 5 minutes
  max: 5,  // 5 exports per 5 minutes
  message: { error: 'Zu viele Export-Anfragen. Bitte warten Sie.' },
  keyGenerator: (req) => req.user.id,
  skip: (req) => process.env.NODE_ENV === 'test'
});

// Rate limiter for delete operations
const deleteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 3,  // 3 deletes per 15 minutes
  message: { error: 'Zu viele Lösch-Anfragen. Bitte warten Sie.' },
  keyGenerator: (req) => req.user.id,
  skip: (req) => process.env.NODE_ENV === 'test'
});

// Apply admin-only protection to all routes
router.use(requireAuth);
router.use(requireRole(['admin']));

/**
 * GET /api/audit-logs - List audit logs with filters and pagination
 * Query params: startDate, endDate, userId, action, resource, status, search, page, limit
 */
router.get('/', listLimiter, async (req, res) => {
  try {
    // Validate query parameters
    const { error, value } = listQuerySchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        error: 'Ungültige Eingabe',
        details: error.details.map(d => d.message)
      });
    }

    const {
      startDate,
      endDate,
      userId,
      action,
      excludeAction,
      resource,
      status,
      search,
      page = 1,
      limit = 50
    } = value;

    // Build query
    const query = {};

    // Date range filter
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0); // Start of day
        query.timestamp.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999); // End of day
        query.timestamp.$lte = end;
      }
    }

    // Filter by user
    if (userId) {
      query.userId = userId;
    }

    // Filter by action (include or exclude)
    if (action) {
      query.action = action;
    } else if (excludeAction) {
      query.action = { $ne: excludeAction };
    }

    // Filter by resource
    if (resource) {
      query.resource = resource;
    }

    // Filter by status
    if (status) {
      query.status = status; // Direct string match: 'SUCCESS', 'ERROR', 'DENIED'
    }

    // General search (endpoint, email, resource ID, IP)
    if (search) {
      query.$or = [
        { endpoint: { $regex: escapeRegex(search), $options: 'i' } },
        { userEmail: { $regex: escapeRegex(search), $options: 'i' } },
        { ipAddress: { $regex: escapeRegex(search), $options: 'i' } },
        { resourceId: { $regex: escapeRegex(search), $options: 'i' } }
      ];
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Execute query with pagination
    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .populate('userId', 'email firstName lastName role')
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      AuditLog.countDocuments(query)
    ]);

    // Format logs for frontend
    const formattedLogs = logs.map(log => ({
      ...log,
      userEmail: log.userEmail || log.userId?.email || 'System',
      userName: log.userId ? `${log.userId.firstName} ${log.userId.lastName}` : 'System',
      // status already exists in log, no need to transform
      endpoint: log.endpoint || 'N/A',
      resourceId: log.resourceId || 'N/A'
    }));

    res.json({
      logs: formattedLogs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    logger.error('Failed to fetch audit logs:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/audit-logs/:id - Get single audit log details
 */
router.get('/:id', async (req, res) => {
  try {
    const log = await AuditLog.findById(req.params.id)
      .populate('userId', 'email firstName lastName role')
      .lean();

    if (!log) {
      return res.status(404).json({ error: 'Audit log not found' });
    }

    // Format for frontend
    const formattedLog = {
      ...log,
      userEmail: log.userId?.email || 'System',
      userName: log.userId ? `${log.userId.firstName} ${log.userId.lastName}` : 'System',
      // status already exists in log, no need to transform
      endpoint: log.endpoint || 'N/A',
      resourceId: log.resourceId || 'N/A'
    };

    res.json(formattedLog);
  } catch (error) {
    logger.error('Failed to fetch audit log:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/audit-logs/export - Export filtered logs to CSV (streaming for large datasets)
 */
router.post('/export', exportLimiter, async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      userId,
      action,
      resource,
      status,
      search
    } = req.body;

    // Build same query as GET endpoint
    const query = {};

    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.timestamp.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.timestamp.$lte = end;
      }
    }

    if (userId) query.userId = userId;
    if (action) query.action = action;
    if (resource) query.resource = resource;

    if (status) {
      query.status = status; // Direct string match: 'SUCCESS', 'ERROR', 'DENIED'
    }

    if (search) {
      query.$or = [
        { endpoint: { $regex: escapeRegex(search), $options: 'i' } },
        { userEmail: { $regex: escapeRegex(search), $options: 'i' } },
        { ipAddress: { $regex: escapeRegex(search), $options: 'i' } },
        { resourceId: { $regex: escapeRegex(search), $options: 'i' } }
      ];
    }

    // Set response headers for streaming
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.csv"`);

    // Add UTF-8 BOM for Excel
    res.write('\ufeff');

    // Write CSV header
    const headers = [
      'Zeitstempel',
      'Benutzer',
      'Rolle',
      'Aktion',
      'Ressource',
      'Ressourcen-ID',
      'Status',
      'IP-Adresse',
      'Endpunkt',
      'Fehlermeldung'
    ].join(',') + '\n';
    res.write(headers);

    // Stream logs in batches to avoid memory issues
    const BATCH_SIZE = 1000;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const batch = await AuditLog.find(query)
        .populate('userId', 'email firstName lastName role')
        .sort({ timestamp: -1 })
        .skip(offset)
        .limit(BATCH_SIZE)
        .lean();

      if (batch.length === 0) {
        hasMore = false;
        break;
      }

      // Write batch to response
      for (const log of batch) {
        const userEmail = log.userId?.email || 'System';
        const userRole = log.userRole || (log.userId?.role || 'system');
        const status = log.status || 'UNKNOWN';
        const endpoint = log.endpoint || '';
        const errorMsg = (log.errorMessage || '').replace(/,/g, ';');

        const row = [
          new Date(log.timestamp).toLocaleString('de-DE'),
          userEmail,
          userRole,
          log.action,
          log.resource || '',
          log.resourceId || '',
          status,
          log.ipAddress,
          endpoint,
          errorMsg
        ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(',') + '\n';

        res.write(row);
      }

      offset += BATCH_SIZE;

      if (batch.length < BATCH_SIZE) {
        hasMore = false;
      }
    }

    res.end();

  } catch (error) {
    logger.error('Failed to export audit logs:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

/**
 * GET /api/audit-logs/stats/summary - Get summary statistics
 */
router.get('/stats/summary', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Build date range query
    const query = {};
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.timestamp.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.timestamp.$lte = end;
      }
    }

    // Get statistics
    const [
      totalLogs,
      successfulLogs,
      failedLogs,
      actionStats,
      resourceStats
    ] = await Promise.all([
      AuditLog.countDocuments(query),
      AuditLog.countDocuments({ ...query, status: 'SUCCESS' }),
      AuditLog.countDocuments({ ...query, status: 'ERROR' }),
      AuditLog.aggregate([
        { $match: query },
        { $group: { _id: '$action', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),
      AuditLog.aggregate([
        { $match: query },
        { $group: { _id: '$resource', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ])
    ]);

    res.json({
      total: totalLogs,
      successful: successfulLogs,
      failed: failedLogs,
      topActions: actionStats,
      topResources: resourceStats
    });
  } catch (error) {
    logger.error('Failed to fetch audit log statistics:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/audit-logs/all - Delete all audit logs
 * Admin only - requires confirmation
 */
router.delete('/all', deleteLimiter, async (req, res) => {
  try {
    const result = await AuditLog.deleteMany({});

    logger.info('Audit logs cleared', {
      deletedCount: result.deletedCount,
      clearedBy: req.user.email
    });

    res.json({
      message: 'All audit logs deleted successfully',
      deletedCount: result.deletedCount
    });
  } catch (error) {
    logger.error('Failed to delete audit logs:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/audit-logs/old - Delete old audit logs (older than specified days)
 */
router.delete('/old', deleteLimiter, async (req, res) => {
  try {
    // Validate query parameter
    const { error, value } = deleteOldLogsSchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        error: 'Ungültige Eingabe',
        details: error.details[0].message
      });
    }

    const { days } = value;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));

    const result = await AuditLog.deleteMany({
      timestamp: { $lt: cutoffDate }
    });

    logger.info('Old audit logs deleted', {
      deletedCount: result.deletedCount,
      olderThan: days + ' days',
      cutoffDate: cutoffDate,
      deletedBy: req.user.email
    });

    res.json({
      message: `Deleted audit logs older than ${days} days`,
      deletedCount: result.deletedCount,
      cutoffDate: cutoffDate
    });
  } catch (error) {
    logger.error('Failed to delete old audit logs:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
