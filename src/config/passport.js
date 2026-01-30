import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as JWTStrategy } from "passport-jwt";
import User from "../models/User.js";

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
   * Extracts JWT from cookies
   */
  const cookieExtractor = (req) => {
    let token = null;
    if (req && req.cookies) {
      token = req.cookies['authToken'];
    }
    return token;
  };

  passport.use(
    new JWTStrategy(
      {
        jwtFromRequest: cookieExtractor,
        secretOrKey: process.env.JWT_SECRET,
        algorithms: ['HS256'], // Enforce algorithm
      },
      async (payload, done) => {
        try {
          // Find user by ID from token payload
          const user = await User.findById(payload.userId);

          if (!user) {
            return done(null, false);
          }

          // Check if user is still active
          if (!user.isActive) {
            return done(null, false);
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
