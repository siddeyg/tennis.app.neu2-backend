/**
 * Extract real client IP address from request
 */
function getClientIp(req) {
  const forwardedFor = req.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  const realIp = req.get('x-real-ip');
  if (realIp) {
    return realIp;
  }
  if (req.ip) {
    return req.ip.replace('::ffff:', '');
  }
  const remoteAddr = req.connection?.remoteAddress || req.socket?.remoteAddress;
  return remoteAddr ? remoteAddr.replace('::ffff:', '') : 'unknown';
}

/**
 * Middleware to check if user has required role(s)
 * Must be used AFTER requireAuth middleware
 * Usage: app.use('/api/admin-route', requireAuth, requireRole(['admin']), yourRouteHandler)
 *
 * @param {string[]} roles - Array of allowed roles
 */
export const requireRole = (roles) => {
  return async (req, res, next) => {
    // Check if user exists (should be set by requireAuth)
    if (!req.user) {
      return res.status(401).json({ error: "Nicht authentifiziert" });
    }

    // Check if user's role is in the allowed roles array
    if (!roles.includes(req.user.role)) {
      // Log permission denial
      try {
        const { default: AuditLog } = await import('../models/AuditLog.js');

        await AuditLog.create({
          userId: req.user.id || req.user._id,
          userEmail: req.user.email,
          userRole: req.user.role,
          action: req.method === 'GET' ? 'READ' : req.method === 'POST' ? 'CREATE' : req.method === 'PUT' || req.method === 'PATCH' ? 'UPDATE' : 'DELETE',
          resource: 'Access',
          status: 'DENIED',
          endpoint: req.originalUrl,
          method: req.method,
          ipAddress: getClientIp(req),
          userAgent: req.get('user-agent'),
          errorMessage: `Insufficient permissions. Required: ${roles.join('|')}, Has: ${req.user.role}`
        });
      } catch (logError) {
        // Never fail the request due to logging error
        console.error('Failed to log permission denial:', logError);
      }

      return res.status(403).json({
        error: "Keine Berechtigung",
        message: `Diese Aktion erfordert eine der folgenden Rollen: ${roles.join(", ")}`
      });
    }

    next();
  };
};

/**
 * Middleware to check if user is a coach (trainer)
 * Convenience wrapper for requireRole(['trainer'])
 * Must be used AFTER requireAuth middleware
 * Usage: app.use('/api/coach/*', requireAuth, requireCoach, yourRouteHandler)
 */
export const requireCoach = requireRole(['trainer']);

// Export as default for convenience (allows both import patterns)
export default requireRole;
