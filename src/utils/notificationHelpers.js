import Notification from '../models/Notification.js';
import logger from './logger.js';

// Socket.io instance (will be set by notificationSocket.js)
let io = null;

/**
 * Initialize the Socket.io instance for notifications
 * Called by notificationSocket.js during server startup
 */
export function setSocketIO(socketIO) {
  io = socketIO;
  logger.info('Socket.IO instance initialized for notifications');
}

/**
 * Create a new notification for a user
 *
 * @param {String} userId - Student portal user ID
 * @param {String} type - Notification type (schedule_change, support_ticket_reply, etc.)
 * @param {String} title - Notification title (max 100 chars)
 * @param {String} message - Notification message (max 500 chars)
 * @param {Object} options - Optional parameters
 * @param {String} options.actionUrl - Deep link URL
 * @param {String} options.priority - Priority level (low, normal, high, urgent)
 * @param {Object} options.metadata - Additional context data
 * @param {Date} options.expiresAt - Custom expiration date (default: 90 days)
 * @returns {Promise<Object>} Created notification object
 */
export async function createNotification(userId, type, title, message, options = {}) {
  try {
    const notification = new Notification({
      userId,
      type,
      title,
      message,
      actionUrl: options.actionUrl,
      priority: options.priority || 'normal',
      metadata: options.metadata,
      expiresAt: options.expiresAt
    });

    await notification.save();

    logger.info(`Notification created for user ${userId}: ${type} - ${title}`);

    // Emit notification to user via Socket.io (if enabled and connected)
    await emitNotificationToUser(userId, notification);

    return notification;
  } catch (error) {
    logger.error(`Failed to create notification: ${error.message}`);
    throw error;
  }
}

/**
 * Emit a notification to a specific user via Socket.io
 *
 * @param {String} userId - Student portal user ID
 * @param {Object} notification - Notification object
 */
export async function emitNotificationToUser(userId, notification) {
  try {
    // Check if Socket.io is enabled and initialized
    if (!io) {
      logger.debug('Socket.IO not initialized - notification will be stored but not pushed in real-time');
      return;
    }

    const room = `user:${userId}`;

    // Emit to user's room
    io.to(room).emit('notification:new', notification);

    // Also emit updated unread count
    const unreadCount = await getUnreadCount(userId);
    io.to(room).emit('notification:unread-count', { count: unreadCount });

    logger.debug(`Notification emitted to user ${userId} (room: ${room})`);
  } catch (error) {
    // Don't throw - Socket.io emission failures shouldn't break notification creation
    logger.error(`Failed to emit notification to user ${userId}: ${error.message}`);
  }
}

/**
 * Get unread notification count for a user
 *
 * @param {String} userId - Student portal user ID
 * @returns {Promise<Number>} Unread notification count
 */
export async function getUnreadCount(userId) {
  try {
    return await Notification.getUnreadCount(userId);
  } catch (error) {
    logger.error(`Failed to get unread count for user ${userId}: ${error.message}`);
    throw error;
  }
}

/**
 * Mark a specific notification as read
 *
 * @param {String} notificationId - Notification ID
 * @param {String} userId - Student portal user ID (for authorization)
 * @returns {Promise<Object>} Updated notification
 */
export async function markAsRead(notificationId, userId) {
  try {
    const notification = await Notification.findOne({ _id: notificationId, userId });

    if (!notification) {
      throw new Error('Notification not found or unauthorized');
    }

    await notification.markAsRead();

    // Emit updated unread count
    if (io) {
      const unreadCount = await getUnreadCount(userId);
      io.to(`user:${userId}`).emit('notification:unread-count', { count: unreadCount });
    }

    return notification;
  } catch (error) {
    logger.error(`Failed to mark notification ${notificationId} as read: ${error.message}`);
    throw error;
  }
}

/**
 * Mark all notifications as read for a user
 *
 * @param {String} userId - Student portal user ID
 * @returns {Promise<Number>} Number of notifications marked as read
 */
export async function markAllAsRead(userId) {
  try {
    const count = await Notification.markAllAsRead(userId);

    logger.info(`Marked ${count} notifications as read for user ${userId}`);

    // Emit updated unread count (should be 0)
    if (io) {
      io.to(`user:${userId}`).emit('notification:unread-count', { count: 0 });
    }

    return count;
  } catch (error) {
    logger.error(`Failed to mark all notifications as read for user ${userId}: ${error.message}`);
    throw error;
  }
}
