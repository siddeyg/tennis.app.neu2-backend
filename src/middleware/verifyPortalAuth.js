import jwt from 'jsonwebtoken';
import StudentPortalUser from '../models/StudentPortalUser.js';
import logger from '../utils/logger.js';

/**
 * Middleware to verify portal JWT token
 * Extracts user info from portal access token cookie
 * Used by Student Portal and Coach Portal routes
 * In test mode, allows mock authentication by checking if req.user is already set
 * Also updates lastActivity timestamp every 5 minutes
 */
export const verifyPortalAuth = async (req, res, next) => {
  try {
    // Allow test mocks to bypass JWT verification (test environment only)
    if (process.env.NODE_ENV === 'test' && req.user && (req.user.role === 'student' || req.user.role === 'coach')) {
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
        logger.error('Error updating portal user activity', { error: activityError.message, userId: req.user.id });
      }
    }

    next();

  } catch (error) {
    logger.error('Portal auth error', { error: error.message, stack: error.stack });
    res.status(401).json({ error: 'Ungültiger oder abgelaufener Token' });
  }
};

export default verifyPortalAuth;
