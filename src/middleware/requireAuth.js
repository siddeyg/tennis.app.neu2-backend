import passport from "passport";

/**
 * Middleware to protect routes - requires user to be authenticated
 * Uses Passport JWT strategy to verify token from cookies
 * In test mode, allows mock authentication by checking if req.user is already set
 * Usage: app.use('/api/protected-route', requireAuth, yourRouteHandler)
 */
export const requireAuth = (req, res, next) => {
  // Allow test mocks to bypass JWT verification (test environment only)
  if (process.env.NODE_ENV === 'test' && req.user && (req.user.role === 'student' || req.user.role === 'admin' || req.user.role === 'trainer')) {
    return next();
  }

  passport.authenticate("jwt", { session: false }, (err, user, info) => {
    if (err) {
      return res.status(500).json({ error: "Authentifizierungsfehler" });
    }

    if (!user) {
      return res.status(401).json({ error: "Nicht authentifiziert" });
    }

    // Attach user to request object
    req.user = user;
    next();
  })(req, res, next);
};

// Export as default for convenience (allows both import patterns)
export default requireAuth;
