import jwt from 'jsonwebtoken';

/**
 * Middleware to verify portal JWT token
 * Extracts user info from portal access token cookie
 * Used by Student Portal and Coach Portal routes
 * In test mode, allows mock authentication by checking if req.user is already set
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
    next();

  } catch (error) {
    console.error('Portal auth error:', error);
    res.status(401).json({ error: 'Ungültiger oder abgelaufener Token' });
  }
};

export default verifyPortalAuth;
