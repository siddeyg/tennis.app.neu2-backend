import express from 'express';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';
import AuditLog from '../models/AuditLog.js';
import User from '../models/User.js';
import Coach from '../models/Coach.js';
import Student from '../models/Student.js';
import Camp from '../models/Camp.js';
import RegistrationPeriod from '../models/RegistrationPeriod.js';
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
 * Shared query builder for audit logs (resolves search by name, email, endpoint, etc.)
 */
async function buildAuditLogQuery({
  startDate,
  endDate,
  userId,
  action,
  excludeAction,
  resource,
  status,
  search
}) {
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

  // Filter by user ID
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

  // General search: matches endpoint, email, IP, resourceId AND resolves user names
  if (search && search.trim()) {
    const trimmed = search.trim();
    const searchRegex = escapeRegex(trimmed);

    // Look up matching users by firstName, lastName or email so "nicole" or "Kreienborg" matches their actions
    const nameParts = trimmed.split(/\s+/).filter(Boolean);
    let userQuery = [];
    if (nameParts.length > 1) {
      userQuery = [
        {
          $and: [
            { firstName: { $regex: escapeRegex(nameParts[0]), $options: 'i' } },
            { lastName: { $regex: escapeRegex(nameParts.slice(1).join(' ')), $options: 'i' } }
          ]
        }
      ];
    } else {
      userQuery = [
        { firstName: { $regex: searchRegex, $options: 'i' } },
        { lastName: { $regex: searchRegex, $options: 'i' } },
        { email: { $regex: searchRegex, $options: 'i' } }
      ];
    }

    let matchedUserIds = [];
    try {
      const matchingUsers = await User.find({ $or: userQuery }).select('_id').lean();
      matchedUserIds = matchingUsers.map(u => u._id);
    } catch (err) {
      logger.warn('Failed to resolve users for audit log search:', err);
    }

    const orConditions = [
      { endpoint: { $regex: searchRegex, $options: 'i' } },
      { userEmail: { $regex: searchRegex, $options: 'i' } },
      { ipAddress: { $regex: searchRegex, $options: 'i' } },
      { resourceId: { $regex: searchRegex, $options: 'i' } }
    ];

    if (matchedUserIds.length > 0) {
      orConditions.push({ userId: { $in: matchedUserIds } });
    }

    query.$or = orConditions;
  }

  return query;
}

/**
 * Helper to generate a human-readable activity summary in plain German
 */
function generateHumanSummary(log, resourceName) {
  const { action, resource, endpoint, status, metadata } = log;
  const target = resourceName ? `"${resourceName}"` : (resource ? `${resource}` : 'Datensatz');

  if (status === 'DENIED') {
    return `Zugriff auf ${target} verweigert`;
  }
  if (status === 'ERROR') {
    return `Fehler bei Aktion an ${target}`;
  }

  // Authentication
  if (action === 'LOGIN') return 'Erfolgreich im Admin-Portal angemeldet';
  if (action === 'LOGOUT') return 'Aus dem Admin-Portal abgemeldet';
  if (action === 'LOGIN_FAILED') return 'Fehlgeschlagener Anmeldeversuch';
  if (action === 'PASSWORD_RESET') return `Passwort zurückgesetzt (${target})`;
  if (action === 'EMAIL_VERIFY') return `E-Mail-Verifizierung durchgeführt (${target})`;

  // BroadcastEmail / Rundmail
  if (resource === 'BroadcastEmail') {
    if (endpoint?.includes('cancel')) return 'Rundmail-Versand abgebrochen';
    if (endpoint?.includes('draft')) return 'Rundmail-Entwurf gespeichert';
    if (endpoint?.includes('template')) return `Rundmail-Vorlage bearbeitet: ${target}`;
    const subject = metadata?.subject || resourceName || 'Rundmail';
    return `Rundmail versendet: "${subject}"`;
  }

  // ScheduleNotification
  if (resource === 'ScheduleNotification') {
    if (metadata?.scope === 'all') return 'Trainingsplan-Benachrichtigungen an alle Schüler versendet';
    return `Trainingsplan-Benachrichtigung an Schüler versendet (${target})`;
  }

  // Coach
  if (resource === 'Coach') {
    if (action === 'CREATE') return `Neuen Trainer angelegt: ${target}`;
    if (action === 'DELETE') return `Trainer gelöscht: ${target}`;
    if (endpoint?.includes('availableTimes') || log.changes?.availableTimes || log.requestBody?.availableTimes) {
      return `Verfügbarkeitszeiten von Trainerin/Trainer ${target} aktualisiert`;
    }
    return `Trainerprofil von ${target} bearbeitet`;
  }

  // Student
  if (resource === 'Student') {
    if (action === 'CREATE') return `Neuen Schüler angelegt: ${target}`;
    if (action === 'DELETE') return `Schüler gelöscht: ${target}`;
    if (endpoint?.includes('assignments') || log.changes?.assignments || log.requestBody?.assignments) {
      return `Gruppeneinteilung von Schüler ${target} geändert`;
    }
    return `Schülerdaten von ${target} bearbeitet`;
  }

  // Schedule
  if (resource === 'Schedule') {
    if (action === 'ALGORITHM_RUN' || endpoint?.includes('reset') || endpoint?.includes('generate')) {
      return `Trainingsplan automatisch generiert (${target})`;
    }
    return `Trainingsplan gespeichert (${target})`;
  }

  // RegistrationPeriod
  if (resource === 'RegistrationPeriod') {
    if (action === 'CREATE') return `Neue Trainingssaison angelegt: ${target}`;
    if (action === 'DELETE') return `Saison gelöscht: ${target}`;
    return `Saison/Anmeldezeitraum gespeichert: ${target}`;
  }

  // Camp
  if (resource === 'Camp') {
    if (action === 'CREATE') return `Neues Camp/Event angelegt: ${target}`;
    if (action === 'DELETE') return `Camp/Event gelöscht: ${target}`;
    return `Camp/Event gespeichert: ${target}`;
  }

  // User
  if (resource === 'User') {
    if (action === 'CREATE') return `Neuen Benutzer angelegt: ${target}`;
    if (action === 'DELETE') return `Benutzer gelöscht: ${target}`;
    return `Benutzerkonto bearbeitet: ${target}`;
  }

  // Export / Import
  if (action === 'EXPORT') return `Datenexport (${target}) heruntergeladen`;
  if (action === 'IMPORT') return `Datenimport (${target}) durchgeführt`;

  // General action fallbacks
  if (action === 'CREATE') return `Neuen Datensatz (${target}) erstellt`;
  if (action === 'UPDATE') return `${target} bearbeitet/gespeichert`;
  if (action === 'DELETE') return `${target} gelöscht`;

  return `${action} auf ${target}`;
}

/**
 * Dynamically enriches audit logs with human-readable entity names and activity summaries
 */
async function enrichAuditLogs(logs) {
  if (!Array.isArray(logs) || logs.length === 0) return [];

  // Group resource IDs by type for fast batch lookups
  const coachIds = new Set();
  const studentIds = new Set();
  const campIds = new Set();
  const periodIds = new Set();
  const userIds = new Set();

  for (const log of logs) {
    if (!log.resourceId || log.resourceName) continue;
    const id = String(log.resourceId);
    if (!/^[a-f\d]{24}$/i.test(id)) continue;

    if (log.resource === 'Coach') coachIds.add(id);
    else if (log.resource === 'Student') studentIds.add(id);
    else if (log.resource === 'Camp') campIds.add(id);
    else if (log.resource === 'RegistrationPeriod' || log.resource === 'Schedule') periodIds.add(id);
    else if (log.resource === 'User') userIds.add(id);
  }

  let coaches = [];
  let students = [];
  let camps = [];
  let periods = [];
  let users = [];

  try {
    [coaches, students, camps, periods, users] = await Promise.all([
      coachIds.size > 0 ? Coach.find({ _id: { $in: Array.from(coachIds) } }).select('firstName lastName').lean() : [],
      studentIds.size > 0 ? Student.find({ _id: { $in: Array.from(studentIds) } }).select('firstName lastName').lean() : [],
      campIds.size > 0 ? Camp.find({ _id: { $in: Array.from(campIds) } }).select('title name').lean() : [],
      periodIds.size > 0 ? RegistrationPeriod.find({ _id: { $in: Array.from(periodIds) } }).select('name').lean() : [],
      userIds.size > 0 ? User.find({ _id: { $in: Array.from(userIds) } }).select('firstName lastName email').lean() : []
    ]);
  } catch (err) {
    logger.warn('Failed to batch-resolve audit log entities:', err);
  }

  const coachMap = new Map(coaches.map(c => [String(c._id), `${c.firstName || ''} ${c.lastName || ''}`.trim()]));
  const studentMap = new Map(students.map(s => [String(s._id), `${s.firstName || ''} ${s.lastName || ''}`.trim()]));
  const campMap = new Map(camps.map(c => [String(c._id), c.title || c.name]));
  const periodMap = new Map(periods.map(p => [String(p._id), p.name]));
  const userMap = new Map(users.map(u => [String(u._id), `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email]));

  return logs.map(log => {
    let resolvedName = log.resourceName || null;
    const id = String(log.resourceId || '');

    if (!resolvedName && id) {
      if (log.resource === 'Coach') resolvedName = coachMap.get(id);
      else if (log.resource === 'Student') resolvedName = studentMap.get(id);
      else if (log.resource === 'Camp') resolvedName = campMap.get(id);
      else if (log.resource === 'RegistrationPeriod') resolvedName = periodMap.get(id);
      else if (log.resource === 'Schedule') resolvedName = periodMap.get(id) ? `Saison ${periodMap.get(id)}` : 'Trainingsplan';
      else if (log.resource === 'User') resolvedName = userMap.get(id);
    }

    // Metadata fallbacks
    if (!resolvedName) {
      if (log.metadata?.subject) resolvedName = log.metadata.subject;
      else if (log.metadata?.name) resolvedName = log.metadata.name;
    }

    const summary = log.description || generateHumanSummary(log, resolvedName);

    return {
      ...log,
      userEmail: log.userEmail || log.userId?.email || 'System',
      userName: log.userId ? `${log.userId.firstName || ''} ${log.userId.lastName || ''}`.trim() : (log.userName || 'System'),
      resourceName: resolvedName,
      description: summary,
      humanSummary: summary,
      endpoint: log.endpoint || 'N/A',
      resourceId: log.resourceId || 'N/A'
    };
  });
}

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

    const { page = 1, limit = 50, ...filterParams } = value;

    // Build query using shared builder
    const query = await buildAuditLogQuery(filterParams);

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

    // Enrich logs with resolved human names and activity summaries
    const enrichedLogs = await enrichAuditLogs(logs);

    res.json({
      logs: enrichedLogs,
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

    const [enrichedLog] = await enrichAuditLogs([log]);
    res.json(enrichedLog);
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

    // Build query using shared builder
    const query = await buildAuditLogQuery({
      startDate,
      endDate,
      userId,
      action,
      resource,
      status,
      search
    });

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
      'Beschreibung',
      'Ressource',
      'Ressourcen-Name',
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

      const enrichedBatch = await enrichAuditLogs(batch);

      // Write batch to response
      for (const log of enrichedBatch) {
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
          log.description || log.humanSummary || '',
          log.resource || '',
          log.resourceName || '',
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
