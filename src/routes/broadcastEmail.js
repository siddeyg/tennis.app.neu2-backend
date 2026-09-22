import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import BroadcastEmail from '../models/BroadcastEmail.js';
import StudentPortalUser from '../models/StudentPortalUser.js';
import User from '../models/User.js';
import logger from '../utils/logger.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdminOrSupermod } from '../middleware/requireRole.js';
import { sendEmail } from '../utils/emailService.js';
import { renderBroadcastEmail, htmlToPlainText } from '../utils/broadcastEmailRenderer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// All broadcast routes require admin or supermod privileges
router.use(requireAuth, requireAdminOrSupermod);

// Ensure upload directories exist
const imagesUploadDir = path.join(__dirname, '../../uploads/broadcasts/images');
const attachmentsUploadDir = path.join(__dirname, '../../uploads/broadcasts/attachments');

if (!fs.existsSync(imagesUploadDir)) {
  fs.mkdirSync(imagesUploadDir, { recursive: true });
}
if (!fs.existsSync(attachmentsUploadDir)) {
  fs.mkdirSync(attachmentsUploadDir, { recursive: true });
}

// Multer storage configuration using random UUIDs to avoid path traversal
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, imagesUploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});

const attachmentStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, attachmentsUploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const uploadImage = multer({
  storage: imageStorage,
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Ungültiger Bildtyp. Erlaubt: JPEG, PNG, WEBP (max. 5 MB)'), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

const ALLOWED_ATTACHMENT_TYPES = ['application/pdf'];
const uploadAttachment = multer({
  storage: attachmentStorage,
  fileFilter: (req, file, cb) => {
    if (ALLOWED_ATTACHMENT_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Ungültiger Dateityp. Als Anhang sind ausschließlich PDF-Dateien erlaubt (max. 10 MB).'), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

/**
 * Helper to build database query for target audience
 */
function buildAudienceQuery(targetAudience) {
  const query = {
    emailVerified: true,
    isActive: true
  };

  if (targetAudience === 'adults') {
    query.$or = [
      { 'familyMembers.0': { $exists: false } },
      { isAdult: true }
    ];
  } else if (targetAudience === 'children') {
    query['familyMembers.0'] = { $exists: true };
  }

  return query;
}

/**
 * GET /api/broadcast-email/recipients-count
 * Returns the count of active, verified recipients for the selected target audience
 */
router.get('/recipients-count', async (req, res) => {
  try {
    const targetAudience = req.query.targetAudience || 'all';
    const query = buildAudienceQuery(targetAudience);
    const count = await StudentPortalUser.countDocuments(query);

    res.json({
      success: true,
      targetAudience,
      recipientCount: count
    });
  } catch (error) {
    logger.error('Error fetching broadcast recipients count:', error);
    res.status(500).json({ success: false, error: 'Fehler beim Abrufen der Empfängeranzahl' });
  }
});

/**
 * Public image serve for inline broadcast email images (no auth required — UUIDs are unguessable)
 */
export function serveBroadcastImage(req, res) {
  const filePath = path.join(imagesUploadDir, path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Bild nicht gefunden' });
  }
  res.sendFile(filePath);
}

/**
 * POST /api/broadcast-email/upload-image
 * Uploads an inline image for TipTap content
 */
router.post('/upload-image', (req, res) => {
  uploadImage.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Keine Bilddatei übermittelt' });
    }

    const publicUrl = `/api/broadcast-email/images/${req.file.filename}`;
    res.json({
      success: true,
      url: publicUrl,
      filename: req.file.filename,
      size: req.file.size
    });
  });
});

/**
 * POST /api/broadcast-email/upload-attachment
 * Uploads a PDF attachment
 */
router.post('/upload-attachment', (req, res) => {
  uploadAttachment.single('attachment')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Keine Anhangsdatei übermittelt' });
    }

    res.json({
      success: true,
      attachment: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        path: req.file.path
      }
    });
  });
});

/**
 * POST /api/broadcast-email/send-test
 * Sends a single formatted test email to the logged-in administrator
 */
router.post('/send-test', async (req, res) => {
  try {
    const { subject, contentHtml, attachments = [] } = req.body;

    if (!subject || !contentHtml) {
      return res.status(400).json({ success: false, error: 'Betreff und Inhalt sind erforderlich' });
    }

    const adminEmail = req.user.email;
    if (!adminEmail) {
      return res.status(400).json({ success: false, error: 'Keine E-Mail-Adresse für den Administrator hinterlegt' });
    }

    const mockAdminUser = {
      firstName: req.user.name ? req.user.name.split(' ')[0] : 'Admin',
      lastName: req.user.name ? req.user.name.split(' ').slice(1).join(' ') : '',
      email: adminEmail
    };

    const rendered = renderBroadcastEmail(contentHtml, mockAdminUser, {
      subject: `[TEST-VORSCHAU] ${subject}`
    });

    const nodemailerAttachments = attachments.map(att => ({
      filename: att.originalName || att.filename,
      path: att.path
    }));

    await sendEmail({
      to: adminEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      attachments: nodemailerAttachments,
      replyTo: 'info@mondo-tennisschule.de'
    });

    logger.info(`Test broadcast email sent to admin: ${adminEmail}`);

    res.json({
      success: true,
      message: `Test-E-Mail erfolgreich an ${adminEmail} gesendet.`
    });
  } catch (error) {
    logger.error('Error sending test broadcast email:', error);
    res.status(500).json({ success: false, error: `Fehler beim Senden der Test-E-Mail: ${error.message}` });
  }
});

/**
 * Background worker executing sequential email dispatch with pacing
 */
async function processBroadcastSending(broadcastId, attachments = []) {
  try {
    const broadcast = await BroadcastEmail.findById(broadcastId);
    if (!broadcast) return;

    logger.info(`Starting background email broadcast ${broadcastId} for ${broadcast.recipients.length} recipient(s)`);

    const nodemailerAttachments = (attachments || []).map(att => ({
      filename: att.originalName || att.filename,
      path: att.path
    }));

    for (let i = 0; i < broadcast.recipients.length; i++) {
      // 1. Check if broadcast was cancelled
      const freshCheck = await BroadcastEmail.findById(broadcastId).select('status');
      if (!freshCheck || freshCheck.status === 'cancelled') {
        logger.info(`Broadcast ${broadcastId} was cancelled by administrator during dispatch.`);
        return;
      }

      const recipient = broadcast.recipients[i];
      if (recipient.status === 'sent') continue; // Skip already sent (resumability)

      const userContext = {
        firstName: recipient.name ? recipient.name.split(' ')[0] : '',
        lastName: recipient.name ? recipient.name.split(' ').slice(1).join(' ') : '',
        email: recipient.email
      };

      const rendered = renderBroadcastEmail(broadcast.contentHtml, userContext, {
        subject: broadcast.subject
      });

      let sentSuccess = false;
      let lastError = null;

      // Try sending with a single retry on transient error
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await sendEmail({
            to: recipient.email,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            attachments: nodemailerAttachments,
            replyTo: 'info@mondo-tennisschule.de'
          });
          sentSuccess = true;
          break;
        } catch (err) {
          lastError = err.message;
          if (attempt === 1) {
            await new Promise(r => setTimeout(r, 2000)); // 2s retry delay
          }
        }
      }

      if (sentSuccess) {
        await BroadcastEmail.updateOne(
          { _id: broadcastId, 'recipients._id': recipient._id },
          {
            $set: {
              'recipients.$.status': 'sent',
              'recipients.$.sentAt': new Date()
            },
            $inc: { sentCount: 1 }
          }
        );
      } else {
        await BroadcastEmail.updateOne(
          { _id: broadcastId, 'recipients._id': recipient._id },
          {
            $set: {
              'recipients.$.status': 'failed',
              'recipients.$.error': lastError || 'Versand fehlgeschlagen'
            },
            $inc: { failedCount: 1 }
          }
        );
      }

      // SMTP-Pacing: 500ms pause between emails to protect mail reputation & avoid greylisting (skip in test)
      if (process.env.NODE_ENV !== 'test') {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Mark completed
    await BroadcastEmail.findByIdAndUpdate(broadcastId, {
      status: 'completed',
      completedAt: new Date()
    });

    logger.info(`Broadcast ${broadcastId} successfully completed.`);
  } catch (workerError) {
    logger.error(`Unhandled error in processBroadcastSending for ${broadcastId}:`, workerError);
    await BroadcastEmail.findByIdAndUpdate(broadcastId, {
      status: 'failed'
    });
  }
}

/**
 * POST /api/broadcast-email/send
 * Starts the live bulk email sending process
 */
router.post('/send', async (req, res) => {
  try {
    const { subject, contentHtml, targetAudience = 'all', attachments = [] } = req.body;

    if (!subject || !contentHtml) {
      return res.status(400).json({ success: false, error: 'Betreff und Inhalt sind erforderlich' });
    }

    const query = buildAudienceQuery(targetAudience);
    const users = await StudentPortalUser.find(query).select('_id email firstName lastName').lean();

    if (!users || users.length === 0) {
      return res.status(400).json({ success: false, error: 'Keine verifizierten Empfänger für die ausgewählte Zielgruppe gefunden' });
    }

    const recipients = users.map(u => ({
      userId: u._id,
      email: u.email,
      name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
      status: 'pending'
    }));

    const broadcast = new BroadcastEmail({
      subject,
      contentHtml,
      contentText: htmlToPlainText(contentHtml),
      targetAudience,
      recipients,
      attachments,
      senderAdminId: req.user._id,
      recipientCount: recipients.length,
      sentCount: 0,
      failedCount: 0,
      status: 'sending',
      sentAt: new Date()
    });

    await broadcast.save();

    logger.info(`Admin ${req.user.email} initiated bulk email "${subject}" to ${recipients.length} recipient(s)`);

    // Return 202 Accepted immediately so frontend can monitor progress
    res.status(202).json({
      success: true,
      broadcastId: broadcast._id,
      recipientCount: recipients.length,
      message: 'Versand gestartet'
    });

    // Start background worker
    setImmediate(() => {
      processBroadcastSending(broadcast._id, attachments);
    });

  } catch (error) {
    logger.error('Error initiating broadcast email dispatch:', error);
    res.status(500).json({ success: false, error: 'Fehler beim Starten des Rundmail-Versands' });
  }
});

/**
 * POST /api/broadcast-email/cancel/:id
 * Cancels an ongoing broadcast dispatch
 */
router.post('/cancel/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const broadcast = await BroadcastEmail.findById(id);

    if (!broadcast) {
      return res.status(404).json({ success: false, error: 'Rundmail nicht gefunden' });
    }

    if (broadcast.status !== 'sending') {
      return res.status(400).json({ success: false, error: `Rundmail kann nicht abgebrochen werden (Status: ${broadcast.status})` });
    }

    broadcast.status = 'cancelled';
    await broadcast.save();

    logger.info(`Admin ${req.user.email} cancelled broadcast ${id}`);

    res.json({
      success: true,
      message: 'Versand erfolgreich abgebrochen'
    });
  } catch (error) {
    logger.error('Error cancelling broadcast:', error);
    res.status(500).json({ success: false, error: 'Fehler beim Abbrechen des Versands' });
  }
});

/**
 * GET /api/broadcast-email/status/:id
 * Returns current progress metrics for polling
 */
router.get('/status/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const broadcast = await BroadcastEmail.findById(id).select('status sentCount failedCount recipientCount completedAt subject sentAt');

    if (!broadcast) {
      return res.status(404).json({ success: false, error: 'Rundmail nicht gefunden' });
    }

    res.json({
      success: true,
      status: broadcast.status,
      sentCount: broadcast.sentCount,
      failedCount: broadcast.failedCount,
      recipientCount: broadcast.recipientCount,
      sentAt: broadcast.sentAt,
      completedAt: broadcast.completedAt
    });
  } catch (error) {
    logger.error('Error fetching broadcast status:', error);
    res.status(500).json({ success: false, error: 'Fehler beim Abrufen des Status' });
  }
});

/**
 * GET /api/broadcast-email/history
 * Lists past broadcasts with pagination
 */
router.get('/history', async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    const [broadcasts, total] = await Promise.all([
      BroadcastEmail.find()
        .select('-contentHtml -contentText -recipients')
        .populate('senderAdminId', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      BroadcastEmail.countDocuments()
    ]);

    res.json({
      success: true,
      broadcasts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Error fetching broadcast history:', error);
    res.status(500).json({ success: false, error: 'Fehler beim Laden des Archivs' });
  }
});

/**
 * GET /api/broadcast-email/:id
 * Returns single broadcast details including full recipient delivery report
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const broadcast = await BroadcastEmail.findById(id)
      .populate('senderAdminId', 'name email')
      .lean();

    if (!broadcast) {
      return res.status(404).json({ success: false, error: 'Rundmail nicht gefunden' });
    }

    res.json({
      success: true,
      broadcast
    });
  } catch (error) {
    logger.error('Error fetching broadcast details:', error);
    res.status(500).json({ success: false, error: 'Fehler beim Laden der Rundmail' });
  }
});

export default router;
