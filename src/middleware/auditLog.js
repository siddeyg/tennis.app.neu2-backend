import AuditLog from '../models/AuditLog.js';
import logger from '../utils/logger.js';

/**
 * Sanitize request body - remove sensitive fields
 */
function sanitizeBody(body) {
  if (!body) return null;

  const sanitized = { ...body };

  // Remove sensitive fields
  delete sanitized.password;
  delete sanitized.confirmPassword;
  delete sanitized.token;
  delete sanitized.refreshToken;
  delete sanitized.resetToken;
  delete sanitized.verificationToken;

  // Partial IBAN masking (show last 4 digits only)
  if (sanitized.iban) {
    sanitized.iban = '****' + sanitized.iban.slice(-4);
  }

  return sanitized;
}

/**
 * Create audit log entry
 */
export async function createAuditLog({
  userId,
  userEmail,
  userRole,
  action,
  resource,
  resourceId,
  method,
  endpoint,
  requestBody,
  changes,
  ipAddress,
  userAgent,
  status = 'SUCCESS',
  errorMessage,
  metadata
}) {
  try {
    const auditLog = new AuditLog({
      userId,
      userEmail,
      userRole,
      action,
      resource,
      resourceId,
      method,
      endpoint,
      requestBody: sanitizeBody(requestBody),
      changes,
      ipAddress,
      userAgent,
      status,
      errorMessage,
      metadata
    });

    await auditLog.save();
  } catch (error) {
    // Never fail requests due to audit logging errors
    logger.error('Audit log creation failed', { error: error.message });
  }
}

/**
 * Express middleware for automatic audit logging
 */
export function auditLogMiddleware(options = {}) {
  const { action, resource } = options;

  return async (req, res, next) => {
    // Capture original response methods
    const originalJson = res.json;
    const originalSend = res.send;

    // Track if response was successful
    let responseStatus = 'SUCCESS';
    let responseData = null;

    // Override res.json to capture response
    res.json = function(data) {
      responseData = data;
      if (res.statusCode >= 400) {
        responseStatus = 'ERROR';
      }
      return originalJson.call(this, data);
    };

    // Override res.send to capture response
    res.send = function(data) {
      responseData = data;
      if (res.statusCode >= 400) {
        responseStatus = 'ERROR';
      }
      return originalSend.call(this, data);
    };

    // Wait for response to complete
    res.on('finish', async () => {
      // Determine resource ID from URL params
      const resourceId = req.params.id || req.params.studentId || req.params.coachId;

      // Create audit log entry
      await createAuditLog({
        userId: req.user?.id || req.user?._id || req.portalUser?.id || req.portalUser?._id,
        userEmail: req.user?.email || req.portalUser?.email,
        userRole: req.user?.role || (req.portalUser ? 'student' : 'system'),
        action: action || req.method,
        resource: resource || extractResourceFromPath(req.path),
        resourceId,
        method: req.method,
        endpoint: req.originalUrl,
        requestBody: req.body,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
        status: responseStatus,
        errorMessage: responseStatus === 'ERROR' ? responseData?.error || responseData?.message : null,
        metadata: options.metadata
      });
    });

    next();
  };
}

/**
 * Extract resource name from API path
 */
function extractResourceFromPath(path) {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'api') {
    return parts[1]; // e.g., /api/students -> 'students'
  }
  return 'unknown';
}

export default auditLogMiddleware;
