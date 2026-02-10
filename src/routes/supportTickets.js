import express from 'express';
import SupportTicket from '../models/SupportTicket.js';
import User from '../models/User.js';
import StudentPortalUser from '../models/StudentPortalUser.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { sendTicketReplyEmail, sendTicketStatusChangeEmail } from '../utils/emailService.js';
import logger from '../utils/logger.js';
import auditLogMiddleware from '../middleware/auditLog.js';

const router = express.Router();

// Escape special regex characters to prevent ReDoS attacks
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
      // Validate search length to prevent extremely long searches
      if (search.length > 50) {
        return res.status(400).json({ error: 'Suchbegriff zu lang (max 50 Zeichen)' });
      }

      // Escape special regex characters to prevent ReDoS attacks
      const escapedSearch = escapeRegex(search);

      filter.$or = [
        { subject: { $regex: escapedSearch, $options: 'i' } },
        { 'createdBy.name': { $regex: escapedSearch, $options: 'i' } },
        { 'createdBy.email': { $regex: escapedSearch, $options: 'i' } },
        { ticketNumber: isNaN(search) ? -1 : parseInt(search, 10) }
      ];
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
router.post('/:id/messages', auditLogMiddleware({ action: 'CREATE', resource: 'TicketMessage' }), async (req, res) => {
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
      content: content.trim(),
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

    const oldStatus = ticket.status;
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

    ticket.assignedTo = assignedTo || null;
    ticket.assignedAt = assignedTo ? new Date() : null;

    await ticket.save();

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

    if (subject !== undefined) {
      if (subject.length < 5 || subject.length > 200) {
        return res.status(400).json({ error: 'Betreff muss 5-200 Zeichen lang sein' });
      }
      ticket.subject = subject.trim();
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
      ticket.unreadByAdmin = Math.max(0, ticket.unreadByAdmin - 1);
      await ticket.save();
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Error marking message as read', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Markieren der Nachricht' });
  }
});

export default router;
