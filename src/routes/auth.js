import express from "express";
import jwt from "jsonwebtoken";
import passport from "passport";
import rateLimit from "express-rate-limit";
import User from "../models/User.js";

const router = express.Router();

// Rate limiter for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: { error: "Zu viele Login-Versuche. Bitte versuchen Sie es in 15 Minuten erneut." },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /api/auth/login
 * Login with email and password
 * Rate limited: 5 attempts per 15 minutes
 */
router.post("/login", loginLimiter, (req, res, next) => {
  passport.authenticate("local", { session: false }, (err, user, info) => {
    if (err) {
      return res.status(500).json({ error: "Server-Fehler beim Login" });
    }

    if (!user) {
      return res.status(401).json({ error: info.message || "Ungültige Anmeldedaten" });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user._id,
        email: user.email,
        role: user.role
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || "15m",
        algorithm: "HS256"
      }
    );

    // Generate refresh token
    const refreshToken = jwt.sign(
      { userId: user._id },
      process.env.REFRESH_TOKEN_SECRET,
      {
        expiresIn: process.env.REFRESH_EXPIRES_IN || "7d",
        algorithm: "HS256"
      }
    );

    // Set tokens in httpOnly cookies
    const isProduction = process.env.NODE_ENV === "production";

    // Cookie options
    const cookieOptions = {
      httpOnly: true,
      secure: isProduction, // HTTPS only in production
      sameSite: isProduction ? "strict" : "lax",
    };

    // In development, don't set domain to allow cookies to work across localhost ports
    // Browsers will default to the current domain (localhost)
    if (!isProduction) {
      // Setting path to '/' ensures cookies are sent with all requests
      cookieOptions.path = '/';
    }

    res.cookie("authToken", token, {
      ...cookieOptions,
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    });

    res.cookie("refreshToken", refreshToken, {
      ...cookieOptions,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    // Return user data (password already excluded by toJSON method)
    res.json({
      message: "Login erfolgreich",
      user: user.toJSON(),
    });
  })(req, res, next);
});

/**
 * POST /api/auth/logout
 * Clear authentication cookies
 */
router.post("/logout", (req, res) => {
  res.clearCookie("authToken");
  res.clearCookie("refreshToken");
  res.json({ message: "Logout erfolgreich" });
});

/**
 * GET /api/auth/me
 * Get current logged-in user
 * Protected route - requires authentication
 */
router.get("/me",
  passport.authenticate("jwt", { session: false }),
  (req, res) => {
    res.json({ user: req.user.toJSON() });
  }
);

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post("/refresh", async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ error: "Kein Refresh-Token vorhanden" });
  }

  try {
    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET, {
      algorithms: ["HS256"]
    });

    // Get user
    const user = await User.findById(decoded.userId);

    if (!user || !user.isActive) {
      return res.status(401).json({ error: "Ungültiger Benutzer" });
    }

    // Generate new access token
    const newToken = jwt.sign(
      {
        userId: user._id,
        email: user.email,
        role: user.role
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || "15m",
        algorithm: "HS256"
      }
    );

    // Set new token in cookie
    const isProduction = process.env.NODE_ENV === "production";

    // Cookie options
    const cookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "strict" : "lax",
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    };

    // In development, set path to '/' ensures cookies are sent with all requests
    if (!isProduction) {
      cookieOptions.path = '/';
    }

    res.cookie("authToken", newToken, cookieOptions);

    res.json({ message: "Token erneuert" });
  } catch (error) {
    return res.status(401).json({ error: "Ungültiger Refresh-Token" });
  }
});

/**
 * POST /api/auth/register
 * Register new user (admin only)
 * This route will be protected in server.js with requireAuth + requireRole middleware
 */
router.post("/register", async (req, res) => {
  try {
    const { email, password, firstName, lastName, role } = req.body;

    // Validation
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: "Alle Felder sind erforderlich" });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Passwort muss mindestens 8 Zeichen lang sein" });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: "E-Mail bereits registriert" });
    }

    // Create new user
    const user = new User({
      email: email.toLowerCase(),
      password,
      firstName,
      lastName,
      role: role || "viewer",
    });

    await user.save();

    res.status(201).json({
      message: "Benutzer erfolgreich erstellt",
      user: user.toJSON(),
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Fehler beim Erstellen des Benutzers" });
  }
});

export default router;
