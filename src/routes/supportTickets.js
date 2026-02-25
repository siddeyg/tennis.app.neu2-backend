import express from 'express';
import rateLimit from 'express-rate-limit';
import SupportTicket from '../models/SupportTicket.js';
import User from '../models/User.js';
import StudentPortalUser from '../models/StudentPortalUser.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { sendTicketReplyEmail, sendTicketStatusChangeEmail } from '../utils/emailService.js';
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

// Escape special regex characters to prevent ReDoS attacks
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Sanitize HTML/XSS from text content
const sanitizeText = (text) => {
  if (!text) return text;
  // Strip all HTML tags
  return text.replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();
};

// Admin message creation rate limiter
const adminReplyLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,  // 1 minute
  max: 30,  // 30 messages per minute
  message: { error: 'Zu viele Nachrichten. Bitte warten Sie eine Minute.' },
  keyGenerator: (req) => req.user.id,
  skip: (req) => process.env.NODE_ENV === 'test'
});

// Ticket creation rate limiter (admin)
const adminCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 50,  // 50 tickets per 15 minutes
  message: { error: 'Zu viele Tickets erstellt. Bitte warten Sie.' },
  keyGenerator: (req) => req.user.id,
  skip: (req) => process.env.NODE_ENV === 'test'
});

// All routes require admin authentication
router.use(requireAuth);

// GET /api/support-tickets/stats
// Dashboard statistics
router.get('/stats', async (req, res) => {
  try {
    const [openCount, inProgressCount, resolvedCount, totalCount, unreadCount] = await Promise.all([
      SupportTicket.countDocuments({ status: 'open', isDeleted: false }),
      SupportTicket.countDocuments({ status: 'in-progress', isDeleted: false }),
      SupportTicket.countDocuments({ status: 'resolved', isDeleted: false }),
      SupportTicket.countDocuments({ isDeleted: false }),
      SupportTicket.countDocuments({ unreadByAdmin: { $gt: 0 }, isDeleted: false })
    ]);

    res.json({
      open: openCount,
      inProgress: inProgressCount,
      resolved: resolvedCount,
      total: totalCount,
      unread: unreadCount
    });
  } catch (error) {
    logger.error('Error fetching ticket stats', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Laden der Statistiken' });
  }
});

// GET /api/support-tickets
// List all tickets with filters
router.get('/', async (req, res) => {
  try {
    const {
      status,
      priority,
      assignedTo,
      hasUnread,
      search,
      sortBy = 'updatedAt',
      sortOrder = 'desc',
      limit = 50,
      skip = 0
    } = req.query;

    // Build filter query
    const filter = { isDeleted: false };

    if (status) {
      filter.status = status;
    }

    if (priority) {
      filter.priority = priority;
    }

    if (assignedTo) {
      if (assignedTo === 'unassigned') {
        filter.assignedTo = null;
      } else {
        filter.assignedTo = assignedTo;
      }
    }

    if (hasUnread === 'true') {
      filter.unreadByAdmin = { $gt: 0 };
    }

    if (search) {
      // Validate search length
      if (search.length > 50) {
        return res.status(400).json({ error: 'Suchbegriff zu lang (max 50 Zeichen)' });
      }

      // Check if searching by ticket number
      const ticketNumber = parseInt(search, 10);
      if (!isNaN(ticketNumber)) {
        filter.ticketNumber = ticketNumber;
      } else {
        // Use MongoDB text search
        filter.$text = { $search: search };
      }
    }

    // Validate and sanitize query parameters
    const validatedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100); // Between 1 and 100
    const validatedSkip = Math.max(parseInt(skip, 10) || 0, 0); // Minimum 0

    // Whitelist allowed sort fields to prevent sorting by non-indexed fields
    const allowedSortFields = ['createdAt', 'updatedAt', 'priority', 'status', 'ticketNumber', 'subject'];
    const validatedSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'updatedAt';

    // Validate sort order (only asc or desc)
    const validatedSortOrder = sortOrder === 'asc' ? 'asc' : 'desc';

    // Build sort
    const sort = {};
    sort[validatedSortBy] = validatedSortOrder === 'asc' ? 1 : -1;

    // Execute query
    const tickets = await SupportTicket.find(filter)
      .sort(sort)
      .limit(validatedLimit)
      .skip(validatedSkip)
      .populate('assignedTo', 'username')
      .lean();

    const total = await SupportTicket.countDocuments(filter);

    res.json({
      tickets,
      total,
      limit: validatedLimit,
      skip: validatedSkip
    });
  } catch (error) {
    logger.error('Error fetching tickets', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Laden der Tickets' });
  }
});

// GET /api/support-tickets/:id
// Get single ticket with full message thread
router.get('/:id', async (req, res) => {
  try {
    const ticket = await SupportTicket.findOne({
      _id: req.params.id,
      isDeleted: false
    })
      .populate('assignedTo', 'username')
      .lean();

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket nicht gefunden' });
    }

    res.json(ticket);
  } catch (error) {
    logger.error('Error fetching ticket', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Laden des Tickets' });
  }
});

// POST /api/support-tickets/:id/messages
// Admin adds reply to ticket
router.post('/:id/messages', adminReplyLimiter, auditLogMiddleware({ action: 'CREATE', resource: 'TicketMessage' }), async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Nachricht darf nicht leer sein' });
    }

    if (content.length > 5000) {
      return res.status(400).json({ error: 'Nachricht zu lang (max 5000 Zeichen)' });
    }

    const ticket = await SupportTicket.findOne({
      _id: req.params.id,
      isDeleted: false
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket nicht gefunden' });
    }

    // Create message
    const message = {
      senderType: 'admin',
      senderId: req.user.id,
      senderName: req.user.username || 'Admin',
      content: sanitizeText(content.trim()),
      isRead: false
    };

    // Update ticket
    ticket.messages.push(message);
    ticket.lastMessageAt = new Date();
    ticket.lastMessageFrom = 'admin';
    ticket.unreadByStudent += 1;

    // Auto-change status from waiting-customer to in-progress
    if (ticket.status === 'waiting-customer') {
      ticket.status = 'in-progress';
      ticket.statusHistory.push({
        status: 'in-progress',
        changedBy: req.user.id,
        note: 'Auto-changed on admin reply'
      });
    }

    await ticket.save();

    // Send email notification to student
    try {
      const studentEmail = ticket.createdBy.email;
      if (studentEmail) {
        await sendTicketReplyEmail(ticket, message, studentEmail);
      }
    } catch (emailError) {
      logger.error('Error sending ticket reply email', { error: emailError.message, stack: emailError.stack });
      // Don't fail the request if email fails
    }

    // Send notification to student
    try {
      if (ticket.createdBy.studentPortalUserId) {
        await createNotification(
          ticket.createdBy.studentPortalUserId,
          'support_ticket_reply',
          `Neue Antwort auf Ticket #${ticket.ticketNumber}`,
          message.content.substring(0, 200) + (message.content.length > 200 ? '...' : ''),
          {
            priority: 'high',
            actionUrl: `/dashboard/support-tickets/${ticket._id}`,
            metadata: {
              ticketId: ticket._id,
              ticketNumber: ticket.ticketNumber
            }
          }
        );
      }
    } catch (notificationError) {
      logger.error('Error creating notification for ticket reply', { error: notificationError.message, stack: notificationError.stack });
      // Don't fail the request if notification fails
    }

    res.json({
      success: true,
      message: 'Antwort gesendet',
      ticket: await SupportTicket.findById(ticket._id).populate('assignedTo', 'username').lean()
    });
  } catch (error) {
    logger.error('Error adding message', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Senden der Nachricht' });
  }
});

// GET /api/support-tickets/:id/messages - Fetch all messages for a ticket
router.get('/:id/messages', async (req, res) => {
  try {
    const ticket = await SupportTicket.findOne({
      _id: req.params.id,
      isDeleted: false
    }).lean();

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket nicht gefunden' });
    }

    const messages = ticket.messages.filter(m => !m.isDeleted);
    res.json(messages);
  } catch (error) {
    logger.error('Error fetching ticket messages', {
      error: error.message,
      ticketId: req.params.id,
      userId: req.user?.id
    });
    res.status(500).json({ error: 'Serverfehler beim Laden der Nachrichten' });
  }
});

// POST /api/support-tickets/:id/read - Mark all student messages as read
router.post('/:id/read', async (req, res) => {
  try {
    const ticket = await SupportTicket.findOne({
      _id: req.params.id,
      isDeleted: false
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket nicht gefunden' });
    }

    let readCount = 0;
    ticket.messages.forEach(msg => {
      if (!msg.isRead && msg.senderType === 'student') {
        msg.isRead = true;
        readCount++;
      }
    });

    if (readCount > 0) {
      // Safely decrement counter (prevent negative values)
      if (ticket.unreadByAdmin > 0) {
        ticket.unreadByAdmin = Math.max(0, ticket.unreadByAdmin - readCount);
      }
      await ticket.save();
      logger.info('Marked ticket messages as read', {
        ticketId: req.params.id,
        readCount,
        adminId: req.user?.id
      });
    }

    res.json({ success: true, readCount });
  } catch (error) {
    logger.error('Error marking ticket as read', {
      error: error.message,
      ticketId: req.params.id,
      userId: req.user?.id
    });
    res.status(500).json({ error: 'Serverfehler beim Markieren als gelesen' });
  }
});

// PUT /api/support-tickets/:id/status
// Change ticket status
router.put('/:id/status', auditLogMiddleware({ action: 'UPDATE', resource: 'SupportTicket', metadata: { operation: 'CHANGE_STATUS' } }), async (req, res) => {
  try {
    const { status, note } = req.body;

    const validStatuses = ['open', 'in-progress', 'waiting-customer', 'resolved', 'closed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Ungültiger Status' });
    }

    const ticket = await SupportTicket.findOne({
      _id: req.params.id,
      isDeleted: false
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket nicht gefunden' });
    }

    // Capture BEFORE state
    const beforeState = ticket.toObject();
    const oldStatus = ticket.status;

    // State machine validation
    const ALLOWED_TRANSITIONS = {
      'open': ['in-progress', 'waiting-customer', 'resolved', 'closed'],
      'in-progress': ['waiting-customer', 'resolved', 'closed', 'open'],
      'waiting-customer': ['in-progress', 'resolved', 'closed', 'open'],
      'resolved': ['closed', 'open'],
      'closed': [] // Cannot transition from closed
    };

    if (oldStatus === 'closed') {
      return res.status(400).json({
        error: 'Geschlossene Tickets können nicht wieder geöffnet werden'
      });
    }

    if (!ALLOWED_TRANSITIONS[oldStatus].includes(status)) {
      return res.status(400).json({
        error: `Ungültiger Statusübergang von "${oldStatus}" zu "${status}"`
      });
    }

    ticket.status = status;

    // Add to status history
    ticket.statusHistory.push({
      status,
      changedBy: req.user.id,
      note: note || ''
    });

    await ticket.save();

    // Send email notification to student
    try {
      const studentEmail = ticket.createdBy.email;
      if (studentEmail && oldStatus !== status) {
        await sendTicketStatusChangeEmail(ticket, oldStatus, status, studentEmail);
      }
    } catch (emailError) {
      logger.error('Error sending status change email', { error: emailError.message, stack: emailError.stack });
      // Don't fail the request if email fails
    }

    // Send notification to student about status change
    try {
      if (ticket.createdBy.studentPortalUserId && oldStatus !== status) {
        const statusLabels = {
          'open': 'Offen',
          'in-progress': 'In Bearbeitung',
          'waiting-customer': 'Wartet auf Antwort',
          'resolved': 'Gelöst',
          'closed': 'Geschlossen'
        };

        await createNotification(
          ticket.createdBy.studentPortalUserId,
          'support_ticket_status',
          `Status von Ticket #${ticket.ticketNumber} geändert`,
          `Ihr Ticket wurde von "${statusLabels[oldStatus]}" auf "${statusLabels[status]}" gesetzt.`,
          {
            priority: status === 'resolved' || status === 'closed' ? 'normal' : 'high',
            actionUrl: `/dashboard/support-tickets/${ticket._id}`,
            metadata: {
              ticketId: ticket._id,
              ticketNumber: ticket.ticketNumber,
              oldStatus,
              newStatus: status
            }
          }
        );
      }
    } catch (notificationError) {
      logger.error('Error creating notification for status change', { error: notificationError.message, stack: notificationError.stack });
      // Don't fail the request if notification fails
    }

    // Attach before/after to req for audit log
    const afterState = ticket.toObject();
    req.auditMetadata = {
      before: beforeState,
      after: afterState,
      changes: getChangedFields(beforeState, afterState)
    };

    res.json({
      success: true,
      message: 'Status aktualisiert',
      ticket: await SupportTicket.findById(ticket._id).populate('assignedTo', 'username').lean()
    });
  } catch (error) {
    logger.error('Error updating status', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Ändern des Status' });
  }
});

// PUT /api/support-tickets/:id/assign
// Assign ticket to admin
router.put('/:id/assign', auditLogMiddleware({ action: 'UPDATE', resource: 'SupportTicket', metadata: { operation: 'ASSIGN' } }), async (req, res) => {
  try {
    const { assignedTo } = req.body;

    // Validate admin exists if assignedTo is provided
    if (assignedTo) {
      const admin = await User.findById(assignedTo);
      if (!admin) {
        return res.status(400).json({ error: 'Admin nicht gefunden' });
      }
    }

    const ticket = await SupportTicket.findOne({
      _id: req.params.id,
      isDeleted: false
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket nicht gefunden' });
    }

    // Capture BEFORE state
    const beforeState = ticket.toObject();

    const oldAssignedTo = ticket.assignedTo;
    ticket.assignedTo = assignedTo || null;
    ticket.assignedAt = assignedTo ? new Date() : null;

    await ticket.save();

    // Send notification to student if ticket is assigned for the first time
    try {
      if (ticket.createdBy.studentPortalUserId && assignedTo && !oldAssignedTo) {
        await createNotification(
          ticket.createdBy.studentPortalUserId,
          'support_ticket_assigned',
          `Ticket #${ticket.ticketNumber} wurde zugewiesen`,
          'Ihr Support-Ticket wurde einem Administrator zugewiesen und wird bearbeitet.',
          {
            priority: 'normal',
            actionUrl: `/dashboard/support-tickets/${ticket._id}`,
            metadata: {
              ticketId: ticket._id,
              ticketNumber: ticket.ticketNumber
            }
          }
        );
      }
    } catch (notificationError) {
      logger.error('Error creating notification for ticket assignment', { error: notificationError.message, stack: notificationError.stack });
      // Don't fail the request if notification fails
    }

    // Attach before/after to req for audit log
    const afterState = ticket.toObject();
    req.auditMetadata = {
      before: beforeState,
      after: afterState,
      changes: getChangedFields(beforeState, afterState)
    };

    res.json({
      success: true,
      message: assignedTo ? 'Ticket zugewiesen' : 'Zuweisung entfernt',
      ticket: await SupportTicket.findById(ticket._id).populate('assignedTo', 'username').lean()
    });
  } catch (error) {
    logger.error('Error assigning ticket', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Zuweisen des Tickets' });
  }
});

// PUT /api/support-tickets/:id
// Update ticket metadata
router.put('/:id', auditLogMiddleware({ action: 'UPDATE', resource: 'SupportTicket' }), async (req, res) => {
  try {
    const { subject, priority, category } = req.body;

    const ticket = await SupportTicket.findOne({
      _id: req.params.id,
      isDeleted: false
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket nicht gefunden' });
    }

    // Capture BEFORE state
    const beforeState = ticket.toObject();

    if (subject !== undefined) {
      if (subject.length < 5 || subject.length > 200) {
        return res.status(400).json({ error: 'Betreff muss 5-200 Zeichen lang sein' });
      }
      ticket.subject = sanitizeText(subject.trim());
    }

    if (priority !== undefined) {
      const validPriorities = ['low', 'medium', 'high', 'urgent'];
      if (!validPriorities.includes(priority)) {
        return res.status(400).json({ error: 'Ungültige Priorität' });
      }
      ticket.priority = priority;
    }

    if (category !== undefined) {
      const validCategories = ['bug', 'suggestion', 'question', 'technical', 'other'];
      if (!validCategories.includes(category)) {
        return res.status(400).json({ error: 'Ungültige Kategorie' });
      }
      ticket.category = category;
    }

    await ticket.save();

    // Attach before/after to req for audit log
    const afterState = ticket.toObject();
    req.auditMetadata = {
      before: beforeState,
      after: afterState,
      changes: getChangedFields(beforeState, afterState)
    };

    res.json({
      success: true,
      message: 'Ticket aktualisiert',
      ticket: await SupportTicket.findById(ticket._id).populate('assignedTo', 'username').lean()
    });
  } catch (error) {
    logger.error('Error updating ticket', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Aktualisieren des Tickets' });
  }
});

// DELETE /api/support-tickets/:id
// Soft delete ticket
router.delete('/:id', auditLogMiddleware({ action: 'DELETE', resource: 'SupportTicket' }), async (req, res) => {
  try {
    const ticket = await SupportTicket.findOne({
      _id: req.params.id,
      isDeleted: false
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket nicht gefunden' });
    }

    ticket.isDeleted = true;
    ticket.deletedAt = new Date();
    ticket.deletedBy = req.user.id;

    await ticket.save();

    res.json({
      success: true,
      message: 'Ticket gelöscht'
    });
  } catch (error) {
    logger.error('Error deleting ticket', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Löschen des Tickets' });
  }
});

// POST /api/support-tickets/:id/messages/:messageId/read
// Mark message as read
router.post('/:id/messages/:messageId/read', async (req, res) => {
  try {
    const ticket = await SupportTicket.findOne({
      _id: req.params.id,
      isDeleted: false
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket nicht gefunden' });
    }

    const message = ticket.messages.id(req.params.messageId);
    if (!message) {
      return res.status(404).json({ error: 'Nachricht nicht gefunden' });
    }

    if (!message.isRead && message.senderType === 'student') {
      message.isRead = true;
      // Safely decrement counter (prevent negative values)
      if (ticket.unreadByAdmin > 0) {
        ticket.unreadByAdmin -= 1;
      }
      await ticket.save();
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Error marking message as read', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Markieren der Nachricht' });
  }
});

export default router;
