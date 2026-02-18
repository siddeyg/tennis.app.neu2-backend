import express from 'express';
import Announcement from '../models/Announcement.js';
import StudentPortalUser from '../models/StudentPortalUser.js';
import logger from '../utils/logger.js';
import auditLogMiddleware from '../middleware/auditLog.js';
import { createNotification } from '../utils/notificationHelpers.js';

const router = express.Router();

// Helper function to identify changed fields
function getChangedFields(before, after) {
  const changes = {};
  for (const key in after) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = {
        old: before[key],
        new: after[key]
      };
    }
  }
  return changes;
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
      // For adults: check if user has no familyMembers or has adult flag
      // For children: check if user has familyMembers
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

    // Send notification to each user
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
            metadata: {
              announcementId: announcement._id
            }
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
 * @access  Private (admin only - enforced by requireAuth + requireRole middleware)
 */
router.get('/', async (req, res) => {
  try {
    const announcements = await Announcement.find()
      .populate('createdBy', 'firstName lastName email')
      .populate('lastModifiedBy', 'firstName lastName email')
      .sort({ publishDate: -1 }); // Newest first

    res.json(announcements);
  } catch (error) {
    logger.error("Error fetching announcements", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Laden der Ankündigungen' });
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
router.post('/', auditLogMiddleware({ action: 'CREATE', resource: 'Announcement' }), async (req, res) => {
  try {
    const { title, content, targetAudience, priority, publishDate, expiryDate } = req.body;

    // Validation
    if (!title || !content) {
      return res.status(400).json({ error: 'Titel und Inhalt sind erforderlich' });
    }

    if (title.length > 200) {
      return res.status(400).json({ error: 'Titel darf maximal 200 Zeichen lang sein' });
    }

    if (content.length > 5000) {
      return res.status(400).json({ error: 'Inhalt darf maximal 5000 Zeichen lang sein' });
    }

    // Create announcement
    const announcement = new Announcement({
      title,
      content,
      targetAudience: targetAudience || 'all',
      priority: priority || 'normal',
      publishDate: publishDate || Date.now(),
      expiryDate: expiryDate || null,
      createdBy: req.user._id // From requireAuth middleware
    });

    await announcement.save();

    // Populate creator info for response
    await announcement.populate('createdBy', 'firstName lastName email');

    // Send notifications for urgent/important announcements (non-blocking)
    setImmediate(() => {
      sendAnnouncementNotifications(announcement);
    });

    res.status(201).json({
      message: 'Ankündigung erfolgreich erstellt',
      announcement
    });

  } catch (error) {
    logger.error("Error creating announcement", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Erstellen der Ankündigung' });
  }
});

/**
 * @route   PUT /api/announcements/:id
 * @desc    Update announcement
 * @access  Private (admin only)
 */
router.put('/:id', auditLogMiddleware({ action: 'UPDATE', resource: 'Announcement' }), async (req, res) => {
  try {
    const { title, content, targetAudience, priority, isActive, publishDate, expiryDate } = req.body;

    // Find announcement
    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) {
      return res.status(404).json({ error: 'Ankündigung nicht gefunden' });
    }

    // Capture BEFORE state
    const beforeState = announcement.toObject();

    // Validation
    if (title && title.length > 200) {
      return res.status(400).json({ error: 'Titel darf maximal 200 Zeichen lang sein' });
    }

    if (content && content.length > 5000) {
      return res.status(400).json({ error: 'Inhalt darf maximal 5000 Zeichen lang sein' });
    }

    // Update fields
    if (title !== undefined) announcement.title = title;
    if (content !== undefined) announcement.content = content;
    if (targetAudience !== undefined) announcement.targetAudience = targetAudience;
    if (priority !== undefined) announcement.priority = priority;
    if (isActive !== undefined) announcement.isActive = isActive;
    if (publishDate !== undefined) announcement.publishDate = publishDate;
    if (expiryDate !== undefined) announcement.expiryDate = expiryDate;

    announcement.lastModifiedBy = req.user._id;

    await announcement.save();

    // Populate for response
    await announcement.populate('createdBy', 'firstName lastName email');
    await announcement.populate('lastModifiedBy', 'firstName lastName email');

    // Send notifications if announcement was just activated or priority changed to urgent/important
    const wasActivated = beforeState.isActive === false && announcement.isActive === true;
    const priorityIncreased = (beforeState.priority === 'normal') && (announcement.priority === 'urgent' || announcement.priority === 'important');

    if (wasActivated || priorityIncreased) {
      setImmediate(() => {
        sendAnnouncementNotifications(announcement);
      });
    }

    // Attach before/after to req for audit log
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

    // Send notifications for urgent/important announcements when activated
    setImmediate(() => {
      sendAnnouncementNotifications(announcement);
    });

    res.json({ message: 'Ankündigung erfolgreich aktiviert' });

  } catch (error) {
    logger.error("Error activating announcement", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Aktivieren der Ankündigung' });
  }
});

export default router;
