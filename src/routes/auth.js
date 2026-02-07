import express from "express";
import jwt from "jsonwebtoken";
import passport from "passport";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import User from "../models/User.js";
import LoginSession from "../models/LoginSession.js";
import UserSettings from "../models/UserSettings.js";

const router = express.Router();

// IP whitelist - these IPs bypass all rate limits
const RATE_LIMIT_WHITELIST = [
  '84.119.177.212', // Admin/Developer IP
];

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
  passport.authenticate("local", { session: false }, (err, user, info) => {
    if (err) {
      console.error("Login error:", err);
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

    // Update lastLogin and lastActivity
    User.updateOne(
      { _id: user._id },
      {
        $set: {
          lastLogin: new Date(),
          lastActivity: new Date()
        }
      }
    ).catch(err => console.error("Error updating login time:", err));

    // Create login session (keeps last 30 automatically)
    const userAgent = req.get('user-agent') || 'Unknown';
    LoginSession.createSession(user._id, userAgent)
      .catch(err => console.error("Error creating login session:", err));

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
router.post("/refresh", refreshLimiter, async (req, res) => {
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
      console.error("Error creating user settings:", err);
    });

    // TODO: Send verification email
    // const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
    // await sendVerificationEmail(user.email, user.firstName, verifyUrl);

    // DEVELOPMENT ONLY: Return verification link in response
    const isDevelopment = process.env.NODE_ENV !== "production";
    const verifyUrl = `http://localhost:3000/verify-email?token=${verificationToken}`;

    console.log("User registered:", user.email);
    console.log("Verification token (plain):", verificationToken);
    console.log("Verification URL:", verifyUrl);

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
    console.error("Registration error:", error);
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

router.post("/forgot-password", forgotPasswordLimiter, async (req, res) => {
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

    console.log("Password reset requested for:", user.email);
    console.log("Reset token (plain):", resetToken);
    console.log("Reset URL:", resetUrl);

    res.json({
      message: "Wenn die E-Mail-Adresse existiert, wurde eine Passwort-Reset-E-Mail gesendet.",
      // DEVELOPMENT ONLY
      ...(isDevelopment && {
        resetUrl,
        devNote: "In Produktion wird dieser Link per E-Mail gesendet (nicht in Response)"
      }),
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ error: "Fehler beim Verarbeiten der Anfrage" });
  }
});

/**
 * POST /api/auth/reset-password
 * Reset password with token
 */
router.post("/reset-password", async (req, res) => {
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

    console.log("Password reset successful for:", user.email);

    res.json({
      message: "Passwort erfolgreich zurückgesetzt. Sie können sich jetzt anmelden.",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ error: "Fehler beim Zurücksetzen des Passworts" });
  }
});

/**
 * POST /api/auth/verify-email
 * Verify email address with token
 */
router.post("/verify-email", async (req, res) => {
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

    console.log("Email verified successfully for:", user.email);

    res.json({
      message: "E-Mail erfolgreich verifiziert. Sie können sich jetzt anmelden.",
    });
  } catch (error) {
    console.error("Email verification error:", error);
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

router.post("/resend-verification", resendVerificationLimiter, async (req, res) => {
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

    console.log("Email verification resent for:", user.email);
    console.log("Verification token (plain):", verificationToken);
    console.log("Verification URL:", verifyUrl);

    res.json({
      message: "Wenn die E-Mail-Adresse existiert, wurde eine Verifizierungs-E-Mail gesendet.",
      // DEVELOPMENT ONLY
      ...(isDevelopment && {
        verifyUrl,
        devNote: "In Produktion wird dieser Link per E-Mail gesendet (nicht in Response)"
      }),
    });
  } catch (error) {
    console.error("Resend verification error:", error);
    res.status(500).json({ error: "Fehler beim Versenden der Verifizierungs-E-Mail" });
  }
});

export default router;
