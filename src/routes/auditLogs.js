import express from 'express';
import AuditLog from '../models/AuditLog.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Apply admin-only protection to all routes
router.use(requireAuth);
router.use(requireRole(['admin']));

/**
 * GET /api/audit-logs - List audit logs with filters and pagination
 * Query params: startDate, endDate, userId, action, resource, status, search, page, limit
 */
router.get('/', async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      userId,
      action,
      resource,
      status,
      search,
      page = 1,
      limit = 50
    } = req.query;

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

    // Filter by action
    if (action) {
      query.action = action;
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
        { 'details.endpoint': { $regex: search, $options: 'i' } },
        { ipAddress: { $regex: search, $options: 'i' } },
        { targetId: { $regex: search, $options: 'i' } }
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
      status: log.success ? 'SUCCESS' : 'ERROR',
      endpoint: log.details?.endpoint || 'N/A',
      resourceId: log.targetId || 'N/A'
    };

    res.json(formattedLog);
  } catch (error) {
    logger.error('Failed to fetch audit log:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/audit-logs/export - Export filtered logs to CSV
 */
router.post('/export', async (req, res) => {
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
      query.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.createdAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    if (userId) query.userId = userId;
    if (action) query.action = action;
    if (resource) query.targetType = resource;

    if (status) {
      if (status === 'SUCCESS') {
        query.success = true;
      } else if (status === 'ERROR') {
        query.success = false;
      } else if (status === 'DENIED') {
        query.action = 'ACCESS_DENIED';
      }
    }

    if (search) {
      query.$or = [
        { 'details.endpoint': { $regex: search, $options: 'i' } },
        { ipAddress: { $regex: search, $options: 'i' } },
        { targetId: { $regex: search, $options: 'i' } }
      ];
    }

    // Fetch all matching logs (limit to 10,000 for safety)
    const logs = await AuditLog.find(query)
      .populate('userId', 'email firstName lastName role')
      .sort({ createdAt: -1 })
      .limit(10000)
      .lean();

    // Generate CSV
    const csvHeaders = [
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
    ];

    const csvRows = logs.map(log => {
      const userEmail = log.userId?.email || 'System';
      const userRole = log.userRole || (log.userId?.role || 'system');
      const status = log.success ? 'SUCCESS' : 'ERROR';
      const endpoint = log.details?.endpoint || '';
      const errorMsg = log.errorMessage || '';

      return [
        new Date(log.createdAt).toLocaleString('de-DE'),
        userEmail,
        userRole,
        log.action,
        log.targetType || '',
        log.targetId || '',
        status,
        log.ipAddress,
        endpoint,
        errorMsg
      ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(',');
    });

    const csv = [csvHeaders.join(','), ...csvRows].join('\n');

    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send('\ufeff' + csv); // UTF-8 BOM for Excel compatibility
  } catch (error) {
    logger.error('Failed to export audit logs:', error);
    res.status(500).json({ error: error.message });
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
      query.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.createdAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
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
      AuditLog.countDocuments({ ...query, success: true }),
      AuditLog.countDocuments({ ...query, success: false }),
      AuditLog.aggregate([
        { $match: query },
        { $group: { _id: '$action', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),
      AuditLog.aggregate([
        { $match: query },
        { $group: { _id: '$targetType', count: { $sum: 1 } } },
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
router.delete('/all', async (req, res) => {
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
router.delete('/old', async (req, res) => {
  try {
    const { days = 30 } = req.query; // Default: delete logs older than 30 days

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
