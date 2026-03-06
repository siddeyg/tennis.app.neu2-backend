import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import Announcement from '../models/Announcement.js';
import StudentPortalUser from '../models/StudentPortalUser.js';
import logger from '../utils/logger.js';
import auditLogMiddleware from '../middleware/auditLog.js';
import { createNotification } from '../utils/notificationHelpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../../uploads/announcements');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Dateityp nicht erlaubt. Erlaubt: PDF, JPEG, PNG, GIF, WEBP'), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Helper function to identify changed fields
function getChangedFields(before, after) {
  const changes = {};
  for (const key in after) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = { old: before[key], new: after[key] };
    }
  }
  return changes;
}

// Helper to delete attachment files from disk
function deleteAttachmentFiles(attachments) {
  for (const att of attachments) {
    const filePath = path.join(uploadDir, att.filename);
    fs.unlink(filePath, (err) => {
      if (err && err.code !== 'ENOENT') {
        logger.error('Error deleting attachment file', { error: err.message, filename: att.filename });
      }
    });
  }
}

// Helper function to send announcement notifications to all relevant students
async function sendAnnouncementNotifications(announcement) {
  try {
    // Only send notifications for urgent or important announcements that are active
    if (!announcement.isActive || announcement.priority === 'normal') {
      logger.info('Skipping announcement notifications (not urgent/important or inactive)', {
        announcementId: announcement._id,
        priority: announcement.priority,
        isActive: announcement.isActive
      });
      return;
    }

    // Get all active portal users
    const filter = {
      isActive: true,
      emailVerified: true,
      profileCompleted: true
    };

    // Filter by target audience if not "all"
    if (announcement.targetAudience !== 'all') {
      if (announcement.targetAudience === 'adults') {
        filter.$or = [
          { familyMembers: { $size: 0 } },
          { isAdult: true }
        ];
      } else if (announcement.targetAudience === 'children') {
        filter['familyMembers.0'] = { $exists: true };
      }
    }

    const users = await StudentPortalUser.find(filter).select('_id').lean();

    logger.info(`Sending announcement notifications to ${users.length} users`, {
      announcementId: announcement._id,
      targetAudience: announcement.targetAudience,
      priority: announcement.priority
    });

    let successCount = 0;
    let errorCount = 0;

    for (const user of users) {
      try {
        await createNotification(
          user._id,
          'announcement',
          announcement.title,
          announcement.content.substring(0, 200) + (announcement.content.length > 200 ? '...' : ''),
          {
            priority: announcement.priority === 'urgent' ? 'urgent' : 'high',
            actionUrl: '/dashboard',
            metadata: { announcementId: announcement._id }
          }
        );
        successCount++;
      } catch (notificationError) {
        logger.error('Error creating notification for user', {
          error: notificationError.message,
          userId: user._id,
          announcementId: announcement._id
        });
        errorCount++;
      }
    }

    logger.info(`Announcement notifications completed`, {
      announcementId: announcement._id,
      successCount,
      errorCount,
      totalUsers: users.length
    });

  } catch (error) {
    logger.error('Error sending announcement notifications', {
      error: error.message,
      stack: error.stack,
      announcementId: announcement._id
    });
    // Don't throw - this is a background task
  }
}

/**
 * @route   GET /api/announcements
 * @desc    Get all announcements (admin view)
 * @access  Private (admin only)
 */
router.get('/', async (req, res) => {
  try {
    const announcements = await Announcement.find()
      .populate('createdBy', 'firstName lastName email')
      .populate('lastModifiedBy', 'firstName lastName email')
      .sort({ publishDate: -1 });

    res.json(announcements);
  } catch (error) {
    logger.error("Error fetching announcements", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Laden der Ankündigungen' });
  }
});

/**
 * @route   GET /api/announcements/:id/attachments/:filename
 * @desc    Download an attachment file
 * @access  Private (admin only)
 */
router.get('/:id/attachments/:filename', async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) {
      return res.status(404).json({ error: 'Ankündigung nicht gefunden' });
    }

    const attachment = announcement.attachments.find(a => a.filename === req.params.filename);
    if (!attachment) {
      return res.status(404).json({ error: 'Anhang nicht gefunden' });
    }

    const filePath = path.join(uploadDir, attachment.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Datei nicht gefunden' });
    }

    res.setHeader('Content-Disposition', `inline; filename="${attachment.originalName}"`);
    res.setHeader('Content-Type', attachment.mimeType);
    res.sendFile(filePath);
  } catch (error) {
    logger.error("Error downloading announcement attachment", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Herunterladen des Anhangs' });
  }
});

/**
 * @route   GET /api/announcements/:id
 * @desc    Get single announcement
 * @access  Private (admin only)
 */
router.get('/:id', async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.id)
      .populate('createdBy', 'firstName lastName email')
      .populate('lastModifiedBy', 'firstName lastName email');

    if (!announcement) {
      return res.status(404).json({ error: 'Ankündigung nicht gefunden' });
    }

    res.json(announcement);
  } catch (error) {
    logger.error("Error fetching announcement", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Laden der Ankündigung' });
  }
});

/**
 * @route   POST /api/announcements
 * @desc    Create new announcement
 * @access  Private (admin only)
 */
router.post('/', auditLogMiddleware({ action: 'CREATE', resource: 'Announcement' }), upload.array('attachments', 5), async (req, res) => {
  try {
    const { title, content, targetAudience, priority, publishDate, expiryDate } = req.body;

    // Validation
    if (!title || !content) {
      // Clean up uploaded files on validation error
      deleteAttachmentFiles((req.files || []).map(f => ({ filename: f.filename })));
      return res.status(400).json({ error: 'Titel und Inhalt sind erforderlich' });
    }

    if (title.length > 200) {
      deleteAttachmentFiles((req.files || []).map(f => ({ filename: f.filename })));
      return res.status(400).json({ error: 'Titel darf maximal 200 Zeichen lang sein' });
    }

    if (content.length > 5000) {
      deleteAttachmentFiles((req.files || []).map(f => ({ filename: f.filename })));
      return res.status(400).json({ error: 'Inhalt darf maximal 5000 Zeichen lang sein' });
    }

    const attachments = (req.files || []).map(f => ({
      filename: f.filename,
      originalName: f.originalname,
      mimeType: f.mimetype,
      size: f.size
    }));

    const announcement = new Announcement({
      title,
      content,
      targetAudience: targetAudience || 'all',
      priority: priority || 'normal',
      publishDate: publishDate || Date.now(),
      expiryDate: expiryDate || null,
      createdBy: req.user._id,
      attachments
    });

    await announcement.save();
    await announcement.populate('createdBy', 'firstName lastName email');

    setImmediate(() => {
      sendAnnouncementNotifications(announcement);
    });

    res.status(201).json({
      message: 'Ankündigung erfolgreich erstellt',
      announcement
    });

  } catch (error) {
    deleteAttachmentFiles((req.files || []).map(f => ({ filename: f.filename })));
    logger.error("Error creating announcement", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Erstellen der Ankündigung' });
  }
});

/**
 * @route   PUT /api/announcements/:id
 * @desc    Update announcement
 * @access  Private (admin only)
 */
router.put('/:id', auditLogMiddleware({ action: 'UPDATE', resource: 'Announcement' }), upload.array('attachments', 5), async (req, res) => {
  try {
    const { title, content, targetAudience, priority, isActive, publishDate, expiryDate, existingAttachments } = req.body;

    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) {
      deleteAttachmentFiles((req.files || []).map(f => ({ filename: f.filename })));
      return res.status(404).json({ error: 'Ankündigung nicht gefunden' });
    }

    const beforeState = announcement.toObject();

    // Validation
    if (title && title.length > 200) {
      deleteAttachmentFiles((req.files || []).map(f => ({ filename: f.filename })));
      return res.status(400).json({ error: 'Titel darf maximal 200 Zeichen lang sein' });
    }

    if (content && content.length > 5000) {
      deleteAttachmentFiles((req.files || []).map(f => ({ filename: f.filename })));
      return res.status(400).json({ error: 'Inhalt darf maximal 5000 Zeichen lang sein' });
    }

    // Determine which existing attachments to keep
    let keptAttachments = announcement.attachments;
    if (existingAttachments !== undefined) {
      const kept = JSON.parse(existingAttachments);
      const keptFilenames = new Set(kept.map(a => a.filename));
      // Delete files that were removed
      const removed = announcement.attachments.filter(a => !keptFilenames.has(a.filename));
      deleteAttachmentFiles(removed);
      keptAttachments = announcement.attachments.filter(a => keptFilenames.has(a.filename));
    }

    // Add newly uploaded files
    const newAttachments = (req.files || []).map(f => ({
      filename: f.filename,
      originalName: f.originalname,
      mimeType: f.mimetype,
      size: f.size
    }));

    // Update fields
    if (title !== undefined) announcement.title = title;
    if (content !== undefined) announcement.content = content;
    if (targetAudience !== undefined) announcement.targetAudience = targetAudience;
    if (priority !== undefined) announcement.priority = priority;
    if (isActive !== undefined) announcement.isActive = isActive === 'true' || isActive === true;
    if (publishDate !== undefined) announcement.publishDate = publishDate;
    if (expiryDate !== undefined) announcement.expiryDate = expiryDate || null;
    announcement.attachments = [...keptAttachments, ...newAttachments];
    announcement.lastModifiedBy = req.user._id;

    await announcement.save();
    await announcement.populate('createdBy', 'firstName lastName email');
    await announcement.populate('lastModifiedBy', 'firstName lastName email');

    const wasActivated = beforeState.isActive === false && announcement.isActive === true;
    const priorityIncreased = (beforeState.priority === 'normal') && (announcement.priority === 'urgent' || announcement.priority === 'important');

    if (wasActivated || priorityIncreased) {
      setImmediate(() => {
        sendAnnouncementNotifications(announcement);
      });
    }

    const afterState = announcement.toObject();
    req.auditMetadata = {
      before: beforeState,
      after: afterState,
      changes: getChangedFields(beforeState, afterState)
    };

    res.json({
      message: 'Ankündigung erfolgreich aktualisiert',
      announcement
    });

  } catch (error) {
    deleteAttachmentFiles((req.files || []).map(f => ({ filename: f.filename })));
    logger.error("Error updating announcement", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Aktualisieren der Ankündigung' });
  }
});

/**
 * @route   DELETE /api/announcements/:id
 * @desc    Delete announcement (soft delete - sets isActive to false)
 * @access  Private (admin only)
 */
router.delete('/:id', auditLogMiddleware({ action: 'DELETE', resource: 'Announcement' }), async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.id);

    if (!announcement) {
      return res.status(404).json({ error: 'Ankündigung nicht gefunden' });
    }

    // Soft delete
    announcement.isActive = false;
    announcement.lastModifiedBy = req.user._id;
    await announcement.save();

    res.json({ message: 'Ankündigung erfolgreich gelöscht' });

  } catch (error) {
    logger.error("Error deleting announcement", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Löschen der Ankündigung' });
  }
});

/**
 * @route   POST /api/announcements/:id/activate
 * @desc    Reactivate deleted announcement
 * @access  Private (admin only)
 */
router.post('/:id/activate', auditLogMiddleware({ action: 'UPDATE', resource: 'Announcement', metadata: { operation: 'ACTIVATE' } }), async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.id);

    if (!announcement) {
      return res.status(404).json({ error: 'Ankündigung nicht gefunden' });
    }

    announcement.isActive = true;
    announcement.lastModifiedBy = req.user._id;
    await announcement.save();

    setImmediate(() => {
      sendAnnouncementNotifications(announcement);
    });

    res.json({ message: 'Ankündigung erfolgreich aktiviert' });

  } catch (error) {
    logger.error("Error activating announcement", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Aktivieren der Ankündigung' });
  }
});

/**
 * @route   POST /api/announcements/upload-image
 * @desc    Upload an inline image for use in the announcement editor
 * @access  Private (admin only)
 */
router.post('/upload-image', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Kein Bild hochgeladen' });
  if (!req.file.mimetype.startsWith('image/')) {
    fs.unlink(path.join(uploadDir, req.file.filename), () => {});
    return res.status(400).json({ error: 'Nur Bilder erlaubt' });
  }
  res.json({ url: `/api/announcements/images/${req.file.filename}` });
});

export default router;

/**
 * Public image serve handler — mounted in server.js BEFORE auth guard
 * so <img> tags in rendered announcements load without auth.
 */
export function serveAnnouncementImage(req, res) {
  const filePath = path.join(uploadDir, path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Bild nicht gefunden' });
  res.sendFile(filePath);
}
