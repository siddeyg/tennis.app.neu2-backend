import AuditLog from '../models/AuditLog.js';
import logger from '../utils/logger.js';

/**
 * Sanitize request body - remove sensitive fields (recursive)
 */
function sanitizeBody(body) {
  if (!body) return null;

  const sensitiveFields = ['password', 'confirmPassword', 'token', 'refreshToken', 'resetToken', 'verificationToken', 'secret', 'apiKey'];
  const ibanPattern = /\biban\b/i;

  // Recursive sanitization
  const sanitize = (obj) => {
    if (Array.isArray(obj)) {
      return obj.map(item => sanitize(item));
    }

    if (obj && typeof obj === 'object') {
      const sanitized = {};

      for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();

        // Remove sensitive fields entirely
        if (sensitiveFields.includes(lowerKey)) {
          sanitized[key] = '[REDACTED]';
        }
        // Redact IBAN fields entirely (recursive check)
        else if (ibanPattern.test(key)) {
          sanitized[key] = '[REDACTED]';
        }
        // Recursively sanitize nested objects/arrays
        else if (typeof value === 'object' && value !== null) {
          sanitized[key] = sanitize(value);
        }
        else {
          sanitized[key] = value;
        }
      }

      return sanitized;
    }

    return obj;
  };

  return sanitize(body);
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

      // Merge options.metadata with req.auditMetadata if present
      const combinedMetadata = req.auditMetadata
        ? { ...options.metadata, ...req.auditMetadata }
        : options.metadata;

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
        ipAddress: getClientIp(req),
        userAgent: req.get('user-agent'),
        status: responseStatus,
        errorMessage: responseStatus === 'ERROR' ? responseData?.error || responseData?.message : null,
        metadata: combinedMetadata
      });
    });

    next();
  };
}

/**
 * Extract real client IP address from request
 * Handles proxies (Caddy) and direct connections
 */
function getClientIp(req) {
  // 1. Check X-Forwarded-For header (Caddy in production)
  const forwardedFor = req.get('x-forwarded-for');
  if (forwardedFor) {
    // X-Forwarded-For can be comma-separated list, take first (real client)
    return forwardedFor.split(',')[0].trim();
  }

  // 2. Check X-Real-IP header (alternative proxy header)
  const realIp = req.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // 3. Use Express parsed IP (with trust proxy)
  if (req.ip) {
    // Remove IPv6 prefix if present
    return req.ip.replace('::ffff:', '');
  }

  // 4. Fallback to connection remote address
  const remoteAddr = req.connection?.remoteAddress || req.socket?.remoteAddress;
  return remoteAddr ? remoteAddr.replace('::ffff:', '') : 'unknown';
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
