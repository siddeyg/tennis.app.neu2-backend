import AuditLog from '../models/AuditLog.js';
import logger from '../utils/logger.js';

/**
 * Create an audit log entry
 *
 * @param {Object} params
 * @param {String} params.action - Action type (see AuditLog schema enum)
 * @param {String} params.userId - User who performed the action
 * @param {String} params.userRole - User's role at time of action
 * @param {String} params.targetType - Type of target entity (optional)
 * @param {String} params.targetId - ID of target entity (optional)
 * @param {Object} params.details - Action-specific details (optional)
 * @param {String} params.ipAddress - Client IP address
 * @param {String} params.userAgent - Client user agent (optional)
 * @param {Boolean} params.success - Whether action succeeded (default: true)
 * @param {String} params.errorMessage - Error message if failed (optional)
 */
export const createAuditLog = async (params) => {
  try {
    const auditLog = new AuditLog({
      action: params.action,
      userId: params.userId,
      userRole: params.userRole,
      targetType: params.targetType || null,
      targetId: params.targetId || null,
      details: params.details || {},
      ipAddress: params.ipAddress,
      userAgent: params.userAgent || null,
      success: params.success !== undefined ? params.success : true,
      errorMessage: params.errorMessage || null,
    });

    await auditLog.save();
    logger.info(`Audit: ${params.action} by ${params.userId} (${params.userRole})`);
  } catch (error) {
    // Don't fail the request if audit logging fails
    logger.error(`Failed to create audit log: ${error.message}`);
  }
};

/**
 * Express middleware to automatically log specific actions
 *
 * Usage:
 * app.post('/api/students', auditLogMiddleware('STUDENT_CREATED'), studentRoutes);
 */
export const auditLogMiddleware = (action, getTargetInfo) => {
  return async (req, res, next) => {
    // Store original json method
    const originalJson = res.json.bind(res);

    // Override res.json to capture response and log after success
    res.json = function (data) {
      // Only log successful responses (2xx status codes)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Get target info from response if provided
        let targetType = null;
        let targetId = null;
        let details = {};

        if (getTargetInfo && typeof getTargetInfo === 'function') {
          const targetInfo = getTargetInfo(req, data);
          targetType = targetInfo.targetType;
          targetId = targetInfo.targetId;
          details = targetInfo.details || {};
        }

        // Create audit log asynchronously (don't wait)
        createAuditLog({
          action,
          userId: req.user?.id || req.user?._id,
          userRole: req.user?.role || 'unknown',
          targetType,
          targetId,
          details,
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('user-agent'),
          success: true,
        }).catch((err) => {
          logger.error(`Audit log middleware error: ${err.message}`);
        });
      }

      // Call original json method
      return originalJson(data);
    };

    next();
  };
};

/**
 * Helper function to log authentication events
 */
export const logAuthEvent = async (action, userId, userRole, ipAddress, success, errorMessage = null) => {
  await createAuditLog({
    action,
    userId,
    userRole,
    ipAddress,
    success,
    errorMessage,
  });
};

export default createAuditLog;
