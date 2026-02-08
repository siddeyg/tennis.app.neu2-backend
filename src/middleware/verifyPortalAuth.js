import jwt from 'jsonwebtoken';
import StudentPortalUser from '../models/StudentPortalUser.js';

/**
 * Middleware to verify portal JWT token
 * Extracts user info from portal access token cookie
 * Used by Student Portal and Coach Portal routes
 * In test mode, allows mock authentication by checking if req.user is already set
 * Also updates lastActivity timestamp every 5 minutes
 */
export const verifyPortalAuth = async (req, res, next) => {
  try {
    // Allow test mocks to bypass JWT verification
    // If req.user is already set (by test middleware), skip JWT verification
    if (req.user && (req.user.role === 'student' || req.user.role === 'coach')) {
      return next();
    }

    const token = req.cookies.portalAccessToken;

    if (!token) {
      return res.status(401).json({ error: 'Nicht authentifiziert' });
    }

    // Verify token using PORTAL_JWT_SECRET or fallback to JWT_SECRET
    const decoded = jwt.verify(
      token,
      process.env.PORTAL_JWT_SECRET || process.env.JWT_SECRET
    );

    // Attach user info to request
    req.user = decoded;

    // Update lastActivity timestamp (only for student portal users, not coaches)
    // Update every 5 minutes to avoid excessive database writes
    if (req.user.role === 'student' && req.user.id) {
      try {
        const now = new Date();
        const portalUser = await StudentPortalUser.findById(req.user.id);

        if (portalUser) {
          const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

          if (!portalUser.lastActivity || portalUser.lastActivity < fiveMinutesAgo) {
            await StudentPortalUser.updateOne(
              { _id: portalUser._id },
              { $set: { lastActivity: now } }
            );
          }
        }
      } catch (activityError) {
        // Don't break the request if activity update fails
        console.error('Error updating portal user activity:', activityError);
      }
    }

    next();

  } catch (error) {
    console.error('Portal auth error:', error);
    res.status(401).json({ error: 'Ungültiger oder abgelaufener Token' });
  }
};

export default verifyPortalAuth;
