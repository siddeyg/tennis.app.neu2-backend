import express from 'express';
import Notification from '../models/Notification.js';
import { verifyPortalAuth } from '../middleware/verifyPortalAuth.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { createNotification, getUnreadCount, markAsRead, markAllAsRead } from '../utils/notificationHelpers.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/portal/notifications
 * Get all notifications for authenticated student portal user
 * Supports pagination and filtering
 */
router.get('/', verifyPortalAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Optional filters
    const filters = { userId };

    if (req.query.unreadOnly === 'true') {
      filters.read = false;
    }

    if (req.query.type) {
      filters.type = req.query.type;
    }

    if (req.query.priority) {
      filters.priority = req.query.priority;
    }

    // Get notifications with pagination
    const notifications = await Notification.find(filters)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Get total count for pagination
    const total = await Notification.countDocuments(filters);

    res.json({
      notifications,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error(`Failed to fetch notifications: ${error.message}`);
    res.status(500).json({ error: 'Fehler beim Laden der Benachrichtigungen' });
  }
});

/**
 * GET /api/portal/notifications/unread-count
 * Get unread notification count for authenticated user
 */
router.get('/unread-count', verifyPortalAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const count = await getUnreadCount(userId);

    res.json({ count });

  } catch (error) {
    logger.error(`Failed to get unread count: ${error.message}`);
    res.status(500).json({ error: 'Fehler beim Laden der ungelesenen Benachrichtigungen' });
  }
});

/**
 * PATCH /api/portal/notifications/:id/read
 * Mark a specific notification as read
 */
router.patch('/:id/read', verifyPortalAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const notificationId = req.params.id;

    const notification = await markAsRead(notificationId, userId);

    res.json({
      message: 'Benachrichtigung als gelesen markiert',
      notification
    });

  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Benachrichtigung nicht gefunden' });
    }

    logger.error(`Failed to mark notification as read: ${error.message}`);
    res.status(500).json({ error: 'Fehler beim Markieren der Benachrichtigung' });
  }
});

/**
 * PATCH /api/portal/notifications/read-all
 * Mark all notifications as read for authenticated user
 */
router.patch('/read-all', verifyPortalAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const count = await markAllAsRead(userId);

    res.json({
      message: `${count} Benachrichtigungen als gelesen markiert`,
      count
    });

  } catch (error) {
    logger.error(`Failed to mark all notifications as read: ${error.message}`);
    res.status(500).json({ error: 'Fehler beim Markieren aller Benachrichtigungen' });
  }
});

/**
 * DELETE /api/portal/notifications/:id
 * Delete a specific notification
 */
router.delete('/:id', verifyPortalAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const notificationId = req.params.id;

    const notification = await Notification.findOneAndDelete({
      _id: notificationId,
      userId
    });

    if (!notification) {
      return res.status(404).json({ error: 'Benachrichtigung nicht gefunden' });
    }

    res.json({
      message: 'Benachrichtigung gelöscht',
      notification
    });

  } catch (error) {
    logger.error(`Failed to delete notification: ${error.message}`);
    res.status(500).json({ error: 'Fehler beim Löschen der Benachrichtigung' });
  }
});

/**
 * POST /api/portal/notifications (ADMIN ONLY - FOR TESTING)
 * Create a test notification
 * Body: { userId, type, title, message, priority?, actionUrl?, metadata? }
 */
router.post('/', requireAuth, requireRole(['admin']), async (req, res) => {
  try {
    const { userId, type, title, message, priority, actionUrl, metadata } = req.body;

    // Validation
    if (!userId || !type || !title || !message) {
      return res.status(400).json({
        error: 'Fehlende Pflichtfelder: userId, type, title, message'
      });
    }

    const notification = await createNotification(
      userId,
      type,
      title,
      message,
      { priority, actionUrl, metadata }
    );

    res.status(201).json({
      message: 'Test-Benachrichtigung erstellt',
      notification
    });

  } catch (error) {
    logger.error(`Failed to create test notification: ${error.message}`);
    res.status(500).json({ error: 'Fehler beim Erstellen der Test-Benachrichtigung' });
  }
});

export default router;
