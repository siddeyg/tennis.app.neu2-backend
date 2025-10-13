import passport from "passport";

/**
 * Middleware to protect routes - requires user to be authenticated
 * Uses Passport JWT strategy to verify token from cookies
 * Usage: app.use('/api/protected-route', requireAuth, yourRouteHandler)
 */
export const requireAuth = (req, res, next) => {
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
