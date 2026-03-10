import crypto from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import StudentPortalUser from '../models/StudentPortalUser.js';
import Student from '../models/Student.js';
import User from '../models/User.js';
import Settings from '../models/Settings.js';
import logger from '../utils/logger.js';
import {
  generateVerificationTokenWithExpiry,
  generatePasswordResetToken,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail
} from '../utils/emailService.js';
import { createAuditLog, auditLogMiddleware } from '../middleware/auditLog.js';
import verifyPortalAuth from '../middleware/verifyPortalAuth.js';
import SupportTicket from '../models/SupportTicket.js';

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

// Rate limiting for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 10 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isWhitelisted, // Skip rate limiting for whitelisted IPs
  handler: (req, res) => {
    res.status(429).json({
      error: 'Zu viele Anmeldeversuche. Bitte warten Sie 15 Minuten und versuchen Sie es erneut.'
    });
  }
});

// Rate limiting for registration
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 10 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isWhitelisted, // Skip rate limiting for whitelisted IPs
  handler: (req, res) => {
    res.status(429).json({
      error: 'Zu viele Registrierungsversuche. Bitte warten Sie 15 Minuten und versuchen Sie es erneut.'
    });
  }
});

// Rate limiting for resend verification
const resendVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 3 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isWhitelisted,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Zu viele Anfragen. Bitte warten Sie 15 Minuten und versuchen Sie es erneut.'
    });
  }
});

// Rate limiting for password reset consumption + email change verification
const tokenConsumptionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: process.env.NODE_ENV === 'production' ? 20 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isWhitelisted,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Zu viele Anfragen. Bitte warten Sie eine Stunde und versuchen Sie es erneut.'
    });
  }
});

/**
 * @route   POST /api/portal/auth/register
 * @desc    Register new student portal account (NO studentId required - GDPR compliant)
 * @access  Public
 */
router.post('/register',
  registerLimiter,
  auditLogMiddleware({ action: 'CREATE', resource: 'StudentPortalUser' }),
  async (req, res) => {
  try {
    // Check if portal registration is enabled
    const settings = await Settings.findOne({ singleton: true });
    if (settings && settings.portalRegistrationEnabled === false) {
      return res.status(403).json({
        error: 'Registrierung vorübergehend geschlossen',
        registrationDisabled: true
      });
    }

    const { email, password, firstName, lastName, birthdate, sex, member, phone, address, parentName, parentEmail, parentPhone } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email und Passwort sind erforderlich' });
    }

    if (!firstName || !lastName || !birthdate) {
      return res.status(400).json({ error: 'Vorname, Nachname und Geburtsdatum sind erforderlich' });
    }

    const birthdateObj = new Date(birthdate);
    if (isNaN(birthdateObj.getTime())) {
      return res.status(400).json({ error: 'Ungültiges Geburtsdatum' });
    }
    const birthdateYear = birthdateObj.getFullYear();
    if (birthdateYear < 1900 || birthdateYear > new Date().getFullYear()) {
      return res.status(400).json({ error: 'Geburtsdatum muss zwischen 1900 und heute liegen' });
    }

    if (!sex || !['männlich', 'weiblich'].includes(sex)) {
      return res.status(400).json({ error: 'Geschlecht ist erforderlich' });
    }

    if (member === undefined || member === null) {
      return res.status(400).json({ error: 'Mitgliedsstatus ist erforderlich' });
    }

    // Password complexity validation
    if (password.length < 8) {
      return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen lang sein' });
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

    // Address is required for all users
    if (!address || address.trim().length === 0) {
      return res.status(400).json({ error: 'Bitte geben Sie Ihre Adresse ein' });
    }

    // Minors (< 18) cannot register
    const ageMs = Date.now() - new Date(birthdate).getTime();
    const ageYears = ageMs / (365.25 * 24 * 60 * 60 * 1000);
    if (ageYears < 18) {
      return res.status(400).json({ error: 'Die Registrierung ist nur für Personen ab 18 Jahren möglich. Bitte wenden Sie sich an den Verein.' });
    }

    // Check if email already registered
    const existingUser = await StudentPortalUser.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: 'Diese Email-Adresse ist bereits registriert' });
    }

    // Generate verification token
    const { token: verificationToken, expires: verificationTokenExpires } = generateVerificationTokenWithExpiry();
    const hashedVerificationToken = crypto.createHash('sha256').update(verificationToken).digest('hex');

    // Create new portal user (WITHOUT studentId - will be linked during seasonal registration)
    const portalUser = new StudentPortalUser({
      email: email.toLowerCase(),
      password,
      firstName,
      lastName,
      birthdate: new Date(birthdate),
      sex,
      member: member === true || member === 'true',
      phone: phone || null,
      address: address.trim(),
      profileCompleted: true,
      studentId: null,  // Will be linked when first seasonal registration is submitted
      verificationToken: hashedVerificationToken,
      verificationTokenExpires,
      emailVerified: false
    });

    await portalUser.save();

    // Send verification email (raw token goes in link, hash stored in DB)
    // Fire-and-forget: registration succeeds immediately, email delivery is non-blocking
    const studentName = `${firstName} ${lastName}`;
    sendVerificationEmail(email, verificationToken, studentName)
      .catch(emailError => logger.error('Failed to send verification email', { email, error: emailError.message }));

    res.status(201).json({
      message: 'Registrierung erfolgreich. Bitte überprüfen Sie Ihre Email zur Verifizierung.',
      userId: portalUser._id,
      emailSent: true
    });

  } catch (error) {
    logger.error('Registration error', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler bei der Registrierung' });
  }
});

/**
 * @route   GET /api/portal/auth/registration-status
 * @desc    Check if portal registration is enabled
 * @access  Public
 */
router.get('/registration-status', async (req, res) => {
  try {
    const settings = await Settings.findOne({ singleton: true });
    const enabled = settings ? settings.portalRegistrationEnabled !== false : true;

    res.json({
      enabled,
      message: enabled ? null : 'Registrierung vorübergehend geschlossen'
    });
  } catch (error) {
    logger.error('Error fetching registration status', { error: error.message, stack: error.stack });
    // Default to enabled if there's an error
    res.json({ enabled: true });
  }
});

/**
 * @route   POST /api/portal/auth/verify-email
 * @desc    Verify email with token
 * @access  Public
 */
router.post('/verify-email',
  auditLogMiddleware({ action: 'UPDATE', resource: 'StudentPortalUser', metadata: { operation: 'email_verification' } }),
  async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Verifizierungs-Token erforderlich' });
    }

    // Hash incoming token to compare against stored hash
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    // Atomically claim the token: only one concurrent request can succeed
    const portalUser = await StudentPortalUser.findOneAndUpdate(
      {
        verificationToken: hashedToken,
        verificationTokenExpires: { $gt: Date.now() },
        emailVerified: false
      },
      {
        $set: { emailVerified: true },
        $unset: { verificationToken: '', verificationTokenExpires: '' }
      },
      { new: true }
    );

    if (!portalUser) {
      return res.status(400).json({ error: 'Ungültiger oder abgelaufener Verifizierungs-Token' });
    }

    // Send welcome email (non-blocking)
    const studentName = `${portalUser.firstName} ${portalUser.lastName}`;
    sendWelcomeEmail(portalUser.email, studentName)
      .catch(emailError => logger.error('Failed to send welcome email', { email: portalUser.email, error: emailError.message }));

    res.json({
      message: 'Email erfolgreich verifiziert',
      emailVerified: true
    });

  } catch (error) {
    logger.error('Email verification error', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler bei der Email-Verifizierung' });
  }
});

/**
 * @route   POST /api/portal/auth/login
 * @desc    Login student portal user
 * @access  Public
 */
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email und Passwort erforderlich' });
    }

    // Find user in StudentPortalUser table
    let portalUser = await StudentPortalUser.findOne({
      email: email.toLowerCase(),
      isActive: true
    }).populate('studentId');

    // If no portal user found, reject login
    if (!portalUser) {
      // Log failed login attempt
      await createAuditLog({
        userId: null,
        userEmail: email.toLowerCase(),
        userRole: 'student',
        action: 'LOGIN',
        resource: 'StudentPortalUser',
        method: 'POST',
        endpoint: req.originalUrl,
        requestBody: req.body,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
        status: 'DENIED',
        errorMessage: 'E-Mail Adresse unbekannt'
      });
      return res.status(401).json({
        error: 'Ungültige Anmeldedaten'
      });
    }

    // Continue with normal student portal user login
    // Check if email is verified
    if (!portalUser.emailVerified) {
      // Log failed login attempt - email not verified
      await createAuditLog({
        userId: portalUser._id,
        userEmail: portalUser.email,
        userRole: 'student',
        action: 'LOGIN',
        resource: 'StudentPortalUser',
        resourceId: portalUser._id.toString(),
        method: 'POST',
        endpoint: req.originalUrl,
        requestBody: req.body,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
        status: 'DENIED',
        errorMessage: 'Email noch nicht verifiziert'
      });
      return res.status(403).json({
        error: 'Email noch nicht verifiziert. Bitte überprüfen Sie Ihre Email.',
        emailVerified: false
      });
    }

    // Verify password
    const isMatch = await portalUser.comparePassword(password);
    if (!isMatch) {
      // Log failed login attempt - wrong password
      await createAuditLog({
        userId: portalUser._id,
        userEmail: portalUser.email,
        userRole: 'student',
        action: 'LOGIN',
        resource: 'StudentPortalUser',
        resourceId: portalUser._id.toString(),
        method: 'POST',
        endpoint: req.originalUrl,
        requestBody: req.body,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
        status: 'DENIED',
        errorMessage: 'Ungültige Anmeldedaten'
      });
      return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    }

    // Update last login
    portalUser.lastLogin = new Date();
    await portalUser.save();

    // Generate JWT tokens (using separate secret for student portal)
    const tokenPayload = {
      id: portalUser._id,
      role: 'student',
      profileCompleted: portalUser.profileCompleted || false
    };

    // Add studentId only if it exists
    if (portalUser.studentId) {
      tokenPayload.studentId = portalUser.studentId._id;
    }

    const accessToken = jwt.sign(
      tokenPayload,
      process.env.PORTAL_JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );

    const refreshToken = jwt.sign(
      {
        id: portalUser._id,
        role: 'student'
      },
      process.env.PORTAL_REFRESH_TOKEN_SECRET,
      { expiresIn: process.env.REFRESH_EXPIRES_IN || '7d' }
    );

    // Set cookies
    res.cookie('portalAccessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000 // 15 minutes
    });

    res.cookie('portalRefreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    // Prepare family members data
    const familyMembers = await Promise.all(
      portalUser.familyMembers.map(async (member) => {
        const student = await Student.findById(member.studentId);
        return {
          studentId: member.studentId,
          relationship: member.relationship,
          name: member.name || (student ? `${student.firstName} ${student.lastName}` : 'Unknown')
        };
      })
    );

    // Prepare response user object
    const userResponse = {
      id: portalUser._id,
      email: portalUser.email,
      role: 'student',
      firstName: portalUser.firstName,
      lastName: portalUser.lastName,
      birthdate: portalUser.birthdate,
      sex: portalUser.sex,
      member: portalUser.member,
      phone: portalUser.phone,
      familyMembers,
      preferences: portalUser.preferences,
      lastLogin: portalUser.lastLogin,
      emailVerified: portalUser.emailVerified,
      profileCompleted: portalUser.profileCompleted || false
    };

    // Add studentId and studentName only if Student record exists
    if (portalUser.studentId) {
      userResponse.studentId = portalUser.studentId._id;
      userResponse.studentName = `${portalUser.studentId.firstName} ${portalUser.studentId.lastName}`;
    }

    // Log successful login
    await createAuditLog({
      userId: portalUser._id,
      userEmail: portalUser.email,
      userRole: 'student',
      action: 'LOGIN',
      resource: 'StudentPortalUser',
      resourceId: portalUser._id.toString(),
      method: 'POST',
      endpoint: req.originalUrl,
      requestBody: req.body,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent'),
      status: 'SUCCESS'
    });

    res.json({
      message: 'Login erfolgreich',
      user: userResponse
    });

  } catch (error) {
    logger.error('Login error', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Login' });
  }
});

/**
 * @route   POST /api/portal/auth/refresh
 * @desc    Refresh access token
 * @access  Public (with refresh token)
 */
router.post('/refresh',
  auditLogMiddleware({ action: 'ACCESS', resource: 'StudentPortalUser', metadata: { operation: 'token_refresh' } }),
  async (req, res) => {
  try {
    const refreshToken = req.cookies.portalRefreshToken;

    if (!refreshToken) {
      return res.status(401).json({ error: 'Kein Refresh-Token vorhanden' });
    }

    // Verify refresh token
    const decoded = jwt.verify(
      refreshToken,
      process.env.PORTAL_REFRESH_TOKEN_SECRET
    );

    // Find user
    const portalUser = await StudentPortalUser.findById(decoded.id);
    if (!portalUser || !portalUser.isActive) {
      return res.status(401).json({ error: 'Benutzer nicht gefunden oder inaktiv' });
    }

    // Generate new access token
    const accessToken = jwt.sign(
      {
        id: portalUser._id,
        role: 'student',
        studentId: portalUser.studentId,
        profileCompleted: portalUser.profileCompleted || false
      },
      process.env.PORTAL_JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );

    // Set new access token cookie
    res.cookie('portalAccessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000
    });

    res.json({ message: 'Token erfolgreich erneuert' });

  } catch (error) {
    logger.error('Token refresh error', { error: error.message, stack: error.stack });
    res.status(401).json({ error: 'Ungültiger Refresh-Token' });
  }
});

/**
 * @route   POST /api/portal/auth/logout
 * @desc    Logout student portal user
 * @access  Public
 */
router.post('/logout',
  auditLogMiddleware({ action: 'LOGOUT', resource: 'StudentPortalUser' }),
  (req, res) => {
    res.clearCookie('portalAccessToken');
    res.clearCookie('portalRefreshToken');
    res.json({ message: 'Logout erfolgreich' });
  }
);

/**
 * @route   POST /api/portal/auth/forgot-password
 * @desc    Request password reset
 * @access  Public
 */
router.post('/forgot-password',
  authLimiter,
  auditLogMiddleware({ action: 'ACCESS', resource: 'StudentPortalUser', metadata: { operation: 'password_reset_request' } }),
  async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email-Adresse erforderlich' });
    }

    // Find user
    const portalUser = await StudentPortalUser.findOne({
      email: email.toLowerCase()
    });

    // Always return success (don't reveal if email exists)
    if (!portalUser) {
      return res.json({
        message: 'Falls ein Account mit dieser Email existiert, wurde eine Passwort-Zurücksetzen Email gesendet.'
      });
    }

    // Generate reset token (store hash in DB, send raw token in email)
    const { token: resetToken, expires: resetExpires } = generatePasswordResetToken();
    const hashedResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    portalUser.passwordResetToken = hashedResetToken;
    portalUser.passwordResetExpires = resetExpires;
    await portalUser.save();

    // Send password reset email
    const studentName = `${portalUser.firstName} ${portalUser.lastName}`;
    await sendPasswordResetEmail(email, resetToken, studentName);

    res.json({
      message: 'Falls ein Account mit dieser Email existiert, wurde eine Passwort-Zurücksetzen Email gesendet.',
      emailSent: true
    });

  } catch (error) {
    logger.error('Forgot password error', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Passwort-Reset' });
  }
});

/**
 * @route   POST /api/portal/auth/reset-password
 * @desc    Reset password with token
 * @access  Public
 */
router.post('/reset-password',
  tokenConsumptionLimiter,
  auditLogMiddleware({ action: 'UPDATE', resource: 'StudentPortalUser', metadata: { operation: 'password_reset' } }),
  async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    // Validation
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token und neues Passwort erforderlich' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen lang sein' });
    }

    // Hash incoming token to compare against stored hash
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    // Find user with valid reset token
    const portalUser = await StudentPortalUser.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() }
    });

    if (!portalUser) {
      return res.status(400).json({ error: 'Ungültiger oder abgelaufener Reset-Token' });
    }

    // Update password
    portalUser.password = newPassword;
    portalUser.passwordResetToken = undefined;
    portalUser.passwordResetExpires = undefined;
    await portalUser.save();

    res.json({ message: 'Passwort erfolgreich zurückgesetzt' });

  } catch (error) {
    logger.error('Password reset error', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Passwort-Reset' });
  }
});

/**
 * @route   GET /api/portal/auth/me
 * @desc    Get current student portal user
 * @access  Private (requires portal auth middleware)
 */
router.get('/me',
  auditLogMiddleware({ action: 'ACCESS', resource: 'StudentPortalUser' }),
  async (req, res) => {
  try {
    // Extract token from cookie
    const token = req.cookies.portalAccessToken;

    if (!token) {
      return res.status(401).json({ error: 'Nicht authentifiziert' });
    }

    // Verify token
    const decoded = jwt.verify(
      token,
      process.env.PORTAL_JWT_SECRET
    );

    // Find user in StudentPortalUser table
    const portalUser = await StudentPortalUser.findById(decoded.id)
      .populate('studentId')
      .populate('familyMembers.studentId');

    if (!portalUser || !portalUser.isActive) {
      return res.status(401).json({ error: 'Benutzer nicht gefunden' });
    }

    // Prepare family members data
    const familyMembers = portalUser.familyMembers.map((member) => ({
      studentId: member.studentId?._id || null,
      relationship: member.relationship,
      name: member.name || (member.firstName && member.lastName
        ? `${member.firstName} ${member.lastName}`
        : member.studentId
          ? `${member.studentId.firstName} ${member.studentId.lastName}`
          : 'Unknown')
    }));

    // Prepare response object
    const response = {
      id: portalUser._id,
      email: portalUser.email,
      role: 'student',
      firstName: portalUser.firstName,
      lastName: portalUser.lastName,
      birthdate: portalUser.birthdate,
      sex: portalUser.sex || null,
      member: portalUser.member !== undefined ? portalUser.member : null,
      phone: portalUser.phone,
      familyMembers,
      preferences: portalUser.preferences,
      lastLogin: portalUser.lastLogin,
      emailVerified: portalUser.emailVerified,
      profileCompleted: portalUser.profileCompleted || false
    };

    // Add studentId and studentName only if Student record exists
    if (portalUser.studentId) {
      response.studentId = portalUser.studentId._id;
      response.studentName = `${portalUser.studentId.firstName} ${portalUser.studentId.lastName}`;
    }

    res.json(response);

  } catch (error) {
    logger.error('Get current user error', { error: error.message, stack: error.stack });
    res.status(401).json({ error: 'Ungültiger Token' });
  }
});

/**
 * @route   GET /api/portal/auth/socket-token
 * @desc    Issue a 2h token for Socket.io authentication
 *          Needed because httpOnly cookies can't be read by JS and SameSite=strict
 *          blocks the cookie on cross-origin socket connections (dev: port 3001 → 5000)
 * @access  Private (requires valid portalAccessToken cookie)
 */
router.get('/socket-token', verifyPortalAuth, async (req, res) => {
  try {
    const socketToken = jwt.sign(
      { id: req.user.id, role: req.user.role },
      process.env.PORTAL_JWT_SECRET,
      { expiresIn: '2h' }
    );
    res.json({ token: socketToken });
  } catch (error) {
    logger.error('Socket token error', { error: error.message });
    res.status(500).json({ error: 'Fehler beim Erstellen des Socket-Tokens' });
  }
});

/**
 * @route   POST /api/portal/auth/resend-verification
 * @desc    Resend email verification link for unverified portal users
 * @access  Public (rate limited)
 */
router.post('/resend-verification',
  resendVerificationLimiter,
  auditLogMiddleware({ action: 'ACCESS', resource: 'StudentPortalUser', metadata: { operation: 'resend_verification' } }),
  async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'E-Mail-Adresse erforderlich' });
    }

    const portalUser = await StudentPortalUser.findOne({ email: email.toLowerCase().trim() });

    // Always return success to prevent email enumeration
    if (!portalUser || portalUser.emailVerified) {
      return res.json({ message: 'Falls ein Konto mit dieser E-Mail existiert und noch nicht verifiziert ist, wurde eine neue Bestätigungs-E-Mail versendet.' });
    }

    // Generate new verification token
    const { token: verificationToken, expires } = generateVerificationTokenWithExpiry();
    const hashedToken = crypto.createHash('sha256').update(verificationToken).digest('hex');

    portalUser.verificationToken = hashedToken;
    portalUser.verificationTokenExpires = expires;
    await portalUser.save();

    const studentName = `${portalUser.firstName} ${portalUser.lastName}`;
    await sendVerificationEmail(portalUser.email, verificationToken, studentName);

    res.json({ message: 'Falls ein Konto mit dieser E-Mail existiert und noch nicht verifiziert ist, wurde eine neue Bestätigungs-E-Mail versendet.' });

  } catch (error) {
    logger.error('Resend verification error', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Senden der Bestätigungs-E-Mail' });
  }
});

/**
 * @route   GET /api/portal/auth/verify-email-change
 * @desc    Confirm pending email change via token link in email
 * @access  Public (token-based)
 */
router.get('/verify-email-change', tokenConsumptionLimiter, async (req, res) => {
  const portalUrl = process.env.PORTAL_URL || process.env.FRONTEND_URL || 'http://localhost:3001';
  try {
    const { token } = req.query;
    if (!token) {
      return res.redirect(`${portalUrl}/verify-email-change?error=missing-token`);
    }

    // Hash the incoming token before DB lookup — tokens are stored hashed (never raw)
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const portalUser = await StudentPortalUser.findOne({
      emailChangeToken: hashedToken,
      emailChangeTokenExpires: { $gt: new Date() }
    });

    if (!portalUser) {
      return res.redirect(`${portalUrl}/verify-email-change?error=invalid-or-expired`);
    }

    const newEmail = portalUser.pendingEmail;
    if (!newEmail) {
      return res.redirect(`${portalUrl}/verify-email-change?error=no-pending-email`);
    }

    // Check no one else grabbed the email in the meantime
    const conflict = await StudentPortalUser.findOne({ email: newEmail, _id: { $ne: portalUser._id } });
    if (conflict) {
      await StudentPortalUser.updateOne(
        { _id: portalUser._id },
        { $unset: { pendingEmail: 1, emailChangeToken: 1, emailChangeTokenExpires: 1 } }
      );
      return res.redirect(`${portalUrl}/verify-email-change?error=email-taken`);
    }

    const oldEmail = portalUser.email;

    // Activate new email
    await StudentPortalUser.updateOne(
      { _id: portalUser._id },
      {
        $set: { email: newEmail },
        $unset: { pendingEmail: 1, emailChangeToken: 1, emailChangeTokenExpires: 1 }
      }
    );

    // Also update linked Student record if exists
    if (portalUser.studentId) {
      try {
        await Student.updateOne({ _id: portalUser.studentId }, { $set: { email: newEmail } });
      } catch (studentErr) {
        logger.error('Failed to update Student email after email change confirmation', { error: studentErr.message });
        // Non-fatal — portal user email is the source of truth for login
      }
    }

    logger.info('Email change confirmed', { userId: portalUser._id, oldEmail, newEmail });
    return res.redirect(`${portalUrl}/verify-email-change?success=true`);

  } catch (error) {
    logger.error('Email change verification error', { error: error.message, stack: error.stack });
    const portalUrl = process.env.PORTAL_URL || process.env.FRONTEND_URL || 'http://localhost:3001';
    return res.redirect(`${portalUrl}/verify-email-change?error=server-error`);
  }
});

/**
 * @route   POST /api/portal/auth/cancel-email-change
 * @desc    Cancel a pending email change request
 * @access  Private (student)
 */
router.post('/cancel-email-change', verifyPortalAuth, async (req, res) => {
  try {
    const portalUser = await StudentPortalUser.findById(req.user.id);
    if (!portalUser) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
    if (!portalUser.pendingEmail) {
      return res.status(400).json({ error: 'Keine ausstehende E-Mail-Änderung' });
    }

    await StudentPortalUser.updateOne(
      { _id: portalUser._id },
      { $unset: { pendingEmail: 1, emailChangeToken: 1, emailChangeTokenExpires: 1 } }
    );

    logger.info('Email change cancelled', { userId: portalUser._id, cancelledEmail: portalUser.pendingEmail });
    res.json({ message: 'E-Mail-Änderung abgebrochen' });

  } catch (error) {
    logger.error('Cancel email change error', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler' });
  }
});

/**
 * @route   POST /api/portal/auth/change-password
 * @desc    Change password for logged-in portal user
 * @access  Private (student)
 */
router.post('/change-password',
  verifyPortalAuth,
  auditLogMiddleware({ action: 'UPDATE', resource: 'StudentPortalUser', metadata: { operation: 'change_password' } }),
  async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Aktuelles und neues Passwort erforderlich' });
      }

      // Validate new password: min 8 chars, 1 uppercase, 1 number, 1 special char
      const pwRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;
      if (!pwRegex.test(newPassword)) {
        return res.status(400).json({
          error: 'Passwort muss mindestens 8 Zeichen, einen Großbuchstaben, eine Zahl und ein Sonderzeichen enthalten'
        });
      }

      const portalUser = await StudentPortalUser.findById(req.user.id);
      if (!portalUser) {
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
      }

      const isMatch = await portalUser.comparePassword(currentPassword);
      if (!isMatch) {
        return res.status(400).json({ error: 'Aktuelles Passwort ist falsch' });
      }

      portalUser.password = newPassword;
      await portalUser.save();

      logger.info('Password changed', { userId: portalUser._id });
      res.json({ message: 'Passwort erfolgreich geändert' });

    } catch (error) {
      logger.error('Change password error', { error: error.message, stack: error.stack });
      res.status(500).json({ error: 'Serverfehler' });
    }
  }
);

/**
 * @route   PUT /api/portal/auth/preferences
 * @desc    Update email notification preference
 * @access  Private (student)
 */
router.put('/preferences', verifyPortalAuth, async (req, res) => {
  try {
    const { emailNotifications } = req.body;

    if (typeof emailNotifications !== 'boolean') {
      return res.status(400).json({ error: 'emailNotifications muss ein Boolean sein' });
    }

    const portalUser = await StudentPortalUser.findByIdAndUpdate(
      req.user.id,
      { 'preferences.emailNotifications': emailNotifications },
      { new: true }
    );

    if (!portalUser) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    res.json({ preferences: portalUser.preferences });

  } catch (error) {
    logger.error('Update preferences error', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler' });
  }
});

/**
 * @route   POST /api/portal/auth/request-account-deletion
 * @desc    Submit GDPR Art. 17 account deletion request via support ticket
 * @access  Private (student, rate limited)
 */
router.post('/request-account-deletion', verifyPortalAuth, authLimiter, async (req, res) => {
  try {
    const portalUser = await StudentPortalUser.findById(req.user.id);
    if (!portalUser) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    const name = [portalUser.firstName, portalUser.lastName].filter(Boolean).join(' ') || portalUser.email;
    const ticket = new SupportTicket({
      subject: 'Kontolöschung angefragt (DSGVO Art. 17)',
      category: 'other',
      priority: 'medium',
      status: 'open',
      createdBy: {
        studentPortalUserId: portalUser._id,
        email: portalUser.email,
        name
      },
      messages: [{
        senderType: 'student',
        senderId: portalUser._id,
        senderName: name,
        content: `Der Nutzer hat die Löschung seines Kontos gemäß DSGVO Art. 17 angefragt.\n\nKonto-ID: ${portalUser._id}\nE-Mail: ${portalUser.email}\nName: ${name}`
      }],
      lastMessageAt: new Date(),
      lastMessageFrom: 'student',
      unreadByAdmin: 1
    });

    await ticket.save();

    logger.info('Account deletion requested', { userId: portalUser._id, ticketId: ticket._id });
    res.json({ message: 'Löschanfrage eingereicht. Wir werden uns innerhalb von 30 Tagen bei dir melden.' });

  } catch (error) {
    logger.error('Request account deletion error', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler' });
  }
});

export default router;
