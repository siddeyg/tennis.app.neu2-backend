import express from "express";
import jwt from "jsonwebtoken";
import passport from "passport";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import User from "../models/User.js";
import LoginSession from "../models/LoginSession.js";
import UserSettings from "../models/UserSettings.js";
import logger from "../utils/logger.js";
import { createAuditLog, auditLogMiddleware } from "../middleware/auditLog.js";

const router = express.Router();

// IP whitelist - these IPs bypass all rate limits
// Loaded from environment variable (comma-separated list)
const RATE_LIMIT_WHITELIST = process.env.IP_WHITELIST
  ? process.env.IP_WHITELIST.split(',').map(ip => ip.trim())
  : [];

// Helper function to check if IP is whitelisted
const isWhitelisted = (req) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  return RATE_LIMIT_WHITELIST.includes(clientIp);
};

// Rate limiter for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 5 : 100, // Limit: 5 in prod, 100 in dev
  message: { error: "Zu viele Login-Versuche. Bitte versuchen Sie es in 15 Minuten erneut." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: isWhitelisted, // Skip rate limiting for whitelisted IPs
});

// Rate limiter for token refresh (more generous than login)
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 20 : 100, // Limit: 20 in prod, 100 in dev
  message: { error: "Zu viele Token-Aktualisierungsversuche. Bitte versuchen Sie es später erneut." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: isWhitelisted, // Skip rate limiting for whitelisted IPs
});

/**
 * POST /api/auth/login
 * Login with email and password
 * Rate limited: 5 attempts per 15 minutes
 */
router.post("/login", loginLimiter, (req, res, next) => {
  passport.authenticate("local", { session: false }, async (err, user, info) => {
    if (err) {
      logger.error("Login error", { error: err.message, stack: err.stack });
      // Log failed login attempt due to server error
      await createAuditLog({
        userId: null,
        userEmail: req.body.email,
        userRole: 'system',
        action: 'LOGIN',
        resource: 'auth',
        method: 'POST',
        endpoint: req.originalUrl,
        requestBody: req.body,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
        status: 'ERROR',
        errorMessage: 'Server-Fehler beim Login'
      });
      return res.status(500).json({ error: "Server-Fehler beim Login" });
    }

    if (!user) {
      // Log failed login attempt
      await createAuditLog({
        userId: null,
        userEmail: req.body.email,
        userRole: 'system',
        action: 'LOGIN',
        resource: 'auth',
        method: 'POST',
        endpoint: req.originalUrl,
        requestBody: req.body,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
        status: 'DENIED',
        errorMessage: info.message || "Ungültige Anmeldedaten"
      });
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

    // Update lastLogin and lastActivity
    User.updateOne(
      { _id: user._id },
      {
        $set: {
          lastLogin: new Date(),
          lastActivity: new Date()
        }
      }
    ).catch(err => logger.error("Error updating login time", { error: err.message, userId: user._id }));

    // Create login session (keeps last 30 automatically)
    const userAgent = req.get('user-agent') || 'Unknown';
    LoginSession.createSession(user._id, userAgent)
      .catch(err => logger.error("Error creating login session", { error: err.message, userId: user._id }));

    // Log successful login
    await createAuditLog({
      userId: user._id,
      userEmail: user.email,
      userRole: user.role,
      action: 'LOGIN',
      resource: 'auth',
      resourceId: user._id.toString(),
      method: 'POST',
      endpoint: req.originalUrl,
      requestBody: req.body,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent'),
      status: 'SUCCESS'
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
router.post("/logout",
  auditLogMiddleware({ action: 'LOGOUT', resource: 'auth' }),
  (req, res) => {
    res.clearCookie("authToken");
    res.clearCookie("refreshToken");
    res.json({ message: "Logout erfolgreich" });
  }
);

/**
 * GET /api/auth/me
 * Get current logged-in user
 * Protected route - requires authentication
 */
router.get("/me",
  passport.authenticate("jwt", { session: false }),
  auditLogMiddleware({ action: 'ACCESS', resource: 'auth' }),
  (req, res) => {
    res.json({ user: req.user.toJSON() });
  }
);

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post("/refresh",
  refreshLimiter,
  auditLogMiddleware({ action: 'ACCESS', resource: 'auth', metadata: { operation: 'token_refresh' } }),
  async (req, res) => {
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
router.post("/register",
  auditLogMiddleware({ action: 'CREATE', resource: 'users' }),
  async (req, res) => {
  try {
    const { email, password, firstName, lastName, role, studentId, coachId } = req.body;

    // Validation
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: "Alle Felder sind erforderlich" });
    }

    // Password complexity validation
    if (password.length < 8) {
      return res.status(400).json({ error: "Passwort muss mindestens 8 Zeichen lang sein" });
    }

    if (!/[0-9]/.test(password)) {
      return res.status(400).json({ error: 'Passwort muss mindestens eine Zahl enthalten' });
    }

    if (!/[A-Z]/.test(password)) {
      return res.status(400).json({ error: 'Passwort muss mindestens einen Großbuchstaben enthalten' });
    }

    if (!/[^A-Za-z0-9]/.test(password)) {
      return res.status(400).json({ error: 'Passwort muss mindestens ein Sonderzeichen enthalten' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: "E-Mail bereits registriert" });
    }

    // Validate role-specific requirements
    if (role === "coach" && !coachId) {
      return res.status(400).json({ error: "Coach-Rolle benötigt eine Coach-ID" });
    }
    if (role === "student" && !studentId) {
      return res.status(400).json({ error: "Student-Rolle benötigt eine Student-ID" });
    }

    // Generate email verification token (cryptographically secure random)
    const verificationToken = crypto.randomBytes(32).toString("hex");

    // Hash token before saving (never store plain tokens in database)
    const hashedToken = crypto.createHash("sha256").update(verificationToken).digest("hex");

    // Create new user
    const user = new User({
      email: email.toLowerCase(),
      password,
      firstName,
      lastName,
      role: role || "student",
      studentId: studentId || null,
      coachId: coachId || null,
      emailVerificationToken: hashedToken,
      isEmailVerified: false,
    });

    await user.save();

    // Auto-create UserSettings with default values
    await UserSettings.create({
      userId: user._id,
      allowResetSchedule: true, // Default: user CAN click "Plan generieren"
    }).catch(err => {
      // Non-blocking: If settings creation fails, don't fail the registration
      logger.error("Error creating user settings", { error: err.message, userId: user._id });
    });

    // TODO: Send verification email
    // const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
    // await sendVerificationEmail(user.email, user.firstName, verifyUrl);

    // DEVELOPMENT ONLY: Return verification link in response
    const isDevelopment = process.env.NODE_ENV !== "production";
    const verifyUrl = `http://localhost:3000/verify-email?token=${verificationToken}`;

    logger.info("User registered", { email: user.email });
    // Security: Token is sent via email, NOT logged

    res.status(201).json({
      message: "Benutzer erfolgreich erstellt. Bitte überprüfen Sie Ihre E-Mail zur Verifizierung.",
      user: user.toJSON(),
      // DEVELOPMENT ONLY
      ...(isDevelopment && {
        verifyUrl,
        devNote: "In Produktion wird dieser Link per E-Mail gesendet (nicht in Response)"
      }),
    });
  } catch (error) {
    logger.error("Registration error", { error: error.message, stack: error.stack });
    res.status(500).json({ error: "Fehler beim Erstellen des Benutzers" });
  }
});

/**
 * POST /api/auth/forgot-password
 * Request password reset - generates token and sends email
 * Rate limited to prevent abuse
 */
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // 3 requests per 15 minutes
  message: { error: "Zu viele Passwort-Reset-Anfragen. Bitte versuchen Sie es in 15 Minuten erneut." },
  skip: isWhitelisted, // Skip rate limiting for whitelisted IPs
});

router.post("/forgot-password",
  forgotPasswordLimiter,
  auditLogMiddleware({ action: 'ACCESS', resource: 'auth', metadata: { operation: 'password_reset_request' } }),
  async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "E-Mail ist erforderlich" });
    }

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase(), isActive: true });

    // Always return success message (security: don't reveal if email exists)
    if (!user) {
      return res.json({
        message: "Wenn die E-Mail-Adresse existiert, wurde eine Passwort-Reset-E-Mail gesendet.",
      });
    }

    // Generate reset token (cryptographically secure random)
    const resetToken = crypto.randomBytes(32).toString("hex");

    // Hash token before saving (never store plain tokens in database)
    const hashedToken = crypto.createHash("sha256").update(resetToken).digest("hex");

    // Save hashed token and expiry (1 hour)
    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1 hour
    await user.save();

    // TODO: Send email with reset link
    // const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    // await sendPasswordResetEmail(user.email, user.firstName, resetUrl);

    // DEVELOPMENT ONLY: Return reset link in response
    // In production, this should be sent via email and NOT returned in response
    const isDevelopment = process.env.NODE_ENV !== "production";
    const resetUrl = `http://localhost:3000/reset-password?token=${resetToken}`;

    logger.info("Password reset requested", { email: user.email });
    // Security: Token is sent via email, NOT logged

    res.json({
      message: "Wenn die E-Mail-Adresse existiert, wurde eine Passwort-Reset-E-Mail gesendet.",
      // DEVELOPMENT ONLY
      ...(isDevelopment && {
        resetUrl,
        devNote: "In Produktion wird dieser Link per E-Mail gesendet (nicht in Response)"
      }),
    });
  } catch (error) {
    logger.error("Forgot password error", { error: error.message, stack: error.stack });
    res.status(500).json({ error: "Fehler beim Verarbeiten der Anfrage" });
  }
});

/**
 * POST /api/auth/reset-password
 * Reset password with token
 */
router.post("/reset-password",
  auditLogMiddleware({ action: 'UPDATE', resource: 'auth', metadata: { operation: 'password_reset' } }),
  async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: "Token und neues Passwort sind erforderlich" });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: "Passwort muss mindestens 8 Zeichen lang sein" });
    }

    // Hash the token from URL to compare with database
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    // Find user with valid token (not expired)
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
      isActive: true,
    });

    if (!user) {
      return res.status(400).json({
        error: "Ungültiger oder abgelaufener Reset-Token. Bitte fordern Sie einen neuen an.",
      });
    }

    // Set new password (pre-save hook will hash it)
    user.password = newPassword;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    logger.info("Password reset successful", { email: user.email });

    res.json({
      message: "Passwort erfolgreich zurückgesetzt. Sie können sich jetzt anmelden.",
    });
  } catch (error) {
    logger.error("Reset password error", { error: error.message, stack: error.stack });
    res.status(500).json({ error: "Fehler beim Zurücksetzen des Passworts" });
  }
});

/**
 * POST /api/auth/verify-email
 * Verify email address with token
 */
router.post("/verify-email",
  auditLogMiddleware({ action: 'UPDATE', resource: 'auth', metadata: { operation: 'email_verification' } }),
  async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: "Verifizierungs-Token ist erforderlich" });
    }

    // Hash the token from URL to compare with database
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    // Find user with matching verification token
    const user = await User.findOne({
      emailVerificationToken: hashedToken,
      isActive: true,
    });

    if (!user) {
      return res.status(400).json({
        error: "Ungültiger Verifizierungs-Token. Bitte fordern Sie einen neuen an.",
      });
    }

    // Check if already verified
    if (user.isEmailVerified) {
      return res.json({
        message: "E-Mail bereits verifiziert. Sie können sich anmelden.",
      });
    }

    // Mark email as verified and clear token
    user.isEmailVerified = true;
    user.emailVerificationToken = null;
    await user.save();

    logger.info("Email verified successfully", { email: user.email });

    res.json({
      message: "E-Mail erfolgreich verifiziert. Sie können sich jetzt anmelden.",
    });
  } catch (error) {
    logger.error("Email verification error", { error: error.message, stack: error.stack });
    res.status(500).json({ error: "Fehler bei der E-Mail-Verifizierung" });
  }
});

/**
 * POST /api/auth/resend-verification
 * Resend email verification link
 * Rate limited to prevent abuse
 */
const resendVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // 3 requests per 15 minutes
  message: { error: "Zu viele Anfragen. Bitte versuchen Sie es in 15 Minuten erneut." },
  skip: isWhitelisted, // Skip rate limiting for whitelisted IPs
});

router.post("/resend-verification",
  resendVerificationLimiter,
  auditLogMiddleware({ action: 'ACCESS', resource: 'auth', metadata: { operation: 'resend_verification' } }),
  async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "E-Mail ist erforderlich" });
    }

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase(), isActive: true });

    // Always return success message (security: don't reveal if email exists)
    if (!user) {
      return res.json({
        message: "Wenn die E-Mail-Adresse existiert, wurde eine Verifizierungs-E-Mail gesendet.",
      });
    }

    // Check if already verified
    if (user.isEmailVerified) {
      return res.json({
        message: "E-Mail bereits verifiziert. Sie können sich anmelden.",
      });
    }

    // Generate verification token (cryptographically secure random)
    const verificationToken = crypto.randomBytes(32).toString("hex");

    // Hash token before saving (never store plain tokens in database)
    const hashedToken = crypto.createHash("sha256").update(verificationToken).digest("hex");

    // Save hashed token
    user.emailVerificationToken = hashedToken;
    await user.save();

    // TODO: Send email with verification link
    // const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
    // await sendVerificationEmail(user.email, user.firstName, verifyUrl);

    // DEVELOPMENT ONLY: Return verification link in response
    const isDevelopment = process.env.NODE_ENV !== "production";
    const verifyUrl = `http://localhost:3000/verify-email?token=${verificationToken}`;

    logger.info("Email verification resent", { email: user.email });
    // Security: Token is sent via email, NOT logged

    res.json({
      message: "Wenn die E-Mail-Adresse existiert, wurde eine Verifizierungs-E-Mail gesendet.",
      // DEVELOPMENT ONLY
      ...(isDevelopment && {
        verifyUrl,
        devNote: "In Produktion wird dieser Link per E-Mail gesendet (nicht in Response)"
      }),
    });
  } catch (error) {
    logger.error("Resend verification error", { error: error.message, stack: error.stack });
    res.status(500).json({ error: "Fehler beim Versenden der Verifizierungs-E-Mail" });
  }
});

export default router;
