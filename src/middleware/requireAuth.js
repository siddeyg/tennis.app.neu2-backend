import { requireAuth as clerkRequireAuth } from "@clerk/express";

/**
 * Middleware to protect routes - requires user to be authenticated
 * In DEV_MODE=true, auth is bypassed for API testing
 * Usage: app.use('/api/protected-route', requireAuth, yourRouteHandler)
 */
export const requireAuth = (req, res, next) => {
  // Bypass auth in development mode
  if (process.env.DEV_MODE === "true") {
    console.log("⚠️  DEV_MODE: Bypassing authentication");
    req.auth = {
      userId: "dev-user",
      sessionId: "dev-session"
    };
    return next();
  }

  // Use Clerk auth in production
  return clerkRequireAuth()(req, res, next);
};
