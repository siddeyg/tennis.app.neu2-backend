/**
 * Portal Users Management Routes (Admin)
 *
 * Admin endpoints for managing StudentPortalUser accounts:
 * - List all portal users with verification status
 * - Delete portal user (with optional Student deletion)
 * - Reset verification status
 * - Force verify email
 */

import express from 'express';
import StudentPortalUser from '../models/StudentPortalUser.js';
import Student from '../models/Student.js';
import { generateVerificationTokenWithExpiry, sendVerificationEmail } from '../utils/emailService.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/portal-users
 * Get all portal users with details
 */
router.get('/', async (req, res) => {
  try {
    const portalUsers = await StudentPortalUser.find({})
      .select('-password') // Exclude password
      .populate('studentId', 'firstName lastName email')
      .sort({ createdAt: -1 });

    // Format response with computed fields
    const formattedUsers = portalUsers.map(user => ({
      _id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      birthdate: user.birthdate,
      phone: user.phone,
      emailVerified: user.emailVerified,
      verificationTokenExpires: user.verificationTokenExpires,
      studentId: user.studentId?._id,
      studentName: user.studentId ? `${user.studentId.firstName} ${user.studentId.lastName}` : null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      hasStudent: !!user.studentId,
      verificationExpired: user.verificationTokenExpires && user.verificationTokenExpires < new Date()
    }));

    res.json(formattedUsers);
  } catch (error) {
    logger.error("Error fetching portal users", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Fehler beim Laden der Portal-Benutzer' });
  }
});

/**
 * DELETE /api/portal-users/:id
 * Delete portal user account
 * Query param: deleteStudent=true to also delete linked Student
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { deleteStudent } = req.query;

    const portalUser = await StudentPortalUser.findById(id);
    if (!portalUser) {
      return res.status(404).json({ error: 'Portal-Benutzer nicht gefunden' });
    }

    const linkedStudentId = portalUser.studentId;

    // Delete portal user
    await StudentPortalUser.findByIdAndDelete(id);

    // Delete linked Student if requested
    if (deleteStudent === 'true' && linkedStudentId) {
      await Student.findByIdAndDelete(linkedStudentId);
      return res.json({
        message: 'Portal-Benutzer und zugehöriger Schüler gelöscht',
        deletedStudent: true
      });
    }

    res.json({
      message: 'Portal-Benutzer gelöscht',
      deletedStudent: false
    });
  } catch (error) {
    logger.error("Error deleting portal user", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Fehler beim Löschen des Portal-Benutzers' });
  }
});

/**
 * POST /api/portal-users/:id/reset-verification
 * Reset email verification status and generate new token
 */
router.post('/:id/reset-verification', async (req, res) => {
  try {
    const { id } = req.params;

    const portalUser = await StudentPortalUser.findById(id);
    if (!portalUser) {
      return res.status(404).json({ error: 'Portal-Benutzer nicht gefunden' });
    }

    // Generate new verification token
    const { token, expires } = generateVerificationTokenWithExpiry();

    portalUser.emailVerified = false;
    portalUser.verificationToken = token;
    portalUser.verificationTokenExpires = expires;
    await portalUser.save();

    res.json({
      message: 'Verifizierungsstatus zurückgesetzt',
      newToken: token,
      expires: expires
    });
  } catch (error) {
    logger.error("Error resetting verification", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Fehler beim Zurücksetzen der Verifizierung' });
  }
});

/**
 * POST /api/portal-users/:id/force-verify
 * Manually mark email as verified (skip verification process)
 */
router.post('/:id/force-verify', async (req, res) => {
  try {
    const { id } = req.params;

    const portalUser = await StudentPortalUser.findById(id);
    if (!portalUser) {
      return res.status(404).json({ error: 'Portal-Benutzer nicht gefunden' });
    }

    portalUser.emailVerified = true;
    portalUser.verificationToken = undefined;
    portalUser.verificationTokenExpires = undefined;
    await portalUser.save();

    res.json({
      message: 'Email als verifiziert markiert',
      emailVerified: true
    });
  } catch (error) {
    logger.error("Error force verifying email", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Fehler beim Verifizieren der Email' });
  }
});

/**
 * POST /api/portal-users/:id/resend-verification
 * Generate new verification token AND send verification email
 */
router.post('/:id/resend-verification', async (req, res) => {
  try {
    const { id } = req.params;

    const portalUser = await StudentPortalUser.findById(id);
    if (!portalUser) {
      return res.status(404).json({ error: 'Portal-Benutzer nicht gefunden' });
    }

    // Check if already verified
    if (portalUser.emailVerified) {
      return res.status(400).json({ error: 'E-Mail bereits verifiziert' });
    }

    // Generate new verification token
    const { token, expires } = generateVerificationTokenWithExpiry();

    portalUser.verificationToken = token;
    portalUser.verificationTokenExpires = expires;
    await portalUser.save();

    // Send verification email
    const studentName = `${portalUser.firstName} ${portalUser.lastName}`;
    await sendVerificationEmail(portalUser.email, token, studentName);

    res.json({
      message: 'Verifizierungs-E-Mail erfolgreich gesendet',
      email: portalUser.email,
      expires: expires
    });
  } catch (error) {
    logger.error("Error resending verification email", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Fehler beim Senden der Verifizierungs-E-Mail' });
  }
});

/**
 * GET /api/portal-users/:id
 * Get single portal user details
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const portalUser = await StudentPortalUser.findById(id)
      .select('-password')
      .populate('studentId');

    if (!portalUser) {
      return res.status(404).json({ error: 'Portal-Benutzer nicht gefunden' });
    }

    res.json({
      _id: portalUser._id,
      email: portalUser.email,
      firstName: portalUser.firstName,
      lastName: portalUser.lastName,
      birthdate: portalUser.birthdate,
      phone: portalUser.phone,
      emailVerified: portalUser.emailVerified,
      verificationTokenExpires: portalUser.verificationTokenExpires,
      student: portalUser.studentId,
      createdAt: portalUser.createdAt,
      updatedAt: portalUser.updatedAt
    });
  } catch (error) {
    logger.error("Error fetching portal user", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Fehler beim Laden des Portal-Benutzers' });
  }
});

export default router;
