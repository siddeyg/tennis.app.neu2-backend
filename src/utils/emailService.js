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

// Check if SMTP is configured
const isConfigured =
  process.env.SMTP_HOST &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS;

// Initialize Nodemailer transporter
let transporter = null;

if (isConfigured) {
  try {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
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
 */
async function sendEmail({ to, subject, html }) {
  // Development mode - log instead of sending
  if (!isConfigured || !transporter) {
    logger.info(`📧 [DEV MODE] Would send email to: ${to}`);
    logger.info(`   Subject: ${subject}`);
    logger.info(`   From: ${process.env.FROM_NAME || 'Mondo Tennisschule'} <${process.env.FROM_EMAIL || 'noreply@tcgw.de'}>`);
    logger.info(`   HTML content length: ${html.length} chars`);
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
      // Plain text fallback (auto-generated from HTML)
      text: html.replace(/<[^>]*>/g, ''), // Strip HTML tags for plain text
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`✅ Email sent successfully to: ${to}`);
    logger.info(`   Message ID: ${info.messageId}`);
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
        <h2 style="color: #333; margin-top: 0;">Hallo ${studentName},</h2>

        <p>Sie haben eine Passwort-Reset-Anfrage für Ihr Konto im Tennis-Portal gestellt.</p>

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
        <p style="margin: 5px 0;">Tennis-Schule Mondo Tennisschule</p>
        <p style="margin: 5px 0;">© ${new Date().getFullYear()} - Alle Rechte vorbehalten</p>
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
        <h2 style="color: #333; margin-top: 0;">Willkommen ${studentName}!</h2>

        <p>Vielen Dank für Ihre Registrierung beim Tennis-Portal des Mondo Tennisschule.</p>

        <p>Um Ihre E-Mail-Adresse zu bestätigen und Ihr Konto zu aktivieren, klicken Sie bitte auf den folgenden Button:</p>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${verifyUrl}" style="background: #4caf50; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px;">E-Mail bestätigen</a>
        </div>

        <p style="color: #666; font-size: 14px;">Oder kopieren Sie diesen Link in Ihren Browser:</p>
        <p style="background: #f5f5f5; padding: 12px; border-radius: 4px; word-break: break-all; font-size: 13px; border: 1px solid #e0e0e0;">${verifyUrl}</p>

        <div style="background: #e3f2fd; border-left: 4px solid #2196f3; padding: 12px; margin: 20px 0; border-radius: 4px;">
          <p style="margin: 0; color: #1565c0; font-weight: 600;">⏰ Dieser Link ist 24 Stunden gültig.</p>
        </div>

        <p style="color: #666; font-size: 14px; margin-top: 30px;">Nach der Bestätigung können Sie sich anmelden und sich für Trainingstermine registrieren.</p>

        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">

        <p style="color: #999; font-size: 12px; margin: 0;">Diese E-Mail wurde automatisch generiert. Bitte antworten Sie nicht auf diese Nachricht.</p>
      </div>

      <div style="text-align: center; margin-top: 20px; padding: 20px; color: #666; font-size: 12px;">
        <p style="margin: 5px 0;">Tennis-Schule Mondo Tennisschule</p>
        <p style="margin: 5px 0;">© ${new Date().getFullYear()} - Alle Rechte vorbehalten</p>
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
      <title>Willkommen beim Mondo Tennisschule</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">🎾 Mondo Tennisschule</h1>
      </div>

      <div style="background: white; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px;">
        <h2 style="color: #333; margin-top: 0;">Herzlich Willkommen ${studentName}!</h2>

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

        <p style="color: #666; font-size: 14px;">Wir freuen uns, Sie beim Mondo Tennisschule begrüßen zu dürfen!</p>

        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">

        <p style="color: #999; font-size: 12px; margin: 0;">Diese E-Mail wurde automatisch generiert. Bitte antworten Sie nicht auf diese Nachricht.</p>
      </div>

      <div style="text-align: center; margin-top: 20px; padding: 20px; color: #666; font-size: 12px;">
        <p style="margin: 5px 0;">Tennis-Schule Mondo Tennisschule</p>
        <p style="margin: 5px 0;">© ${new Date().getFullYear()} - Alle Rechte vorbehalten</p>
      </div>
    </body>
    </html>
  `;

  await sendEmail({
    to: email,
    subject: 'Willkommen beim Mondo Tennisschule Tennis-Portal',
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
        <p style="margin: 5px 0;">Tennis-Schule Mondo Tennisschule</p>
        <p style="margin: 5px 0;">© ${new Date().getFullYear()} - Alle Rechte vorbehalten</p>
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

export default {
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
  sendParentInfoChangeNotification,
  generateVerificationTokenWithExpiry,
  generatePasswordResetToken,
};
