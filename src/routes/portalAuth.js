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

    const { email, password, firstName, lastName, birthdate, sex, member, phone } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email und Passwort sind erforderlich' });
    }

    if (!firstName || !lastName || !birthdate) {
      return res.status(400).json({ error: 'Vorname, Nachname und Geburtsdatum sind erforderlich' });
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
      studentId: null,  // Will be linked when first seasonal registration is submitted
      verificationToken: hashedVerificationToken,
      verificationTokenExpires,
      emailVerified: false
    });

    await portalUser.save();

    // Send verification email (raw token goes in link, hash stored in DB)
    const studentName = `${firstName} ${lastName}`;
    await sendVerificationEmail(email, verificationToken, studentName);

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

    // Find user with valid token
    const portalUser = await StudentPortalUser.findOne({
      verificationToken: hashedToken,
      verificationTokenExpires: { $gt: Date.now() }
    });

    if (!portalUser) {
      return res.status(400).json({ error: 'Ungültiger oder abgelaufener Verifizierungs-Token' });
    }

    // Mark email as verified
    portalUser.emailVerified = true;
    portalUser.verificationToken = undefined;
    portalUser.verificationTokenExpires = undefined;
    await portalUser.save();

    // Send welcome email
    const studentName = `${portalUser.firstName} ${portalUser.lastName}`;
    await sendWelcomeEmail(portalUser.email, studentName);

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
      process.env.PORTAL_JWT_SECRET || process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );

    const refreshToken = jwt.sign(
      {
        id: portalUser._id,
        role: 'student'
      },
      process.env.PORTAL_REFRESH_TOKEN_SECRET || process.env.REFRESH_TOKEN_SECRET,
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
      process.env.PORTAL_REFRESH_TOKEN_SECRET || process.env.REFRESH_TOKEN_SECRET
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
      process.env.PORTAL_JWT_SECRET || process.env.JWT_SECRET,
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
      process.env.PORTAL_JWT_SECRET || process.env.JWT_SECRET
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

export default router;
