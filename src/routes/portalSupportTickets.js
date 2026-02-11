import express from 'express';
import rateLimit from 'express-rate-limit';
import SupportTicket from '../models/SupportTicket.js';
import StudentPortalUser from '../models/StudentPortalUser.js';
import Student from '../models/Student.js';
import { verifyPortalAuth } from '../middleware/verifyPortalAuth.js';
import { sendNewTicketEmail, sendTicketReplyEmail } from '../utils/emailService.js';
import logger from '../utils/logger.js';
import auditLogMiddleware from '../middleware/auditLog.js';

const router = express.Router();

// Sanitize HTML/XSS from text content
const sanitizeText = (text) => {
  if (!text) return text;
  // Strip all HTML tags
  return text.replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();
};

// All routes require student portal authentication
router.use(verifyPortalAuth);

// Rate limiting for ticket creation: 5 tickets per 15 minutes
const createTicketLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { error: 'Zu viele Tickets erstellt. Bitte warten Sie 15 Minuten.' },
  standardHeaders: true,
  legacyHeaders: false,
  // Key by user ID
  keyGenerator: (req) => req.user.id
});

// GET /api/portal/support-tickets
// List student's own tickets
router.get('/', async (req, res) => {
  try {
    const {
      status,
      sortBy = 'updatedAt',
      sortOrder = 'desc'
    } = req.query;

    // Build filter query - only own tickets
    const filter = {
      'createdBy.studentPortalUserId': req.user.id,
      isDeleted: false
    };

    if (status) {
      filter.status = status;
    }

    // Build sort
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Execute query
    const tickets = await SupportTicket.find(filter)
      .sort(sort)
      .lean();

    res.json({ tickets });
  } catch (error) {
    logger.error("Error fetching tickets", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Laden der Tickets' });
  }
});

// GET /api/portal/support-tickets/:id
// Get own ticket (with ownership verification)
router.get('/:id', async (req, res) => {
  try {
    const ticket = await SupportTicket.findOne({
      _id: req.params.id,
      'createdBy.studentPortalUserId': req.user.id,
      isDeleted: false
    }).lean();

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket nicht gefunden' });
    }

    res.json(ticket);
  } catch (error) {
    logger.error("Error fetching ticket", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Laden des Tickets' });
  }
});

// POST /api/portal/support-tickets
// Create new ticket (rate limited)
router.post('/', createTicketLimiter, auditLogMiddleware({ action: 'CREATE', resource: 'SupportTicket' }), async (req, res) => {
  try {
    const { subject, category, priority, description, url, userAgent } = req.body;

    // Validation
    if (!subject || subject.trim().length < 5 || subject.trim().length > 200) {
      return res.status(400).json({ error: 'Betreff muss 5-200 Zeichen lang sein' });
    }

    if (!description || description.trim().length < 10 || description.trim().length > 5000) {
      return res.status(400).json({ error: 'Beschreibung muss 10-5000 Zeichen lang sein' });
    }

    const validCategories = ['bug', 'suggestion', 'question', 'technical', 'other'];
    if (category && !validCategories.includes(category)) {
      return res.status(400).json({ error: 'Ungültige Kategorie' });
    }

    const validPriorities = ['low', 'medium', 'high', 'urgent'];
    if (priority && !validPriorities.includes(priority)) {
      return res.status(400).json({ error: 'Ungültige Priorität' });
    }

    // Get student portal user info
    const portalUser = await StudentPortalUser.findById(req.user.id);
    if (!portalUser) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    // Try to link to main Student record if exists
    let studentId = null;
    if (portalUser.studentId) {
      const student = await Student.findById(portalUser.studentId);
      if (student) {
        studentId = student._id;
      }
    }

    // Create ticket with initial message
    const ticket = new SupportTicket({
      subject: sanitizeText(subject.trim()),
      category: category || 'question',
      priority: priority || 'medium',
      status: 'open',
      createdBy: {
        studentPortalUserId: portalUser._id,
        studentId: studentId,
        email: portalUser.email,
        name: portalUser.name || portalUser.email
      },
      messages: [{
        senderType: 'student',
        senderId: portalUser._id,
        senderName: portalUser.name || portalUser.email,
        content: sanitizeText(description.trim()),
        isRead: false
      }],
      lastMessageAt: new Date(),
      lastMessageFrom: 'student',
      unreadByAdmin: 1,
      unreadByStudent: 0,
      statusHistory: [{
        status: 'open',
        note: 'Ticket erstellt'
      }],
      userAgent: userAgent || req.headers['user-agent'],
      url: url || ''
    });

    // Debug logging
    console.log('[Portal Tickets] About to save ticket...');
    console.log('[Portal Tickets] ticket.isNew:', ticket.isNew);
    console.log('[Portal Tickets] ticket.ticketNumber before save:', ticket.ticketNumber);
    console.log('[Portal Tickets] Schema constructor:', ticket.schema.constructor.name);

    await ticket.save();

    console.log('[Portal Tickets] ticket.ticketNumber after save:', ticket.ticketNumber);

    // Send email notification to admin
    try {
      await sendNewTicketEmail(ticket);
    } catch (emailError) {
      logger.error("Error sending new ticket email", { error: emailError.message, stack: emailError.stack });
      // Don't fail the request if email fails
    }

    res.status(201).json({
      success: true,
      message: 'Ticket erfolgreich erstellt',
      ticket
    });
  } catch (error) {
    // Log full error details to console for debugging
    console.error("=== ERROR CREATING TICKET ===");
    console.error("Message:", error.message);
    console.error("Stack:", error.stack);
    console.error("Full error:", error);
    logger.error("Error creating ticket", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Erstellen des Tickets' });
  }
});

// POST /api/portal/support-tickets/:id/reply
// Add student reply
router.post('/:id/reply', auditLogMiddleware({ action: 'CREATE', resource: 'TicketMessage' }), async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Nachricht darf nicht leer sein' });
    }

    if (content.length > 5000) {
      return res.status(400).json({ error: 'Nachricht zu lang (max 5000 Zeichen)' });
    }

    // Verify ownership
    const ticket = await SupportTicket.findOne({
      _id: req.params.id,
      'createdBy.studentPortalUserId': req.user.id,
      isDeleted: false
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket nicht gefunden' });
    }

    // Check if ticket is closed
    if (ticket.status === 'closed') {
      return res.status(400).json({ error: 'Geschlossene Tickets können nicht beantwortet werden' });
    }

    // Get student portal user info
    const portalUser = await StudentPortalUser.findById(req.user.id);
    if (!portalUser) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    // Create message
    const message = {
      senderType: 'student',
      senderId: portalUser._id,
      senderName: portalUser.name || portalUser.email,
      content: sanitizeText(content.trim()),
      isRead: false
    };

    // Update ticket
    ticket.messages.push(message);
    ticket.lastMessageAt = new Date();
    ticket.lastMessageFrom = 'student';
    ticket.unreadByAdmin += 1;

    // Auto-reopen if resolved/waiting-customer
    if (ticket.status === 'resolved' || ticket.status === 'waiting-customer') {
      const oldStatus = ticket.status;
      ticket.status = 'open';
      ticket.statusHistory.push({
        status: 'open',
        note: `Auto-reopened from ${oldStatus} on student reply`
      });
    }

    await ticket.save();

    // Send email notification to admin (if assigned) or general admin email
    try {
      const adminEmail = process.env.ADMIN_EMAIL || 'tennisapp-admin@diemachtderworte.de';
      await sendTicketReplyEmail(ticket, message, adminEmail);
    } catch (emailError) {
      logger.error("Error sending ticket reply email", { error: emailError.message, stack: emailError.stack });
      // Don't fail the request if email fails
    }

    res.json({
      success: true,
      message: 'Antwort gesendet',
      ticket: await SupportTicket.findById(ticket._id).lean()
    });
  } catch (error) {
    logger.error("Error adding reply", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Senden der Antwort' });
  }
});

// GET /api/portal/support-tickets/:id/messages - Fetch messages with ownership check
router.get('/:id/messages', async (req, res) => {
  try {
    const ticket = await SupportTicket.findOne({
      _id: req.params.id,
      'createdBy.studentPortalUserId': req.user.id,
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

// POST /api/portal/support-tickets/:id/read - Mark all admin messages as read
router.post('/:id/read', async (req, res) => {
  try {
    const ticket = await SupportTicket.findOne({
      _id: req.params.id,
      'createdBy.studentPortalUserId': req.user.id,
      isDeleted: false
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket nicht gefunden' });
    }

    let readCount = 0;
    ticket.messages.forEach(msg => {
      if (!msg.isRead && msg.senderType === 'admin') {
        msg.isRead = true;
        readCount++;
      }
    });

    if (readCount > 0) {
      // Safely decrement counter (prevent negative values)
      if (ticket.unreadByStudent > 0) {
        ticket.unreadByStudent = Math.max(0, ticket.unreadByStudent - readCount);
      }
      await ticket.save();
      logger.info('Student marked messages as read', {
        ticketId: req.params.id,
        readCount,
        studentId: req.user?.id
      });
    }

    res.json({ success: true, readCount });
  } catch (error) {
    logger.error('Error marking messages as read', {
      error: error.message,
      ticketId: req.params.id,
      userId: req.user?.id
    });
    res.status(500).json({ error: 'Serverfehler beim Markieren als gelesen' });
  }
});

// POST /api/portal/support-tickets/:id/close
// Student closes own ticket (only if status is 'resolved')
router.post('/:id/close', auditLogMiddleware({ action: 'UPDATE', resource: 'SupportTicket', metadata: { operation: 'CLOSE' } }), async (req, res) => {
  try {
    // Verify ownership
    const ticket = await SupportTicket.findOne({
      _id: req.params.id,
      'createdBy.studentPortalUserId': req.user.id,
      isDeleted: false
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket nicht gefunden' });
    }

    if (ticket.status !== 'resolved') {
      return res.status(400).json({ error: 'Nur gelöste Tickets können geschlossen werden' });
    }

    ticket.status = 'closed';
    ticket.statusHistory.push({
      status: 'closed',
      note: 'Vom Schüler geschlossen'
    });

    await ticket.save();

    res.json({
      success: true,
      message: 'Ticket geschlossen',
      ticket: await SupportTicket.findById(ticket._id).lean()
    });
  } catch (error) {
    logger.error("Error closing ticket", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Schließen des Tickets' });
  }
});

// POST /api/portal/support-tickets/:id/messages/:messageId/read
// Mark admin message as read
router.post('/:id/messages/:messageId/read', async (req, res) => {
  try {
    // Verify ownership
    const ticket = await SupportTicket.findOne({
      _id: req.params.id,
      'createdBy.studentPortalUserId': req.user.id,
      isDeleted: false
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket nicht gefunden' });
    }

    const message = ticket.messages.id(req.params.messageId);
    if (!message) {
      return res.status(404).json({ error: 'Nachricht nicht gefunden' });
    }

    if (!message.isRead && message.senderType === 'admin') {
      message.isRead = true;
      // Safely decrement counter (prevent negative values)
      if (ticket.unreadByStudent > 0) {
        ticket.unreadByStudent -= 1;
      }
      await ticket.save();
    }

    res.json({ success: true });
  } catch (error) {
    logger.error("Error marking message as read", { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Serverfehler beim Markieren der Nachricht' });
  }
});

export default router;
