import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as JWTStrategy } from "passport-jwt";
import User from "../models/User.js";
import StudentPortalUser from "../models/StudentPortalUser.js";

/**
 * Configure Passport strategies
 * Must be called AFTER environment variables are loaded
 */
export function configurePassport() {
  /**
   * Passport Local Strategy - for email/password login
   */
  passport.use(
    new LocalStrategy(
      {
        usernameField: "email", // Use email instead of username
        passwordField: "password",
      },
      async (email, password, done) => {
        try {
          // Find user by email
          const user = await User.findOne({ email: email.toLowerCase() });

          if (!user) {
            return done(null, false, { message: "Ungültige E-Mail oder Passwort" });
          }

          // Check if user is active
          if (!user.isActive) {
            return done(null, false, { message: "Ihr Konto wurde deaktiviert" });
          }

          // Compare password
          const isMatch = await user.comparePassword(password);

          if (!isMatch) {
            return done(null, false, { message: "Ungültige E-Mail oder Passwort" });
          }

          // Update last login
          user.lastLogin = new Date();
          await user.save();

          // Success
          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  /**
   * Passport JWT Strategy - for token-based authentication
   * Extracts JWT from cookies (supports both admin and portal tokens)
   */
  const cookieExtractor = (req) => {
    let token = null;
    if (req && req.cookies) {
      // Try portal token first, then admin token
      token = req.cookies['portalAccessToken'] || req.cookies['authToken'];
    }
    return token;
  };

  // Secret resolver - use correct secret based on which cookie is present
  const secretOrKeyProvider = (req, rawJwtToken, done) => {
    if (req && req.cookies) {
      if (req.cookies['portalAccessToken']) {
        // Student portal token - use PORTAL_JWT_SECRET
        return done(null, process.env.PORTAL_JWT_SECRET || process.env.JWT_SECRET);
      } else if (req.cookies['authToken']) {
        // Admin portal token - use JWT_SECRET
        return done(null, process.env.JWT_SECRET);
      }
    }
    // Fallback
    return done(null, process.env.JWT_SECRET);
  };

  passport.use(
    new JWTStrategy(
      {
        jwtFromRequest: cookieExtractor,
        secretOrKeyProvider: secretOrKeyProvider, // Use dynamic secret based on cookie
        algorithms: ['HS256'], // Enforce algorithm
        passReqToCallback: true, // Required for secretOrKeyProvider
      },
      async (req, payload, done) => {
        try {
          // Get user ID from payload (portal tokens use 'id', admin tokens use 'userId')
          const userId = payload.id || payload.userId;

          if (!userId) {
            return done(null, false);
          }

          let user;

          // Check role to determine which model to query
          if (payload.role === 'student') {
            // Portal user (student)
            user = await StudentPortalUser.findById(userId);
          } else if (payload.role === 'admin') {
            // Could be admin from User table OR StudentPortalUser table
            // Try StudentPortalUser first (portal admin), then User (regular admin)
            user = await StudentPortalUser.findById(userId);
            if (!user) {
              user = await User.findById(userId);
            }
          } else {
            // Coach, trainer, or other roles from User table
            user = await User.findById(userId);
          }

          if (!user) {
            return done(null, false);
          }

          // Check if user is still active
          if (!user.isActive) {
            return done(null, false);
          }

          // Attach original payload for debugging
          user._jwtPayload = payload;

          // Ensure role is set from JWT payload (critical for requireRole middleware)
          // The JWT payload is the source of truth for the role
          if (!user.role && payload.role) {
            user.role = payload.role;
          }

          return done(null, user);
        } catch (error) {
          return done(error, false);
        }
      }
    )
  );

  return passport;
}

export default passport;
