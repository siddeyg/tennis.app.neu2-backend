/**
 * Middleware to check if user has required role(s)
 * Must be used AFTER requireAuth middleware
 * Usage: app.use('/api/admin-route', requireAuth, requireRole(['admin']), yourRouteHandler)
 *
 * @param {string[]} roles - Array of allowed roles
 */
export const requireRole = (roles) => {
  return (req, res, next) => {
    // Check if user exists (should be set by requireAuth)
    if (!req.user) {
      return res.status(401).json({ error: "Nicht authentifiziert" });
    }

    // Check if user's role is in the allowed roles array
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: "Keine Berechtigung",
        message: `Diese Aktion erfordert eine der folgenden Rollen: ${roles.join(", ")}`
      });
    }

    next();
  };
};
