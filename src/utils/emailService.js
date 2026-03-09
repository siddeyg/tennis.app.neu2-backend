/**
 * Email Service - Nodemailer SMTP Implementation
 *
 * Handles sending emails for authentication flows (password reset, email verification, welcome).
 * Uses Nodemailer with your own SMTP server (VPS email hosting).
 *
 * Requirements:
 * - Install: npm install nodemailer
 * - Environment variables (add to .env.development and .env.production):
 *   - SMTP_HOST: Your mail server hostname (e.g., mail.yourdomain.de)
 *   - SMTP_PORT: SMTP port (587 for STARTTLS, 465 for SSL/TLS)
 *   - SMTP_SECURE: "true" for port 465, "false" for port 587
 *   - SMTP_USER: SMTP username (e.g., noreply@tcgw.de)
 *   - SMTP_PASS: SMTP password
 *   - FROM_EMAIL: Sender email address (e.g., noreply@tcgw.de)
 *   - FROM_NAME: Sender name (e.g., Mondo Tennisschule)
 *   - FRONTEND_URL: Frontend URL for links (e.g., https://mondo.suwar.de)
 *
 * Setup:
 * 1. Get SMTP credentials from your VPS email hosting
 * 2. Add credentials to .env files
 * 3. Test with: node test-email.js (see docs/EMAIL_SETUP_GUIDE.md)
 * 4. Check deliverability: mail-tester.com
 */

import crypto from 'crypto';
import nodemailer from 'nodemailer';
import logger from './logger.js';

/**
 * Escape HTML special characters to prevent injection in email templates
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Text formatting utilities for plain text emails
 * Ensures consistent formatting across all plain text templates
 */
const textFormatters = {
  // Format date in German locale (DD.MM.YYYY)
  date: (date) => {
    if (!date) return 'Keine Angabe';
    return new Date(date).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  },

  // Format boolean as Ja/Nein
  yesNo: (bool) => bool ? 'Ja' : 'Nein',

  // Format optional field with fallback
  optional: (value, fallback = 'Keine Angabe') => value || fallback,

  // Format available times for plain text
  availableTimes: (times) => {
    if (!times || times.length === 0) return 'Keine Angabe';
    const dayNames = {
      Mo: 'Montag', Di: 'Dienstag', Mi: 'Mittwoch',
      Do: 'Donnerstag', Fr: 'Freitag', Sa: 'Samstag', So: 'Sonntag'
    };
    return times.map(t => `  - ${dayNames[t.day] || t.day}: ${t.hour} Uhr`).join('\n');
  },

  // Create section divider with title
  sectionDivider: (title) => `\n${'='.repeat(50)}\n${title.toUpperCase()}\n${'='.repeat(50)}\n`,

  // Create subsection divider
  subSection: (title) => `\n${'-'.repeat(40)}\n${title}\n${'-'.repeat(40)}\n`,

  // Format field with label and value (aligned)
  field: (label, value, labelWidth = 20) => `${label.padEnd(labelWidth)}: ${value}`
};

// Check if SMTP is configured (never send real emails in test environment)
const isConfigured =
  process.env.NODE_ENV !== 'test' &&
  process.env.SMTP_HOST &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS;

// Initialize Nodemailer transporter
let transporter = null;

if (isConfigured) {
  try {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for 587
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      // Connection timeout and socket timeout
      connectionTimeout: 10000, // 10 seconds
      socketTimeout: 10000,
      // Enable logging in development
      logger: process.env.NODE_ENV === 'development',
      debug: process.env.NODE_ENV === 'development',
    });

    // Verify SMTP connection on startup
    transporter.verify((error, success) => {
      if (error) {
        logger.error('❌ SMTP connection failed:', error.message);
        logger.warn('   Emails will NOT be sent until SMTP is configured correctly');
      } else {
        logger.info('✅ SMTP email service initialized successfully');
        logger.info(`   SMTP Host: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT}`);
        logger.info(`   From: ${process.env.FROM_NAME} <${process.env.FROM_EMAIL}>`);
      }
    });
  } catch (error) {
    logger.error('❌ SMTP initialization failed:', error.message);
    transporter = null;
  }
} else {
  logger.warn('⚠️  SMTP not configured - emails will be logged to console (development mode OK)');
  logger.warn('   Required env vars: SMTP_HOST, SMTP_USER, SMTP_PASS, FROM_EMAIL, FROM_NAME, FRONTEND_URL');
}

/**
 * Send email using Nodemailer SMTP
 *
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML content
 * @param {string} [options.text] - Plain text content (optional, for multipart MIME)
 */
async function sendEmail({ to, subject, html, text = null }) {
  // Development mode - log instead of sending
  if (!isConfigured || !transporter) {
    logger.info(`📧 [DEV MODE] Would send email to: ${to}`);
    logger.info(`   Subject: ${subject}`);
    logger.info(`   From: ${process.env.FROM_NAME || 'Mondo Tennisschule'} <${process.env.FROM_EMAIL || 'noreply@tcgw.de'}>`);
    logger.info(`   HTML content length: ${html.length} chars`);
    if (text) {
      logger.info(`   Plain text content length: ${text.length} chars (multipart MIME)`);
    }
    return;
  }

  // Production mode - actually send email
  try {
    const mailOptions = {
      from: {
        name: process.env.FROM_NAME || 'Mondo Tennisschule',
        address: process.env.FROM_EMAIL || 'noreply@tcgw.de',
      },
      to,
      subject,
      html,
      // Include plain text only if explicitly provided (multipart MIME)
      ...(text && { text }),
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`✅ Email sent successfully to: ${to}`);
    logger.info(`   Message ID: ${info.messageId}`);
    if (text) {
      logger.info(`   Format: Multipart MIME (HTML + plain text)`);
    }
    return info;
  } catch (error) {
    logger.error(`❌ Error sending email to ${to}:`, error.message);
    throw new Error(`Failed to send email: ${error.message}`);
  }
}

/**
 * Send password reset email
 *
 * @param {string} email - Recipient email address
 * @param {string} resetToken - Password reset token
 * @param {string} studentName - Recipient name
 * @param {string} portalUrl - Optional portal URL (defaults to STUDENT_PORTAL_URL)
 */
export async function sendPasswordResetEmail(email, resetToken, studentName, portalUrl = null) {
  const baseUrl = portalUrl || process.env.STUDENT_PORTAL_URL || 'http://localhost:3001';
  const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

  const html = `
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Passwort zurücksetzen</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">🎾 Mondo Tennisschule</h1>
      </div>

      <div style="background: white; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px;">
        <h2 style="color: #333; margin-top: 0;">Hallo ${escapeHtml(studentName)},</h2>

        <p>Sie haben eine Passwort-Reset-Anfrage für Ihr Konto im Trainings-Portal gestellt.</p>

        <p>Klicken Sie auf den folgenden Button, um Ihr Passwort zurückzusetzen:</p>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background: #667eea; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px;">Passwort zurücksetzen</a>
        </div>

        <p style="color: #666; font-size: 14px;">Oder kopieren Sie diesen Link in Ihren Browser:</p>
        <p style="background: #f5f5f5; padding: 12px; border-radius: 4px; word-break: break-all; font-size: 13px; border: 1px solid #e0e0e0;">${resetUrl}</p>

        <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0; border-radius: 4px;">
          <p style="margin: 0; color: #856404; font-weight: 600;">⏰ Dieser Link ist 1 Stunde gültig.</p>
        </div>

        <p style="color: #666; font-size: 14px; margin-top: 30px;">Falls Sie diese Anfrage nicht gestellt haben, ignorieren Sie diese E-Mail. Ihr Passwort bleibt unverändert.</p>

        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">

        <p style="color: #999; font-size: 12px; margin: 0;">Diese E-Mail wurde automatisch generiert. Bitte antworten Sie nicht auf diese Nachricht.</p>
      </div>

      <div style="text-align: center; margin-top: 20px; padding: 20px; color: #666; font-size: 12px;">
        <p style="margin: 5px 0;">Mondo Tennisschule</p>
      </div>
    </body>
    </html>
  `;

  await sendEmail({
    to: email,
    subject: 'Passwort zurücksetzen - Mondo Tennisschule',
    html,
  });
}

/**
 * Send email verification email
 *
 * @param {string} email - Recipient email address
 * @param {string} verificationToken - Email verification token
 * @param {string} studentName - Recipient name
 * @param {string} portalUrl - Optional portal URL (defaults to STUDENT_PORTAL_URL)
 */
export async function sendVerificationEmail(email, verificationToken, studentName, portalUrl = null) {
  const baseUrl = portalUrl || process.env.STUDENT_PORTAL_URL || 'http://localhost:3001';
  const verifyUrl = `${baseUrl}/verify-email?token=${verificationToken}`;

  const html = `
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Email-Adresse bestätigen</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">🎾 Mondo Tennisschule</h1>
      </div>

      <div style="background: white; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px;">
        <h2 style="color: #333; margin-top: 0;">Willkommen ${escapeHtml(studentName)}!</h2>

        <p>Vielen Dank für Ihre Registrierung beim Trainings-Portal der Mondo Tennisschule.</p>

        <p>Um Ihre E-Mail-Adresse zu bestätigen und Ihr Konto zu aktivieren, klicken Sie bitte auf den folgenden Button:</p>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${verifyUrl}" style="background: #4caf50; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px;">E-Mail bestätigen</a>
        </div>

        <p style="color: #666; font-size: 14px;">Oder kopieren Sie diesen Link in Ihren Browser:</p>
        <p style="background: #f5f5f5; padding: 12px; border-radius: 4px; word-break: break-all; font-size: 13px; border: 1px solid #e0e0e0;">${verifyUrl}</p>

        <div style="background: #e3f2fd; border-left: 4px solid #2196f3; padding: 12px; margin: 20px 0; border-radius: 4px;">
          <p style="margin: 0; color: #1565c0; font-weight: 600;">⏰ Dieser Link ist 24 Stunden gültig.</p>
        </div>

        <p style="color: #666; font-size: 14px; margin-top: 30px;">Nach der Bestätigung können Sie sich für das Sommer-/Winter-Training und unsere Camps anmelden.</p>

        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">

        <p style="color: #999; font-size: 12px; margin: 0;">Diese E-Mail wurde automatisch generiert. Bitte antworten Sie nicht auf diese Nachricht.</p>
      </div>

      <div style="text-align: center; margin-top: 20px; padding: 20px; color: #666; font-size: 12px;">
        <p style="margin: 5px 0;">Mondo Tennisschule</p>
      </div>
    </body>
    </html>
  `;

  await sendEmail({
    to: email,
    subject: 'Email-Adresse bestätigen - Mondo Tennisschule',
    html,
  });
}

/**
 * Send welcome email (after successful email verification)
 *
 * @param {string} email - Recipient email address
 * @param {string} studentName - Recipient name
 */
export async function sendWelcomeEmail(email, studentName) {
  const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/login`;

  const html = `
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Willkommen bei der Mondo Tennisschule</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">🎾 Mondo Tennisschule</h1>
      </div>

      <div style="background: white; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px;">
        <h2 style="color: #333; margin-top: 0;">Herzlich Willkommen ${escapeHtml(studentName)}!</h2>

        <p>Ihre E-Mail-Adresse wurde erfolgreich bestätigt. Ihr Konto ist jetzt aktiv!</p>

        <p>Sie können sich jetzt anmelden und folgende Funktionen nutzen:</p>

        <ul style="color: #666; line-height: 2;">
          <li>📅 Trainingszeiten einsehen</li>
          <li>✍️ Für saisonale Trainingsprogramme anmelden</li>
          <li>👤 Profil verwalten</li>
          <li>📊 Trainingsstatistiken anzeigen</li>
        </ul>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${loginUrl}" style="background: #667eea; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px;">Jetzt anmelden</a>
        </div>

        <p style="color: #666; font-size: 14px; margin-top: 30px;">Bei Fragen oder Problemen wenden Sie sich bitte an unser Team.</p>

        <p style="color: #666; font-size: 14px;">Wir freuen uns, Sie bei der Mondo Tennisschule begrüßen zu dürfen!</p>

        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">

        <p style="color: #999; font-size: 12px; margin: 0;">Diese E-Mail wurde automatisch generiert. Bitte antworten Sie nicht auf diese Nachricht.</p>
      </div>

      <div style="text-align: center; margin-top: 20px; padding: 20px; color: #666; font-size: 12px;">
        <p style="margin: 5px 0;">Mondo Tennisschule</p>
      </div>
    </body>
    </html>
  `;

  await sendEmail({
    to: email,
    subject: 'Willkommen bei der Mondo Tennisschule',
    html,
  });
}

/**
 * Generate email verification token with expiry
 * Returns token (plain) and expires (timestamp)
 * Note: Token is stored directly in DB (not hashed) for portal users
 *
 * @returns {Object} { token: string, expires: Date }
 */
export function generateVerificationTokenWithExpiry() {
  // Generate cryptographically secure random token (32 bytes = 256 bits)
  const token = crypto.randomBytes(32).toString('hex');

  // Token expires in 24 hours
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  return { token, expires };
}

/**
 * Generate password reset token with expiry
 * Returns token (plain) and expires (timestamp)
 *
 * @returns {Object} { token: string, expires: Date }
 */
export function generatePasswordResetToken() {
  // Generate cryptographically secure random token (32 bytes = 256 bits)
  const token = crypto.randomBytes(32).toString('hex');

  // Token expires in 1 hour
  const expires = new Date(Date.now() + 60 * 60 * 1000);

  return { token, expires };
}

/**
 * Send admin notification about parent info changes (child users)
 *
 * @param {Object} options - Notification options
 * @param {string} options.childName - Name of the child
 * @param {string} options.childEmail - Email of the child account
 * @param {Object} options.oldValues - Old parent contact values
 * @param {Object} options.newValues - New parent contact values
 */
export async function sendParentInfoChangeNotification({ childName, childEmail, oldValues, newValues }) {
  const adminEmail = process.env.ADMIN_EMAIL || 'tennisapp-admin@diemachtderworte.de';

  const html = `
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Elterninformationen aktualisiert</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">🎾 Mondo Tennisschule</h1>
        <p style="color: white; margin: 10px 0 0 0; font-size: 14px; opacity: 0.9;">Admin Benachrichtigung</p>
      </div>

      <div style="background: white; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px;">
        <h2 style="color: #333; margin-top: 0;">Elterninformationen geändert</h2>

        <div style="background: #e3f2fd; border-left: 4px solid #2196f3; padding: 15px; margin: 20px 0; border-radius: 4px;">
          <p style="margin: 0; font-weight: 600; color: #1565c0;">Schüler (minderjährig):</p>
          <p style="margin: 5px 0 0 0; color: #333;">${childName}</p>
          <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">${childEmail}</p>
        </div>

        <h3 style="color: #666; font-size: 16px; margin-top: 25px;">Geänderte Elterndaten:</h3>

        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <thead>
            <tr style="background: #f5f5f5;">
              <th style="padding: 12px; text-align: left; border-bottom: 2px solid #e0e0e0; font-weight: 600;">Feld</th>
              <th style="padding: 12px; text-align: left; border-bottom: 2px solid #e0e0e0; font-weight: 600;">Alter Wert</th>
              <th style="padding: 12px; text-align: left; border-bottom: 2px solid #e0e0e0; font-weight: 600;">Neuer Wert</th>
            </tr>
          </thead>
          <tbody>
            ${oldValues.parentName !== newValues.parentName ? `
            <tr>
              <td style="padding: 12px; border-bottom: 1px solid #e0e0e0; font-weight: 500;">Name</td>
              <td style="padding: 12px; border-bottom: 1px solid #e0e0e0; color: #999;">${oldValues.parentName || '(leer)'}</td>
              <td style="padding: 12px; border-bottom: 1px solid #e0e0e0; color: #4caf50; font-weight: 600;">${newValues.parentName || '(leer)'}</td>
            </tr>
            ` : ''}
            ${oldValues.parentEmail !== newValues.parentEmail ? `
            <tr>
              <td style="padding: 12px; border-bottom: 1px solid #e0e0e0; font-weight: 500;">E-Mail</td>
              <td style="padding: 12px; border-bottom: 1px solid #e0e0e0; color: #999;">${oldValues.parentEmail || '(leer)'}</td>
              <td style="padding: 12px; border-bottom: 1px solid #e0e0e0; color: #4caf50; font-weight: 600;">${newValues.parentEmail || '(leer)'}</td>
            </tr>
            ` : ''}
            ${oldValues.parentPhone !== newValues.parentPhone ? `
            <tr>
              <td style="padding: 12px; border-bottom: 1px solid #e0e0e0; font-weight: 500;">Telefon</td>
              <td style="padding: 12px; border-bottom: 1px solid #e0e0e0; color: #999;">${oldValues.parentPhone || '(leer)'}</td>
              <td style="padding: 12px; border-bottom: 1px solid #e0e0e0; color: #4caf50; font-weight: 600;">${newValues.parentPhone || '(leer)'}</td>
            </tr>
            ` : ''}
          </tbody>
        </table>

        <p style="color: #666; font-size: 14px; margin-top: 25px;">Diese Änderungen wurden vom Schüler-Konto vorgenommen und dienen zu Ihrer Information.</p>

        <p style="color: #666; font-size: 14px;">Zeitstempel: ${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</p>

        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">

        <p style="color: #999; font-size: 12px; margin: 0;">Diese E-Mail wurde automatisch generiert. Bitte antworten Sie nicht auf diese Nachricht.</p>
      </div>

      <div style="text-align: center; margin-top: 20px; padding: 20px; color: #666; font-size: 12px;">
        <p style="margin: 5px 0;">Mondo Tennisschule</p>
      </div>
    </body>
    </html>
  `;

  await sendEmail({
    to: adminEmail,
    subject: `Elterninformationen geändert - ${childName}`,
    html,
  });
}

/**
 * Send new ticket notification to admin
 *
 * @param {Object} ticket - Support ticket document
 */
export async function sendNewTicketEmail(ticket) {
  const adminEmail = process.env.ADMIN_EMAIL || 'tennisapp-admin@diemachtderworte.de';
  const adminPortalUrl = process.env.ADMIN_PORTAL_URL || 'https://mondo2.suwar.de';

  const categoryLabels = {
    bug: 'Fehler',
    suggestion: 'Vorschlag',
    question: 'Frage',
    technical: 'Technisches Problem',
    other: 'Sonstiges'
  };

  const priorityLabels = {
    low: 'Niedrig',
    medium: 'Mittel',
    high: 'Hoch',
    urgent: 'Dringend'
  };

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Neues Support Ticket</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
      <div style="max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden;">
        <div style="background: linear-gradient(135deg, #009688 0%, #00796b 100%); padding: 30px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">🎫 Neues Support Ticket</h1>
        </div>

        <div style="padding: 30px;">
          <p style="color: #333; font-size: 16px; margin: 0 0 20px 0;">Ein neues Support Ticket wurde erstellt:</p>

          <div style="background-color: #f9f9f9; border-left: 4px solid #009688; padding: 15px; margin-bottom: 20px;">
            <h2 style="color: #009688; margin: 0 0 10px 0; font-size: 20px;">Ticket #${ticket.ticketNumber}</h2>
            <p style="color: #333; font-size: 16px; margin: 0; font-weight: 600;">${escapeHtml(ticket.subject)}</p>
          </div>

          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tbody>
              <tr>
                <td style="padding: 10px 0; font-weight: 500; color: #666; width: 30%;">Von:</td>
                <td style="padding: 10px 0; color: #333;">${escapeHtml(ticket.createdBy.name)}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; font-weight: 500; color: #666;">E-Mail:</td>
                <td style="padding: 10px 0; color: #333;">${escapeHtml(ticket.createdBy.email)}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; font-weight: 500; color: #666;">Kategorie:</td>
                <td style="padding: 10px 0; color: #333;">${escapeHtml(categoryLabels[ticket.category] || ticket.category)}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; font-weight: 500; color: #666;">Priorität:</td>
                <td style="padding: 10px 0; color: #333;">${escapeHtml(priorityLabels[ticket.priority] || ticket.priority)}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; font-weight: 500; color: #666;">Status:</td>
                <td style="padding: 10px 0; color: #333;">Offen</td>
              </tr>
            </tbody>
          </table>

          <div style="background-color: #fafafa; border-radius: 4px; padding: 15px; margin-bottom: 25px;">
            <h3 style="color: #009688; margin: 0 0 10px 0; font-size: 14px; text-transform: uppercase;">Nachricht:</h3>
            <p style="color: #333; font-size: 14px; margin: 0; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(ticket.messages[0].content)}</p>
          </div>

          <div style="text-align: center; margin-top: 30px;">
            <a href="${adminPortalUrl}/trainer/frontend?ticket=${ticket._id}" style="display: inline-block; background-color: #009688; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 4px; font-weight: 600; font-size: 16px;">Ticket anzeigen</a>
          </div>

          <p style="color: #666; font-size: 14px; margin-top: 25px;">Erstellt am: ${new Date(ticket.createdAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</p>
        </div>

        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 0 30px;">

        <div style="padding: 20px 30px;">
          <p style="color: #999; font-size: 12px; margin: 0;">Diese E-Mail wurde automatisch generiert. Bitte antworten Sie nicht auf diese Nachricht.</p>
        </div>
      </div>

      <div style="text-align: center; margin-top: 20px; padding: 20px; color: #666; font-size: 12px;">
        <p style="margin: 5px 0;">Mondo Tennisschule</p>
      </div>
    </body>
    </html>
  `;

  await sendEmail({
    to: adminEmail,
    subject: `[Support #${ticket.ticketNumber}] ${ticket.subject}`,
    html,
  });
}

/**
 * Send ticket reply notification
 *
 * @param {Object} ticket - Support ticket document
 * @param {Object} message - Message document
 * @param {string} recipientEmail - Recipient email address
 */
export async function sendTicketReplyEmail(ticket, message, recipientEmail) {
  const isAdminRecipient = message.senderType === 'student';
  const portalUrl = isAdminRecipient
    ? process.env.ADMIN_PORTAL_URL || 'https://mondo2.suwar.de'
    : process.env.STUDENT_PORTAL_URL || 'https://mondo-tennis.de';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Neue Antwort auf Support Ticket</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
      <div style="max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden;">
        <div style="background: linear-gradient(135deg, #009688 0%, #00796b 100%); padding: 30px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">💬 Neue Antwort</h1>
        </div>

        <div style="padding: 30px;">
          <p style="color: #333; font-size: 16px; margin: 0 0 20px 0;">Es gibt eine neue Antwort auf Ihr Support Ticket:</p>

          <div style="background-color: #f9f9f9; border-left: 4px solid #009688; padding: 15px; margin-bottom: 20px;">
            <h2 style="color: #009688; margin: 0 0 10px 0; font-size: 20px;">Ticket #${ticket.ticketNumber}</h2>
            <p style="color: #333; font-size: 16px; margin: 0; font-weight: 600;">${escapeHtml(ticket.subject)}</p>
          </div>

          <div style="background-color: #fafafa; border-radius: 4px; padding: 15px; margin-bottom: 25px;">
            <h3 style="color: #009688; margin: 0 0 10px 0; font-size: 14px; text-transform: uppercase;">Von ${escapeHtml(message.senderName)}:</h3>
            <p style="color: #333; font-size: 14px; margin: 0; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(message.content)}</p>
          </div>

          <div style="text-align: center; margin-top: 30px;">
            <a href="${portalUrl}/support-tickets/${ticket._id}" style="display: inline-block; background-color: #009688; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 4px; font-weight: 600; font-size: 16px;">Ticket anzeigen</a>
          </div>

          <p style="color: #666; font-size: 14px; margin-top: 25px;">Antwort gesendet am: ${new Date(message.createdAt || Date.now()).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</p>
        </div>

        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 0 30px;">

        <div style="padding: 20px 30px;">
          <p style="color: #999; font-size: 12px; margin: 0;">Diese E-Mail wurde automatisch generiert. Bitte antworten Sie nicht auf diese Nachricht.</p>
        </div>
      </div>

      <div style="text-align: center; margin-top: 20px; padding: 20px; color: #666; font-size: 12px;">
        <p style="margin: 5px 0;">Mondo Tennisschule</p>
      </div>
    </body>
    </html>
  `;

  await sendEmail({
    to: recipientEmail,
    subject: `Antwort auf Support Ticket #${ticket.ticketNumber}`,
    html,
  });
}

/**
 * Send ticket status change notification to student
 *
 * @param {Object} ticket - Support ticket document
 * @param {string} oldStatus - Previous status
 * @param {string} newStatus - New status
 * @param {string} recipientEmail - Student email
 */
export async function sendTicketStatusChangeEmail(ticket, oldStatus, newStatus, recipientEmail) {
  const portalUrl = process.env.STUDENT_PORTAL_URL || 'https://mondo-tennis.de';

  const statusLabels = {
    open: 'Offen',
    'in-progress': 'In Bearbeitung',
    'waiting-customer': 'Warten auf Rückmeldung',
    resolved: 'Gelöst',
    closed: 'Geschlossen'
  };

  const statusColors = {
    open: '#ff9800',
    'in-progress': '#2196f3',
    'waiting-customer': '#9c27b0',
    resolved: '#4caf50',
    closed: '#757575'
  };

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Support Ticket Status Aktualisiert</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
      <div style="max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden;">
        <div style="background: linear-gradient(135deg, #009688 0%, #00796b 100%); padding: 30px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">📋 Status Aktualisiert</h1>
        </div>

        <div style="padding: 30px;">
          <p style="color: #333; font-size: 16px; margin: 0 0 20px 0;">Der Status Ihres Support Tickets wurde aktualisiert:</p>

          <div style="background-color: #f9f9f9; border-left: 4px solid #009688; padding: 15px; margin-bottom: 20px;">
            <h2 style="color: #009688; margin: 0 0 10px 0; font-size: 20px;">Ticket #${ticket.ticketNumber}</h2>
            <p style="color: #333; font-size: 16px; margin: 0; font-weight: 600;">${escapeHtml(ticket.subject)}</p>
          </div>

          <div style="background-color: #fafafa; border-radius: 4px; padding: 20px; margin-bottom: 25px; text-align: center;">
            <div style="display: inline-block; margin: 0 15px;">
              <div style="color: #666; font-size: 12px; text-transform: uppercase; margin-bottom: 8px;">Vorher</div>
              <div style="background-color: ${statusColors[oldStatus]}; color: #ffffff; padding: 8px 16px; border-radius: 20px; font-weight: 600; font-size: 14px;">${statusLabels[oldStatus]}</div>
            </div>
            <div style="display: inline-block; color: #999; font-size: 24px; margin: 0 10px;">→</div>
            <div style="display: inline-block; margin: 0 15px;">
              <div style="color: #666; font-size: 12px; text-transform: uppercase; margin-bottom: 8px;">Jetzt</div>
              <div style="background-color: ${statusColors[newStatus]}; color: #ffffff; padding: 8px 16px; border-radius: 20px; font-weight: 600; font-size: 14px;">${statusLabels[newStatus]}</div>
            </div>
          </div>

          ${newStatus === 'resolved' ? `
          <div style="background-color: #e8f5e9; border-left: 4px solid #4caf50; padding: 15px; margin-bottom: 20px;">
            <p style="color: #2e7d32; font-size: 14px; margin: 0;">✅ Ihr Ticket wurde als gelöst markiert. Wenn Ihr Problem behoben ist, können Sie das Ticket schließen. Andernfalls antworten Sie einfach, um das Ticket wieder zu öffnen.</p>
          </div>
          ` : ''}

          ${newStatus === 'waiting-customer' ? `
          <div style="background-color: #f3e5f5; border-left: 4px solid #9c27b0; padding: 15px; margin-bottom: 20px;">
            <p style="color: #6a1b9a; font-size: 14px; margin: 0;">💬 Wir warten auf Ihre Rückmeldung. Bitte antworten Sie auf das Ticket, wenn Sie weitere Informationen haben.</p>
          </div>
          ` : ''}

          <div style="text-align: center; margin-top: 30px;">
            <a href="${portalUrl}/support-tickets/${ticket._id}" style="display: inline-block; background-color: #009688; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 4px; font-weight: 600; font-size: 16px;">Ticket anzeigen</a>
          </div>

          <p style="color: #666; font-size: 14px; margin-top: 25px;">Aktualisiert am: ${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</p>
        </div>

        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 0 30px;">

        <div style="padding: 20px 30px;">
          <p style="color: #999; font-size: 12px; margin: 0;">Diese E-Mail wurde automatisch generiert. Bitte antworten Sie nicht auf diese Nachricht.</p>
        </div>
      </div>

      <div style="text-align: center; margin-top: 20px; padding: 20px; color: #666; font-size: 12px;">
        <p style="margin: 5px 0;">Mondo Tennisschule</p>
      </div>
    </body>
    </html>
  `;

  await sendEmail({
    to: recipientEmail,
    subject: `Support Ticket #${ticket.ticketNumber} - Status: ${statusLabels[newStatus]}`,
    html,
  });
}

/**
 * Generate plain text content for seasonal registration notification
 * Mirrors HTML email content but formatted for text-only clients
 *
 * @param {Object} registration - Registration data
 * @returns {string} Plain text email content
 */
function generateSeasonalRegistrationTextContent(registration) {
  const { date, yesNo, optional, availableTimes, sectionDivider, subSection, field } = textFormatters;

  let text = sectionDivider('NEUE SAISONREGISTRIERUNG');
  text += 'Mondo Tennisschule\n\n';
  text += field('Eingang', date(registration.createdAt || new Date())) + '\n';

  // Personal data section
  text += subSection('PERSÖNLICHE DATEN');
  text += field('Name', `${registration.firstName} ${registration.lastName}`) + '\n';
  text += field('E-Mail', registration.email) + '\n';
  text += field('Telefon', optional(registration.phone)) + '\n';
  text += field('Geburtsdatum', date(registration.birthdate)) + '\n';
  text += field('Geschlecht', optional(registration.sex)) + '\n';
  text += field('Adresse', optional(registration.address)) + '\n';
  text += field('Mitglied', yesNo(registration.member)) + '\n';

  // Registration details section
  text += subSection('REGISTRIERUNGSDETAILS');
  text += field('Saison', optional(registration.periodId?.name, 'Unbekannt')) + '\n';
  text += field('Erwachsener', registration.adult ? 'Ja' : 'Nein (Kind)') + '\n';

  if (!registration.adult) {
    text += field('Trainingsgruppe', optional(registration.trainigGroup)) + '\n';
  } else {
    text += field('Spielstärke', optional(registration.skillLevel)) + '\n';
  }

  text += field('Häufigkeit', registration.frequence ? `${registration.frequence}x pro Woche` : 'Keine Angabe') + '\n';
  text += '\nVerfügbare Zeiten:\n' + availableTimes(registration.availableTimes) + '\n';

  // Payment info (if provided)
  if (registration.iban) {
    text += subSection('ZAHLUNGSINFORMATIONEN');
    text += field('IBAN', 'Bereitgestellt (vorhanden)') + '\n';
  }

  // Parent info (if provided)
  if (registration.parentEmail) {
    text += subSection('ELTERNINFORMATIONEN');
    text += field('Eltern-E-Mail', registration.parentEmail) + '\n';
    text += field('Eltern-Telefon', optional(registration.parentPhone)) + '\n';
  }

  // Notes
  text += subSection('BEMERKUNGEN');
  text += optional(registration.notes, 'Keine Bemerkungen') + '\n';

  // Footer
  text += '\n' + '='.repeat(50) + '\n';
  text += 'Diese E-Mail wurde automatisch generiert.\n';
  text += 'Mondo Tennisschule - Kesselsfeldweg 7B - 53343 Wachtberg\n';

  return text;
}

/**
 * Send notification email to admins for new seasonal registration
 * @param {Object} registration - Registration data
 * @param {Array} notificationEmails - Array of email addresses to notify
 */
export async function sendSeasonalRegistrationNotification(registration, notificationEmails) {
  if (!notificationEmails || notificationEmails.length === 0) {
    return; // No emails to send to
  }

  const subject = `Neue Saisonregistrierung: ${registration.firstName} ${registration.lastName}`;

  // Format available times
  const formatAvailableTimes = (times) => {
    if (!times || times.length === 0) return 'Keine Angabe';
    const dayNames = {
      Mo: 'Montag', Di: 'Dienstag', Mi: 'Mittwoch',
      Do: 'Donnerstag', Fr: 'Freitag', Sa: 'Samstag', So: 'Sonntag'
    };
    return times.map(t => `${dayNames[t.day] || t.day}: ${t.hour} Uhr`).join('<br>');
  };

  // Format date
  const formatDate = (date) => {
    if (!date) return 'Keine Angabe';
    return new Date(date).toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  };

  const html = `
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #00838f 0%, #00acc1 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px; }
        .section { margin-bottom: 25px; }
        .section h2 { color: #00838f; font-size: 18px; margin-bottom: 15px; border-bottom: 2px solid #00838f; padding-bottom: 5px; }
        .field { margin-bottom: 12px; }
        .field-label { font-weight: bold; color: #555; min-width: 150px; display: inline-block; }
        .field-value { color: #333; }
        .highlight { background-color: #e0f7fa; padding: 15px; border-left: 4px solid #00acc1; margin: 15px 0; border-radius: 4px; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>🎾 Neue Saisonregistrierung</h1>
        <p style="margin: 10px 0 0 0; font-size: 14px;">Mondo Tennisschule</p>
      </div>

      <div class="content">
        <div class="highlight">
          <strong>Eingang:</strong> ${formatDate(registration.createdAt || new Date())}
        </div>

        <div class="section">
          <h2>Persönliche Daten</h2>
          <div class="field">
            <span class="field-label">Name:</span>
            <span class="field-value">${registration.firstName} ${registration.lastName}</span>
          </div>
          <div class="field">
            <span class="field-label">E-Mail:</span>
            <span class="field-value">${registration.email}</span>
          </div>
          <div class="field">
            <span class="field-label">Telefon:</span>
            <span class="field-value">${registration.phone || 'Keine Angabe'}</span>
          </div>
          <div class="field">
            <span class="field-label">Geburtsdatum:</span>
            <span class="field-value">${formatDate(registration.birthdate)}</span>
          </div>
          <div class="field">
            <span class="field-label">Geschlecht:</span>
            <span class="field-value">${registration.sex || 'Keine Angabe'}</span>
          </div>
          <div class="field">
            <span class="field-label">Adresse:</span>
            <span class="field-value">${registration.address || 'Keine Angabe'}</span>
          </div>
          <div class="field">
            <span class="field-label">Mitglied:</span>
            <span class="field-value">${registration.member ? 'Ja' : 'Nein'}</span>
          </div>
        </div>

        <div class="section">
          <h2>Registrierungsdetails</h2>
          <div class="field">
            <span class="field-label">Saison:</span>
            <span class="field-value">${registration.periodId?.name || 'Unbekannt'}</span>
          </div>
          <div class="field">
            <span class="field-label">Erwachsener:</span>
            <span class="field-value">${registration.adult ? 'Ja' : 'Nein (Kind)'}</span>
          </div>
          ${!registration.adult ? `
          <div class="field">
            <span class="field-label">Trainingsgruppe:</span>
            <span class="field-value">${registration.trainigGroup || 'Keine Angabe'}</span>
          </div>
          ` : `
          <div class="field">
            <span class="field-label">Spielstärke:</span>
            <span class="field-value">${registration.skillLevel || 'Keine Angabe'}</span>
          </div>
          `}
          <div class="field">
            <span class="field-label">Häufigkeit:</span>
            <span class="field-value">${registration.frequence ? `${registration.frequence}x pro Woche` : 'Keine Angabe'}</span>
          </div>
          <div class="field">
            <span class="field-label">Verfügbare Zeiten:</span>
            <div style="margin-left: 150px; margin-top: 8px;">${formatAvailableTimes(registration.availableTimes)}</div>
          </div>
        </div>

        ${registration.iban ? `
        <div class="section">
          <h2>Zahlungsinformationen</h2>
          <div class="field">
            <span class="field-label">IBAN:</span>
            <span class="field-value">Bereitgestellt ✓</span>
          </div>
        </div>
        ` : ''}

        ${registration.parentEmail ? `
        <div class="section">
          <h2>Elterninformationen</h2>
          <div class="field">
            <span class="field-label">Eltern-E-Mail:</span>
            <span class="field-value">${registration.parentEmail}</span>
          </div>
          <div class="field">
            <span class="field-label">Eltern-Telefon:</span>
            <span class="field-value">${registration.parentPhone || 'Keine Angabe'}</span>
          </div>
        </div>
        ` : ''}

        <div class="section">
          <h2>Bemerkungen</h2>
          <div class="field">
            <span class="field-value">${registration.notes || 'Keine Bemerkungen'}</span>
          </div>
        </div>
      </div>

      <div class="footer">
        <p>Diese E-Mail wurde automatisch generiert von der Mondo Tennisschule Plattform.</p>
        <p>Mondo Tennisschule • Kesselsfeldweg 7B • 53343 Wachtberg</p>
      </div>
    </body>
    </html>
  `;

  // Generate plain text version
  const text = generateSeasonalRegistrationTextContent(registration);

  // Send to all notification emails
  for (const email of notificationEmails) {
    try {
      await sendEmail({ to: email, subject, html, text });
    } catch (error) {
      logger.error(`Failed to send seasonal registration notification to ${email}:`, error);
      // Continue with other emails even if one fails
    }
  }
}

/**
 * Generate plain text content for camp registration notification
 * Mirrors HTML email content but formatted for text-only clients
 *
 * @param {Object} registration - Camp registration data
 * @param {Object} camp - Camp details
 * @returns {string} Plain text email content
 */
function generateCampRegistrationTextContent(registration, camp) {
  const { date, optional, sectionDivider, subSection, field } = textFormatters;

  let text = sectionDivider('NEUE CAMP-ANMELDUNG');
  text += 'Mondo Tennisschule\n\n';
  text += field('Eingang', date(registration.createdAt || new Date())) + '\n';

  // Camp details section
  text += subSection('CAMP-DETAILS');
  text += field('Camp-Name', camp.title) + '\n';
  text += field('Zeitraum', `${date(camp.startDate)} - ${date(camp.endDate)}`) + '\n';
  text += field('Ort', optional(camp.location)) + '\n';
  text += field('Preis', camp.price ? `${camp.price}€` : 'Keine Angabe') + '\n';

  // Participant data section
  text += subSection('TEILNEHMER-DATEN');
  text += field('Name', `${registration.firstName} ${registration.lastName}`) + '\n';
  text += field('E-Mail', registration.email) + '\n';
  text += field('Telefon', optional(registration.phone)) + '\n';
  text += field('Geburtsdatum', date(registration.birthdate)) + '\n';
  text += field('Spielstärke', optional(registration.skillLevel)) + '\n';
  text += field('Mannschaft', registration.team ? 'Mannschaftsspieler' : 'Hobbyspieler') + '\n';

  // Emergency contact (if provided)
  if (registration.emergencyContact) {
    text += subSection('NOTFALLKONTAKT');
    text += field('Name', optional(registration.emergencyContact.name)) + '\n';
    text += field('Beziehung', optional(registration.emergencyContact.relationship)) + '\n';
    text += field('Telefon', optional(registration.emergencyContact.phone)) + '\n';
  }

  // Additional emergency contact (if provided)
  if (registration.additionalEmergencyContact) {
    text += subSection('ZUSÄTZLICHER NOTFALLKONTAKT');
    text += field('Name', optional(registration.additionalEmergencyContact.name)) + '\n';
    text += field('Beziehung', optional(registration.additionalEmergencyContact.relationship)) + '\n';
    text += field('Telefon', optional(registration.additionalEmergencyContact.phone)) + '\n';
  }

  // Status section
  text += subSection('STATUS');
  let statusText = registration.status === 'confirmed' ? 'Bestätigt' :
                   registration.status === 'waitlist' ? 'Warteliste' :
                   'Angemeldet';
  text += field('Registrierungsstatus', statusText) + '\n';

  // Notes (if provided)
  if (registration.notes) {
    text += subSection('BEMERKUNGEN');
    text += registration.notes + '\n';
  }

  // Footer
  text += '\n' + '='.repeat(50) + '\n';
  text += 'Diese E-Mail wurde automatisch generiert.\n';
  text += 'Mondo Tennisschule - Kesselsfeldweg 7B - 53343 Wachtberg\n';

  return text;
}

/**
 * Send notification email to admins for new camp registration
 * @param {Object} registration - Camp registration data
 * @param {Object} camp - Camp details
 * @param {Array} notificationEmails - Array of email addresses to notify
 */
export async function sendCampRegistrationNotification(registration, camp, notificationEmails) {
  if (!notificationEmails || notificationEmails.length === 0) {
    return; // No emails to send to
  }

  const subject = `Neue Camp-Anmeldung: ${camp.title} - ${registration.firstName} ${registration.lastName}`;

  // Format date
  const formatDate = (date) => {
    if (!date) return 'Keine Angabe';
    return new Date(date).toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  };

  const html = `
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #00838f 0%, #00acc1 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px; }
        .section { margin-bottom: 25px; }
        .section h2 { color: #00838f; font-size: 18px; margin-bottom: 15px; border-bottom: 2px solid #00838f; padding-bottom: 5px; }
        .field { margin-bottom: 12px; }
        .field-label { font-weight: bold; color: #555; min-width: 150px; display: inline-block; }
        .field-value { color: #333; }
        .highlight { background-color: #e0f7fa; padding: 15px; border-left: 4px solid #00acc1; margin: 15px 0; border-radius: 4px; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        .camp-badge { display: inline-block; background: #00acc1; color: white; padding: 5px 15px; border-radius: 20px; font-size: 14px; margin: 10px 0; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>⛺ Neue Camp-Anmeldung</h1>
        <p style="margin: 10px 0 0 0; font-size: 14px;">Mondo Tennisschule</p>
      </div>

      <div class="content">
        <div class="highlight">
          <strong>Eingang:</strong> ${formatDate(registration.createdAt || new Date())}<br>
          <strong>Camp:</strong> <span class="camp-badge">${camp.title}</span>
        </div>

        <div class="section">
          <h2>Camp-Details</h2>
          <div class="field">
            <span class="field-label">Camp-Name:</span>
            <span class="field-value">${camp.title}</span>
          </div>
          <div class="field">
            <span class="field-label">Zeitraum:</span>
            <span class="field-value">${formatDate(camp.startDate)} - ${formatDate(camp.endDate)}</span>
          </div>
          <div class="field">
            <span class="field-label">Ort:</span>
            <span class="field-value">${camp.location || 'Keine Angabe'}</span>
          </div>
          <div class="field">
            <span class="field-label">Preis:</span>
            <span class="field-value">${camp.price ? `${camp.price}€` : 'Keine Angabe'}</span>
          </div>
        </div>

        <div class="section">
          <h2>Teilnehmer-Daten</h2>
          <div class="field">
            <span class="field-label">Name:</span>
            <span class="field-value">${registration.firstName} ${registration.lastName}</span>
          </div>
          <div class="field">
            <span class="field-label">E-Mail:</span>
            <span class="field-value">${registration.email}</span>
          </div>
          <div class="field">
            <span class="field-label">Telefon:</span>
            <span class="field-value">${registration.phone || 'Keine Angabe'}</span>
          </div>
          <div class="field">
            <span class="field-label">Geburtsdatum:</span>
            <span class="field-value">${formatDate(registration.birthdate)}</span>
          </div>
          <div class="field">
            <span class="field-label">Geschlecht:</span>
            <span class="field-value">${registration.sex || 'Keine Angabe'}</span>
          </div>
          <div class="field">
            <span class="field-label">Mitglied:</span>
            <span class="field-value">${registration.member ? 'Ja' : 'Nein'}</span>
          </div>
          <div class="field">
            <span class="field-label">Spielstärke:</span>
            <span class="field-value">${registration.skillLevel || 'Keine Angabe'}</span>
          </div>
          <div class="field">
            <span class="field-label">Mannschaft:</span>
            <span class="field-value">${registration.team ? '⚽ Mannschaftsspieler' : '🎾 Hobbyspieler'}</span>
          </div>
        </div>

        ${registration.emergencyContact ? `
        <div class="section">
          <h2>Notfallkontakt</h2>
          <div class="field">
            <span class="field-label">Name:</span>
            <span class="field-value">${registration.emergencyContact.name || 'Keine Angabe'}</span>
          </div>
          <div class="field">
            <span class="field-label">Beziehung:</span>
            <span class="field-value">${registration.emergencyContact.relationship || 'Keine Angabe'}</span>
          </div>
          <div class="field">
            <span class="field-label">Telefon:</span>
            <span class="field-value">${registration.emergencyContact.phone || 'Keine Angabe'}</span>
          </div>
        </div>
        ` : ''}

        ${registration.additionalEmergencyContact ? `
        <div class="section">
          <h2>Zusätzlicher Notfallkontakt</h2>
          <div class="field">
            <span class="field-label">Name:</span>
            <span class="field-value">${registration.additionalEmergencyContact.name || 'Keine Angabe'}</span>
          </div>
          <div class="field">
            <span class="field-label">Beziehung:</span>
            <span class="field-value">${registration.additionalEmergencyContact.relationship || 'Keine Angabe'}</span>
          </div>
          <div class="field">
            <span class="field-label">Telefon:</span>
            <span class="field-value">${registration.additionalEmergencyContact.phone || 'Keine Angabe'}</span>
          </div>
        </div>
        ` : ''}

        <div class="section">
          <h2>Status</h2>
          <div class="field">
            <span class="field-label">Registrierungsstatus:</span>
            <span class="field-value">${registration.status === 'confirmed' ? '✓ Bestätigt' : registration.status === 'waitlist' ? '⏳ Warteliste' : '📝 Angemeldet'}</span>
          </div>
        </div>

        ${registration.notes ? `
        <div class="section">
          <h2>Bemerkungen</h2>
          <div class="field">
            <span class="field-value">${registration.notes}</span>
          </div>
        </div>
        ` : ''}
      </div>

      <div class="footer">
        <p>Diese E-Mail wurde automatisch generiert von der Mondo Tennisschule Plattform.</p>
        <p>Mondo Tennisschule • Kesselsfeldweg 7B • 53343 Wachtberg</p>
      </div>
    </body>
    </html>
  `;

  // Generate plain text version
  const text = generateCampRegistrationTextContent(registration, camp);

  // Send to all notification emails
  for (const email of notificationEmails) {
    try {
      await sendEmail({ to: email, subject, html, text });
    } catch (error) {
      logger.error(`Failed to send camp registration notification to ${email}:`, error);
      // Continue with other emails even if one fails
    }
  }
}

/**
 * Send camp registration confirmation email to the student
 */
export async function sendCampConfirmationEmail(registration, camp) {
  const subject = `Anmeldung bestätigt: ${camp.title}`;

  const formatDate = (date) => {
    if (!date) return 'Keine Angabe';
    return new Date(date).toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  };

  const html = `
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #2e7d32 0%, #43a047 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px; }
        .highlight { background-color: #e8f5e9; padding: 15px; border-left: 4px solid #43a047; margin: 15px 0; border-radius: 4px; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>✅ Anmeldung bestätigt</h1>
        <p style="margin: 10px 0 0 0; font-size: 14px;">Mondo Tennisschule</p>
      </div>
      <div class="content">
        <p>Hallo ${escapeHtml(registration.firstName)} ${escapeHtml(registration.lastName)},</p>
        <div class="highlight">
          <strong>Ihre Anmeldung für <em>${escapeHtml(camp.title)}</em> wurde bestätigt!</strong><br>
          Zeitraum: ${formatDate(camp.startDate)} – ${formatDate(camp.endDate)}
        </div>
        <p>Wir freuen uns, Sie beim Camp begrüßen zu dürfen. Bei Fragen wenden Sie sich gerne an uns.</p>
        <p>Viele Grüße,<br>Ihr Team von der Mondo Tennisschule</p>
      </div>
      <div class="footer">
        <p>Mondo Tennisschule</p>
      </div>
    </body>
    </html>
  `;

  const text = `Hallo ${registration.firstName} ${registration.lastName},\n\nIhre Anmeldung für "${camp.title}" (${formatDate(camp.startDate)} – ${formatDate(camp.endDate)}) wurde bestätigt!\n\nWir freuen uns, Sie beim Camp begrüßen zu dürfen.\n\nViele Grüße,\nIhr Team von der Mondo Tennisschule`;

  return sendEmail({ to: registration.email, subject, html, text });
}

/**
 * Send camp registration rejection email to the student
 */
export async function sendCampRejectionEmail(registration, camp, reason) {
  const subject = `Anmeldung abgelehnt: ${camp.title}`;

  const formatDate = (date) => {
    if (!date) return 'Keine Angabe';
    return new Date(date).toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  };

  const html = `
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #c62828 0%, #e53935 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px; }
        .highlight { background-color: #ffebee; padding: 15px; border-left: 4px solid #e53935; margin: 15px 0; border-radius: 4px; }
        .reason { background-color: #f5f5f5; padding: 12px; border-radius: 4px; margin: 10px 0; font-style: italic; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>❌ Anmeldung abgelehnt</h1>
        <p style="margin: 10px 0 0 0; font-size: 14px;">Mondo Tennisschule</p>
      </div>
      <div class="content">
        <p>Hallo ${escapeHtml(registration.firstName)} ${escapeHtml(registration.lastName)},</p>
        <div class="highlight">
          <strong>Ihre Anmeldung für <em>${escapeHtml(camp.title)}</em> konnte leider nicht bestätigt werden.</strong><br>
          Zeitraum: ${formatDate(camp.startDate)} – ${formatDate(camp.endDate)}
        </div>
        ${reason ? `<p><strong>Begründung:</strong></p><div class="reason">${escapeHtml(reason)}</div>` : ''}
        <p>Bei Fragen wenden Sie sich bitte an uns.</p>
        <p>Viele Grüße,<br>Ihr Team von der Mondo Tennisschule</p>
      </div>
      <div class="footer">
        <p>Mondo Tennisschule</p>
      </div>
    </body>
    </html>
  `;

  const reasonText = reason ? `\n\nBegründung: ${reason}` : '';
  const text = `Hallo ${registration.firstName} ${registration.lastName},\n\nIhre Anmeldung für "${camp.title}" (${formatDate(camp.startDate)} – ${formatDate(camp.endDate)}) konnte leider nicht bestätigt werden.${reasonText}\n\nBei Fragen wenden Sie sich bitte an uns.\n\nViele Grüße,\nIhr Team von der Mondo Tennisschule`;

  return sendEmail({ to: registration.email, subject, html, text });
}

/**
 * Send email change verification to the NEW email address
 */
export async function sendEmailChangeVerification(newEmail, token, studentName, portalUrl = null) {
  const url = portalUrl || process.env.PORTAL_URL || process.env.FRONTEND_URL || 'http://localhost:3001';
  const verifyUrl = `${url}/verify-email-change?token=${token}`;

  const subject = 'E-Mail-Adresse bestätigen – Mondo Tennisschule';
  const html = `
    <!DOCTYPE html><html><head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;font-family:'Segoe UI',sans-serif;background:#f5f5f5;">
      <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);overflow:hidden;">
        <div style="background:linear-gradient(135deg,#009688 0%,#00796b 100%);padding:30px;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:24px;">E-Mail-Adresse bestätigen</h1>
        </div>
        <div style="padding:30px;">
          <p style="color:#333;font-size:16px;">Hallo ${escapeHtml(studentName)},</p>
          <p style="color:#333;font-size:16px;">Du hast eine Änderung deiner E-Mail-Adresse beantragt. Klicke auf den Button, um die neue Adresse zu bestätigen:</p>
          <div style="text-align:center;margin:30px 0;">
            <a href="${verifyUrl}" style="display:inline-block;background:#009688;color:#fff;text-decoration:none;padding:14px 32px;border-radius:4px;font-weight:600;font-size:16px;">E-Mail-Adresse bestätigen</a>
          </div>
          <p style="color:#666;font-size:14px;">Dieser Link ist 24 Stunden gültig.</p>
          <p style="color:#666;font-size:14px;">Falls du keine Änderung beantragt hast, kannst du diese E-Mail ignorieren.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
          <p style="color:#999;font-size:12px;">Mondo Tennisschule</p>
        </div>
      </div>
    </body></html>`;

  const text = `Hallo ${studentName},\n\nDu hast eine Änderung deiner E-Mail-Adresse beantragt.\n\nBestätigungslink (gültig 24 Stunden):\n${verifyUrl}\n\nFalls du keine Änderung beantragt hast, ignoriere diese E-Mail.\n\nMondo Tennisschule`;

  return sendEmail({ to: newEmail, subject, html, text });
}

/**
 * Send warning to the OLD email address when an email change is requested
 */
export async function sendEmailChangeWarning(oldEmail, newEmail, studentName) {
  const subject = 'E-Mail-Änderung beantragt – Mondo Tennisschule';
  const html = `
    <!DOCTYPE html><html><head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;font-family:'Segoe UI',sans-serif;background:#f5f5f5;">
      <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);overflow:hidden;">
        <div style="background:linear-gradient(135deg,#ff9800 0%,#f57c00 100%);padding:30px;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:24px;">⚠️ E-Mail-Änderung beantragt</h1>
        </div>
        <div style="padding:30px;">
          <p style="color:#333;font-size:16px;">Hallo ${escapeHtml(studentName)},</p>
          <p style="color:#333;font-size:16px;">Für dein Konto wurde eine Änderung der E-Mail-Adresse beantragt:</p>
          <div style="background:#fff3e0;border-left:4px solid #ff9800;padding:15px;margin:20px 0;border-radius:4px;">
            <p style="margin:0;color:#333;"><strong>Neue E-Mail:</strong> ${escapeHtml(newEmail)}</p>
            <p style="margin:8px 0 0;color:#666;font-size:14px;">Die Änderung wird aktiv, sobald die neue Adresse bestätigt wurde.</p>
          </div>
          <p style="color:#333;font-size:16px;">Falls du diese Änderung <strong>nicht</strong> beantragt hast, melde dich bitte sofort bei uns.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
          <p style="color:#999;font-size:12px;">Mondo Tennisschule</p>
        </div>
      </div>
    </body></html>`;

  const text = `Hallo ${studentName},\n\nFür dein Konto wurde eine Änderung der E-Mail-Adresse beantragt.\nNeue E-Mail: ${newEmail}\n\nDie Änderung wird aktiv, sobald die neue Adresse bestätigt wurde.\n\nFalls du diese Änderung nicht beantragt hast, melde dich bitte sofort bei uns.\n\nMondo Tennisschule`;

  return sendEmail({ to: oldEmail, subject, html, text });
}

/**
 * Send camp registration received email to the student (pending — not yet confirmed)
 */
export async function sendCampRegistrationReceivedEmail(registration, camp) {
  const subject = `Anmeldung eingegangen: ${camp.title}`;

  const formatDate = (date) => {
    if (!date) return 'Keine Angabe';
    return new Date(date).toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  };

  const html = `
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px; }
        .highlight { background-color: #fffbeb; padding: 15px; border-left: 4px solid #f59e0b; margin: 15px 0; border-radius: 4px; }
        .notice { background-color: #f3f4f6; padding: 12px 15px; border-radius: 4px; margin: 15px 0; font-size: 14px; color: #555; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>⏳ Anmeldung eingegangen</h1>
        <p style="margin: 10px 0 0 0; font-size: 14px;">Mondo Tennisschule</p>
      </div>
      <div class="content">
        <p>Hallo ${escapeHtml(registration.firstName)} ${escapeHtml(registration.lastName)},</p>
        <div class="highlight">
          <strong>Ihre Anmeldung für <em>${escapeHtml(camp.title)}</em> ist eingegangen.</strong><br>
          Zeitraum: ${formatDate(camp.startDate)} – ${formatDate(camp.endDate)}
        </div>
        <div class="notice">
          <strong>Hinweis:</strong> Ihre Anmeldung ist noch nicht bestätigt. Sie wird von uns geprüft und Sie erhalten eine weitere E-Mail, sobald sie bestätigt oder abgelehnt wurde.
        </div>
        <p>Bei Fragen wenden Sie sich gerne an uns.</p>
        <p>Viele Grüße,<br>Ihr Team von der Mondo Tennisschule</p>
      </div>
      <div class="footer">
        <p>Mondo Tennisschule</p>
      </div>
    </body>
    </html>
  `;

  const text = `Hallo ${registration.firstName} ${registration.lastName},\n\nIhre Anmeldung für "${camp.title}" (${formatDate(camp.startDate)} – ${formatDate(camp.endDate)}) ist eingegangen.\n\nHinweis: Ihre Anmeldung ist noch nicht bestätigt. Sie wird von uns geprüft und Sie erhalten eine weitere E-Mail, sobald sie bestätigt oder abgelehnt wurde.\n\nBei Fragen wenden Sie sich gerne an uns.\n\nViele Grüße,\nIhr Team von der Mondo Tennisschule`;

  return sendEmail({ to: registration.email, subject, html, text });
}

/**
 * Send seasonal registration received email to the student (pending — not yet confirmed)
 */
export async function sendSeasonalRegistrationReceivedEmail(registration, period) {
  const subject = `Anmeldung eingegangen: ${period.name || 'Saisontraining'}`;

  const formatDate = (date) => {
    if (!date) return 'Keine Angabe';
    return new Date(date).toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  };

  const participantName = registration.childName
    ? registration.childName
    : `${registration.firstName} ${registration.lastName}`;

  const html = `
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px; }
        .highlight { background-color: #fffbeb; padding: 15px; border-left: 4px solid #f59e0b; margin: 15px 0; border-radius: 4px; }
        .notice { background-color: #f3f4f6; padding: 12px 15px; border-radius: 4px; margin: 15px 0; font-size: 14px; color: #555; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>⏳ Anmeldung eingegangen</h1>
        <p style="margin: 10px 0 0 0; font-size: 14px;">Mondo Tennisschule</p>
      </div>
      <div class="content">
        <p>Hallo ${escapeHtml(registration.firstName)} ${escapeHtml(registration.lastName)},</p>
        <div class="highlight">
          <strong>Die Anmeldung für <em>${escapeHtml(participantName)}</em> zum Saisontraining <em>${escapeHtml(period.name || 'Saisontraining')}</em> ist eingegangen.</strong><br>
          Zeitraum: ${formatDate(period.trainingStartDate)} – ${formatDate(period.trainingEndDate)}
        </div>
        <div class="notice">
          <strong>Hinweis:</strong> Die Anmeldung ist noch nicht bestätigt. Sie wird von uns geprüft und Sie erhalten eine weitere Benachrichtigung, sobald sie bearbeitet wurde.
        </div>
        <p>Bei Fragen wenden Sie sich gerne an uns.</p>
        <p>Viele Grüße,<br>Ihr Team von der Mondo Tennisschule</p>
      </div>
      <div class="footer">
        <p>Mondo Tennisschule</p>
      </div>
    </body>
    </html>
  `;

  const text = `Hallo ${registration.firstName} ${registration.lastName},\n\nDie Anmeldung für "${participantName}" zum Saisontraining "${period.name || 'Saisontraining'}" (${formatDate(period.trainingStartDate)} – ${formatDate(period.trainingEndDate)}) ist eingegangen.\n\nHinweis: Die Anmeldung ist noch nicht bestätigt. Sie wird von uns geprüft und Sie erhalten eine weitere Benachrichtigung, sobald sie bearbeitet wurde.\n\nBei Fragen wenden Sie sich gerne an uns.\n\nViele Grüße,\nIhr Team von der Mondo Tennisschule`;

  return sendEmail({ to: registration.email, subject, html, text });
}

/**
 * Send camp cancellation confirmation email to the student
 */
export async function sendCampCancellationEmail(registration, camp) {
  const subject = `Anmeldung storniert: ${camp.title}`;

  const formatDate = (date) => {
    if (!date) return 'Keine Angabe';
    return new Date(date).toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  };

  const html = `
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #6b7280 0%, #9ca3af 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px; }
        .highlight { background-color: #f3f4f6; padding: 15px; border-left: 4px solid #6b7280; margin: 15px 0; border-radius: 4px; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>❌ Anmeldung storniert</h1>
        <p style="margin: 10px 0 0 0; font-size: 14px;">Mondo Tennisschule</p>
      </div>
      <div class="content">
        <p>Hallo ${escapeHtml(registration.firstName)} ${escapeHtml(registration.lastName)},</p>
        <div class="highlight">
          <strong>Ihre Anmeldung für <em>${escapeHtml(camp.title)}</em> wurde erfolgreich storniert.</strong><br>
          Zeitraum: ${formatDate(camp.startDate)} – ${formatDate(camp.endDate)}
        </div>
        <p>Falls Sie sich erneut anmelden möchten, können Sie dies jederzeit über das Portal tun (sofern noch Plätze verfügbar sind).</p>
        <p>Bei Fragen wenden Sie sich gerne an uns.</p>
        <p>Viele Grüße,<br>Ihr Team von der Mondo Tennisschule</p>
      </div>
      <div class="footer">
        <p>Mondo Tennisschule</p>
      </div>
    </body>
    </html>
  `;

  const text = `Hallo ${registration.firstName} ${registration.lastName},\n\nIhre Anmeldung für "${camp.title}" (${formatDate(camp.startDate)} – ${formatDate(camp.endDate)}) wurde erfolgreich storniert.\n\nFalls Sie sich erneut anmelden möchten, können Sie dies jederzeit über das Portal tun (sofern noch Plätze verfügbar sind).\n\nBei Fragen wenden Sie sich gerne an uns.\n\nViele Grüße,\nIhr Team von der Mondo Tennisschule`;

  return sendEmail({ to: registration.email, subject, html, text });
}

/**
 * Send camp cancellation notification email to admin(s)
 */
export async function sendCampCancellationAdminEmail(registration, camp, notificationEmails) {
  if (!notificationEmails || notificationEmails.length === 0) return;

  const subject = `Stornierung Camp-Anmeldung: ${camp.title} - ${registration.firstName} ${registration.lastName}`;

  const formatDate = (date) => {
    if (!date) return 'Keine Angabe';
    return new Date(date).toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  };

  const html = `
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #6b7280 0%, #9ca3af 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px; }
        .section { margin-bottom: 25px; }
        .section h2 { color: #6b7280; font-size: 18px; margin-bottom: 15px; border-bottom: 2px solid #6b7280; padding-bottom: 5px; }
        .field { margin-bottom: 12px; }
        .field-label { font-weight: bold; color: #555; min-width: 150px; display: inline-block; }
        .field-value { color: #333; }
        .highlight { background-color: #f3f4f6; padding: 15px; border-left: 4px solid #6b7280; margin: 15px 0; border-radius: 4px; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>❌ Camp-Anmeldung storniert</h1>
        <p style="margin: 10px 0 0 0; font-size: 14px;">Mondo Tennisschule</p>
      </div>
      <div class="content">
        <div class="highlight">
          <strong>Storniert am:</strong> ${formatDate(new Date())}<br>
          <strong>Camp:</strong> ${escapeHtml(camp.title)}
        </div>
        <div class="section">
          <h2>Camp-Details</h2>
          <div class="field">
            <span class="field-label">Camp-Name:</span>
            <span class="field-value">${escapeHtml(camp.title)}</span>
          </div>
          <div class="field">
            <span class="field-label">Zeitraum:</span>
            <span class="field-value">${formatDate(camp.startDate)} – ${formatDate(camp.endDate)}</span>
          </div>
          <div class="field">
            <span class="field-label">Ort:</span>
            <span class="field-value">${escapeHtml(camp.location || 'Keine Angabe')}</span>
          </div>
        </div>
        <div class="section">
          <h2>Teilnehmer</h2>
          <div class="field">
            <span class="field-label">Name:</span>
            <span class="field-value">${escapeHtml(registration.firstName)} ${escapeHtml(registration.lastName)}</span>
          </div>
          <div class="field">
            <span class="field-label">E-Mail:</span>
            <span class="field-value">${escapeHtml(registration.email)}</span>
          </div>
          <div class="field">
            <span class="field-label">Telefon:</span>
            <span class="field-value">${escapeHtml(registration.phone || 'Keine Angabe')}</span>
          </div>
        </div>
      </div>
      <div class="footer">
        <p>Mondo Tennisschule</p>
      </div>
    </body>
    </html>
  `;

  const text = `Camp-Anmeldung storniert\n\nCamp: ${camp.title}\nZeitraum: ${formatDate(camp.startDate)} – ${formatDate(camp.endDate)}\n\nTeilnehmer: ${registration.firstName} ${registration.lastName}\nE-Mail: ${registration.email}\nTelefon: ${registration.phone || 'Keine Angabe'}\n\nStorniert am: ${formatDate(new Date())}`;

  return Promise.all(
    notificationEmails.map(email => sendEmail({ to: email, subject, html, text }))
  );
}

/**
 * Send seasonal registration cancellation confirmation email to the student
 */
export async function sendSeasonalCancellationEmail(registration, period) {
  const subject = `Anmeldung storniert: ${period.name || 'Saisontraining'}`;

  const formatDate = (date) => {
    if (!date) return 'Keine Angabe';
    return new Date(date).toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  };

  const participantName = registration.childName
    ? registration.childName
    : `${registration.firstName} ${registration.lastName}`;

  const html = `
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #6b7280 0%, #9ca3af 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px; }
        .highlight { background-color: #f3f4f6; padding: 15px; border-left: 4px solid #6b7280; margin: 15px 0; border-radius: 4px; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>❌ Anmeldung storniert</h1>
        <p style="margin: 10px 0 0 0; font-size: 14px;">Mondo Tennisschule</p>
      </div>
      <div class="content">
        <p>Hallo ${escapeHtml(registration.firstName)} ${escapeHtml(registration.lastName)},</p>
        <div class="highlight">
          <strong>Die Anmeldung für <em>${escapeHtml(participantName)}</em> zum Saisontraining <em>${escapeHtml(period.name || 'Saisontraining')}</em> wurde storniert.</strong><br>
          Zeitraum: ${formatDate(period.trainingStartDate)} – ${formatDate(period.trainingEndDate)}
        </div>
        <p>Bei Fragen wenden Sie sich gerne an uns.</p>
        <p>Viele Grüße,<br>Ihr Team von der Mondo Tennisschule</p>
      </div>
      <div class="footer">
        <p>Mondo Tennisschule</p>
      </div>
    </body>
    </html>
  `;

  const text = `Hallo ${registration.firstName} ${registration.lastName},\n\nDie Anmeldung für "${participantName}" zum Saisontraining "${period.name || 'Saisontraining'}" (${formatDate(period.trainingStartDate)} – ${formatDate(period.trainingEndDate)}) wurde storniert.\n\nBei Fragen wenden Sie sich gerne an uns.\n\nViele Grüße,\nIhr Team von der Mondo Tennisschule`;

  return sendEmail({ to: registration.email, subject, html, text });
}

/**
 * Send seasonal registration cancellation notification email to admin(s)
 */
export async function sendSeasonalCancellationAdminEmail(registration, period, notificationEmails, cancelledBy = 'user') {
  if (!notificationEmails || notificationEmails.length === 0) return;

  const cancelledByLabel = cancelledBy === 'admin' ? 'Administrator' : 'Nutzer/in';
  const subject = `Stornierung Saisontraining-Anmeldung: ${period.name || 'Saisontraining'} - ${registration.firstName} ${registration.lastName}`;

  const formatDate = (date) => {
    if (!date) return 'Keine Angabe';
    return new Date(date).toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  };

  const participantName = registration.childName
    ? registration.childName
    : `${registration.firstName} ${registration.lastName}`;

  const html = `
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #6b7280 0%, #9ca3af 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px; }
        .section { margin-bottom: 25px; }
        .section h2 { color: #6b7280; font-size: 18px; margin-bottom: 15px; border-bottom: 2px solid #6b7280; padding-bottom: 5px; }
        .field { margin-bottom: 12px; }
        .field-label { font-weight: bold; color: #555; min-width: 150px; display: inline-block; }
        .field-value { color: #333; }
        .highlight { background-color: #f3f4f6; padding: 15px; border-left: 4px solid #6b7280; margin: 15px 0; border-radius: 4px; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>❌ Saisontraining-Anmeldung storniert</h1>
        <p style="margin: 10px 0 0 0; font-size: 14px;">Mondo Tennisschule</p>
      </div>
      <div class="content">
        <div class="highlight">
          <strong>Storniert am:</strong> ${formatDate(new Date())}<br>
          <strong>Storniert durch:</strong> ${escapeHtml(cancelledByLabel)}<br>
          <strong>Saison:</strong> ${escapeHtml(period.name || 'Saisontraining')}
        </div>
        <div class="section">
          <h2>Trainingsperiode</h2>
          <div class="field">
            <span class="field-label">Bezeichnung:</span>
            <span class="field-value">${escapeHtml(period.name || 'Saisontraining')}</span>
          </div>
          <div class="field">
            <span class="field-label">Zeitraum:</span>
            <span class="field-value">${formatDate(period.trainingStartDate)} – ${formatDate(period.trainingEndDate)}</span>
          </div>
        </div>
        <div class="section">
          <h2>Teilnehmer</h2>
          <div class="field">
            <span class="field-label">Kontoinhaber/in:</span>
            <span class="field-value">${escapeHtml(registration.firstName)} ${escapeHtml(registration.lastName)}</span>
          </div>
          ${registration.childName ? `
          <div class="field">
            <span class="field-label">Teilnehmer/in:</span>
            <span class="field-value">${escapeHtml(registration.childName)}</span>
          </div>` : ''}
          <div class="field">
            <span class="field-label">E-Mail:</span>
            <span class="field-value">${escapeHtml(registration.email)}</span>
          </div>
          <div class="field">
            <span class="field-label">Telefon:</span>
            <span class="field-value">${escapeHtml(registration.phone || 'Keine Angabe')}</span>
          </div>
        </div>
      </div>
      <div class="footer">
        <p>Mondo Tennisschule</p>
      </div>
    </body>
    </html>
  `;

  const text = `Saisontraining-Anmeldung storniert\n\nSaison: ${period.name || 'Saisontraining'}\nZeitraum: ${formatDate(period.trainingStartDate)} – ${formatDate(period.trainingEndDate)}\nStorniert durch: ${cancelledByLabel}\n\nKontoinhaber/in: ${registration.firstName} ${registration.lastName}${registration.childName ? `\nTeilnehmer/in: ${registration.childName}` : ''}\nE-Mail: ${registration.email}\nTelefon: ${registration.phone || 'Keine Angabe'}\n\nStorniert am: ${formatDate(new Date())}`;

  return Promise.all(
    notificationEmails.map(email => sendEmail({ to: email, subject, html, text }))
  );
}

export default {
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
  sendParentInfoChangeNotification,
  sendNewTicketEmail,
  sendTicketReplyEmail,
  sendTicketStatusChangeEmail,
  sendSeasonalRegistrationNotification,
  sendCampRegistrationNotification,
  sendCampConfirmationEmail,
  sendCampRejectionEmail,
  sendCampRegistrationReceivedEmail,
  sendCampCancellationEmail,
  sendCampCancellationAdminEmail,
  sendSeasonalRegistrationReceivedEmail,
  sendSeasonalCancellationEmail,
  sendSeasonalCancellationAdminEmail,
  sendEmailChangeVerification,
  sendEmailChangeWarning,
  generateVerificationTokenWithExpiry,
  generatePasswordResetToken,
};
