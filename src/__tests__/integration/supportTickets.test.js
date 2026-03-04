/**
 * Integration tests for Support Tickets API
 *
 * Covers:
 * Portal side (student):
 *   1. POST /api/portal/support-tickets — create ticket
 *   2. GET  /api/portal/support-tickets — list own tickets
 *   3. GET  /api/portal/support-tickets/:id — get single ticket (own)
 *   4. POST /api/portal/support-tickets/:id/reply — student reply
 *   5. POST /api/portal/support-tickets/:id/close — close resolved ticket
 *
 * Admin side:
 *   6. GET /api/support-tickets — list all tickets with filters
 *   7. GET /api/support-tickets/:id — get ticket with messages
 *   8. POST /api/support-tickets/:id/messages — admin reply
 *   9. PUT  /api/support-tickets/:id/status — change status (state machine)
 *  10. Authorization: portal user can only see own tickets
 */

import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import SupportTicket from '../../models/SupportTicket.js';
import StudentPortalUser from '../../models/StudentPortalUser.js';
import User from '../../models/User.js';
import portalSupportTicketsRoutes from '../../routes/portalSupportTickets.js';
import adminSupportTicketsRoutes from '../../routes/supportTickets.js';
import {
  connectTestDB,
  disconnectTestDB,
  clearTestDB,
  mockAuth,
} from '../../testHelpers.js';

// ─────────────────────────────────────────────────────────────
// Portal app — student portal auth mock
// verifyPortalAuth passes in test mode when req.user.role === 'student'
// ─────────────────────────────────────────────────────────────
const portalApp = express();
portalApp.use(express.json());

// Middleware that injects a mock portal user per request
// We use a shared mutable object so individual tests can override it
const portalUserContext = { userId: null };

portalApp.use((req, res, next) => {
  req.user = {
    id: portalUserContext.userId || new mongoose.Types.ObjectId(),
    role: 'student',
    studentId: null,
  };
  next();
});

portalApp.use('/api/portal/support-tickets', portalSupportTicketsRoutes);

// ─────────────────────────────────────────────────────────────
// Admin app
// mockAuth sets req.user with role: 'admin'; requireAuth passes in test
// ─────────────────────────────────────────────────────────────
const adminApp = express();
adminApp.use(express.json());
adminApp.use(mockAuth());
adminApp.use('/api/support-tickets', adminSupportTicketsRoutes);

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Create a StudentPortalUser and register their ID in the portal context */
const createPortalUser = async (overrides = {}) => {
  const user = await StudentPortalUser.create({
    email: overrides.email || 'portal@test.com',
    password: 'testpassword123',
    firstName: overrides.firstName || 'Test',
    lastName: overrides.lastName || 'User',
    birthdate: new Date('1990-01-01'),
    emailVerified: true,
    ...overrides,
  });
  portalUserContext.userId = user._id;
  return user;
};

/** Create a SupportTicket directly in the DB (owned by portalUser) */
const createTicket = async (portalUser, overrides = {}) => {
  return SupportTicket.create({
    subject: 'Test subject here',
    category: 'question',
    priority: 'medium',
    status: 'open',
    createdBy: {
      studentPortalUserId: portalUser._id,
      email: portalUser.email,
      name: `${portalUser.firstName} ${portalUser.lastName}`,
    },
    messages: [{
      senderType: 'student',
      senderId: portalUser._id,
      senderName: `${portalUser.firstName} ${portalUser.lastName}`,
      content: 'Initial message content here',
      isRead: false,
    }],
    lastMessageAt: new Date(),
    lastMessageFrom: 'student',
    unreadByAdmin: 1,
    unreadByStudent: 0,
    statusHistory: [{ status: 'open', note: 'Ticket erstellt' }],
    ...overrides,
  });
};

// ─────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────

describe('Support Tickets API Integration Tests', () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterEach(async () => {
    await clearTestDB();
    portalUserContext.userId = null;
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  // ══════════════════════════════════════════════════════════
  // PORTAL ROUTES — Student Actions
  // ══════════════════════════════════════════════════════════

  describe('Portal Routes — Student Actions', () => {

    // ── POST /api/portal/support-tickets ────────────────────
    describe('POST /api/portal/support-tickets — create ticket', () => {
      test('should create ticket with valid data', async () => {
        const portalUser = await createPortalUser();

        const response = await request(portalApp)
          .post('/api/portal/support-tickets')
          .send({
            subject: 'Ich habe ein Problem mit meinem Stundenplan',
            description: 'Der Stundenplan zeigt die falsche Zeit an. Bitte helfen Sie mir.',
            category: 'bug',
            priority: 'high',
          });

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
        expect(response.body.ticket).toBeDefined();
        expect(response.body.ticket.subject).toBe('Ich habe ein Problem mit meinem Stundenplan');
        expect(response.body.ticket.status).toBe('open');
        expect(response.body.ticket.category).toBe('bug');
        expect(response.body.ticket.priority).toBe('high');
        expect(response.body.ticket.ticketNumber).toBeDefined();

        // Verify created_by links to the portal user
        expect(response.body.ticket.createdBy.studentPortalUserId.toString())
          .toBe(portalUser._id.toString());

        // Initial description stored as first message
        expect(response.body.ticket.messages).toHaveLength(1);
        expect(response.body.ticket.messages[0].senderType).toBe('student');
      });

      test('should use default category and priority when not provided', async () => {
        await createPortalUser();

        const response = await request(portalApp)
          .post('/api/portal/support-tickets')
          .send({
            subject: 'Eine allgemeine Frage zu meinem Konto',
            description: 'Ich möchte wissen, wie ich meine E-Mail-Adresse ändern kann.',
          });

        expect(response.status).toBe(201);
        expect(response.body.ticket.category).toBe('question');
        expect(response.body.ticket.priority).toBe('medium');
      });

      test('should reject subject shorter than 5 characters', async () => {
        await createPortalUser();

        const response = await request(portalApp)
          .post('/api/portal/support-tickets')
          .send({
            subject: 'Hi',
            description: 'Beschreibung die lang genug ist für die Validierung.',
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Betreff');
      });

      test('should reject description shorter than 10 characters', async () => {
        await createPortalUser();

        const response = await request(portalApp)
          .post('/api/portal/support-tickets')
          .send({
            subject: 'Gültiger Betreff',
            description: 'Zu kurz',
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Beschreibung');
      });

      test('should reject invalid category', async () => {
        await createPortalUser();

        const response = await request(portalApp)
          .post('/api/portal/support-tickets')
          .send({
            subject: 'Gültiger Betreff für das Ticket',
            description: 'Eine ausreichend lange Beschreibung für dieses Ticket.',
            category: 'invalid-category',
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Kategorie');
      });

      test('should reject invalid priority', async () => {
        await createPortalUser();

        const response = await request(portalApp)
          .post('/api/portal/support-tickets')
          .send({
            subject: 'Gültiger Betreff für das Ticket',
            description: 'Eine ausreichend lange Beschreibung für dieses Ticket.',
            priority: 'super-urgent',
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Priorität');
      });
    });

    // ── GET /api/portal/support-tickets ─────────────────────
    describe('GET /api/portal/support-tickets — list own tickets', () => {
      test('should return only tickets belonging to authenticated user', async () => {
        const portalUser = await createPortalUser();
        const otherUser = await StudentPortalUser.create({
          email: 'other@test.com',
          password: 'password123',
          firstName: 'Other',
          lastName: 'User',
          birthdate: new Date('1985-01-01'),
          emailVerified: true,
        });

        // Create two tickets for current user
        await createTicket(portalUser, { subject: 'Mein erstes Ticket hier' });
        await createTicket(portalUser, { subject: 'Mein zweites Ticket hier' });

        // Create ticket for other user (should NOT appear)
        await createTicket(otherUser, { subject: 'Das Ticket des anderen Benutzers' });

        const response = await request(portalApp)
          .get('/api/portal/support-tickets');

        expect(response.status).toBe(200);
        expect(response.body.tickets).toHaveLength(2);
        response.body.tickets.forEach(t => {
          expect(t.createdBy.studentPortalUserId.toString())
            .toBe(portalUser._id.toString());
        });
      });

      test('should return empty array when no tickets exist', async () => {
        await createPortalUser();

        const response = await request(portalApp)
          .get('/api/portal/support-tickets');

        expect(response.status).toBe(200);
        expect(response.body.tickets).toEqual([]);
      });

      test('should filter tickets by status', async () => {
        const portalUser = await createPortalUser();

        await createTicket(portalUser, { subject: 'Offenes Ticket ist vorhanden', status: 'open' });
        await createTicket(portalUser, { subject: 'Gelöstes Ticket ist vorhanden', status: 'resolved' });

        const response = await request(portalApp)
          .get('/api/portal/support-tickets?status=open');

        expect(response.status).toBe(200);
        expect(response.body.tickets).toHaveLength(1);
        expect(response.body.tickets[0].status).toBe('open');
      });

      test('should not return soft-deleted tickets', async () => {
        const portalUser = await createPortalUser();

        await createTicket(portalUser, {
          subject: 'Gelöschtes Ticket ist hier',
          isDeleted: true,
          deletedAt: new Date(),
        });

        const response = await request(portalApp)
          .get('/api/portal/support-tickets');

        expect(response.status).toBe(200);
        expect(response.body.tickets).toHaveLength(0);
      });
    });

    // ── GET /api/portal/support-tickets/:id ─────────────────
    describe('GET /api/portal/support-tickets/:id — get single ticket', () => {
      test('should return own ticket with full details', async () => {
        const portalUser = await createPortalUser();
        const ticket = await createTicket(portalUser, {
          subject: 'Mein persönliches Ticket hier',
        });

        const response = await request(portalApp)
          .get(`/api/portal/support-tickets/${ticket._id}`);

        expect(response.status).toBe(200);
        expect(response.body._id.toString()).toBe(ticket._id.toString());
        expect(response.body.subject).toBe('Mein persönliches Ticket hier');
        expect(response.body.messages).toBeDefined();
      });

      test('should return 404 for non-existent ticket', async () => {
        await createPortalUser();
        const nonExistentId = new mongoose.Types.ObjectId();

        const response = await request(portalApp)
          .get(`/api/portal/support-tickets/${nonExistentId}`);

        expect(response.status).toBe(404);
        expect(response.body.error).toContain('nicht gefunden');
      });

      test('should return 404 when trying to access another user\'s ticket', async () => {
        const portalUser = await createPortalUser();
        const otherUser = await StudentPortalUser.create({
          email: 'other2@test.com',
          password: 'password123',
          firstName: 'Other',
          lastName: 'Two',
          birthdate: new Date('1985-01-01'),
          emailVerified: true,
        });

        // Ticket owned by otherUser
        const otherTicket = await createTicket(otherUser, {
          subject: 'Ticket gehört einem anderen Benutzer',
        });

        // portalUser (current user in context) tries to access it
        const response = await request(portalApp)
          .get(`/api/portal/support-tickets/${otherTicket._id}`);

        expect(response.status).toBe(404);
      });
    });

    // ── POST /api/portal/support-tickets/:id/reply ───────────
    describe('POST /api/portal/support-tickets/:id/reply — student reply', () => {
      test('should add student reply message to ticket', async () => {
        const portalUser = await createPortalUser();
        const ticket = await createTicket(portalUser, { status: 'in-progress' });

        const response = await request(portalApp)
          .post(`/api/portal/support-tickets/${ticket._id}/reply`)
          .send({ content: 'Danke für Ihre Antwort, ich habe noch eine Frage.' });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.ticket.messages).toHaveLength(2);

        const lastMsg = response.body.ticket.messages[response.body.ticket.messages.length - 1];
        expect(lastMsg.senderType).toBe('student');
        expect(lastMsg.content).toBe('Danke für Ihre Antwort, ich habe noch eine Frage.');
      });

      test('should auto-reopen ticket that was waiting-customer', async () => {
        const portalUser = await createPortalUser();
        const ticket = await createTicket(portalUser, { status: 'waiting-customer' });

        const response = await request(portalApp)
          .post(`/api/portal/support-tickets/${ticket._id}/reply`)
          .send({ content: 'Hier ist meine Antwort auf Ihre Anfrage.' });

        expect(response.status).toBe(200);
        expect(response.body.ticket.status).toBe('open');
      });

      test('should reject reply on closed ticket', async () => {
        const portalUser = await createPortalUser();
        const ticket = await createTicket(portalUser, { status: 'closed' });

        const response = await request(portalApp)
          .post(`/api/portal/support-tickets/${ticket._id}/reply`)
          .send({ content: 'Ich versuche auf ein geschlossenes Ticket zu antworten.' });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Geschlossene Tickets');
      });

      test('should reject empty reply content', async () => {
        const portalUser = await createPortalUser();
        const ticket = await createTicket(portalUser);

        const response = await request(portalApp)
          .post(`/api/portal/support-tickets/${ticket._id}/reply`)
          .send({ content: '   ' });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('leer');
      });

      test('should return 404 when replying to another user\'s ticket', async () => {
        const portalUser = await createPortalUser();
        const otherUser = await StudentPortalUser.create({
          email: 'other3@test.com',
          password: 'password123',
          firstName: 'Other',
          lastName: 'Three',
          birthdate: new Date('1985-01-01'),
          emailVerified: true,
        });

        const otherTicket = await createTicket(otherUser);

        // portalUser tries to reply to otherUser's ticket
        const response = await request(portalApp)
          .post(`/api/portal/support-tickets/${otherTicket._id}/reply`)
          .send({ content: 'Antwort auf fremdes Ticket ist nicht erlaubt.' });

        expect(response.status).toBe(404);
      });
    });

    // ── POST /api/portal/support-tickets/:id/close ───────────
    describe('POST /api/portal/support-tickets/:id/close — close resolved ticket', () => {
      test('should allow student to close a resolved ticket', async () => {
        const portalUser = await createPortalUser();
        const ticket = await createTicket(portalUser, { status: 'resolved' });

        const response = await request(portalApp)
          .post(`/api/portal/support-tickets/${ticket._id}/close`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.ticket.status).toBe('closed');
      });

      test('should reject closing an open ticket (not resolved)', async () => {
        const portalUser = await createPortalUser();
        const ticket = await createTicket(portalUser, { status: 'open' });

        const response = await request(portalApp)
          .post(`/api/portal/support-tickets/${ticket._id}/close`);

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('gelöste Tickets');
      });

      test('should reject closing another user\'s ticket', async () => {
        const portalUser = await createPortalUser();
        const otherUser = await StudentPortalUser.create({
          email: 'other4@test.com',
          password: 'password123',
          firstName: 'Other',
          lastName: 'Four',
          birthdate: new Date('1985-01-01'),
          emailVerified: true,
        });

        const otherTicket = await createTicket(otherUser, { status: 'resolved' });

        const response = await request(portalApp)
          .post(`/api/portal/support-tickets/${otherTicket._id}/close`);

        expect(response.status).toBe(404);
      });
    });

  });

  // ══════════════════════════════════════════════════════════
  // ADMIN ROUTES
  // ══════════════════════════════════════════════════════════

  describe('Admin Routes', () => {

    /** Helper: create a portal user + a ticket (not in portalUserContext) */
    const createAdminTestData = async () => {
      const portalUser = await StudentPortalUser.create({
        email: 'admin-test-portal@test.com',
        password: 'password123',
        firstName: 'Admin',
        lastName: 'Test',
        birthdate: new Date('1990-01-01'),
        emailVerified: true,
      });

      const ticket = await SupportTicket.create({
        subject: 'Admin-Testticket für Integrationstests',
        category: 'question',
        priority: 'medium',
        status: 'open',
        createdBy: {
          studentPortalUserId: portalUser._id,
          email: portalUser.email,
          name: `${portalUser.firstName} ${portalUser.lastName}`,
        },
        messages: [{
          senderType: 'student',
          senderId: portalUser._id,
          senderName: `${portalUser.firstName} ${portalUser.lastName}`,
          content: 'Dies ist die initiale Nachricht des Tickets.',
          isRead: false,
        }],
        lastMessageAt: new Date(),
        lastMessageFrom: 'student',
        unreadByAdmin: 1,
        unreadByStudent: 0,
        statusHistory: [{ status: 'open', note: 'Ticket erstellt' }],
      });

      return { portalUser, ticket };
    };

    // ── GET /api/support-tickets ─────────────────────────────
    describe('GET /api/support-tickets — list all tickets', () => {
      test('should return all non-deleted tickets', async () => {
        const { portalUser } = await createAdminTestData();

        // Create a second ticket
        await SupportTicket.create({
          subject: 'Zweites Ticket für den Test',
          category: 'bug',
          priority: 'high',
          status: 'in-progress',
          createdBy: {
            studentPortalUserId: portalUser._id,
            email: portalUser.email,
            name: `${portalUser.firstName} ${portalUser.lastName}`,
          },
          messages: [{
            senderType: 'student',
            senderId: portalUser._id,
            senderName: 'Admin Test',
            content: 'Zweite initiale Nachricht hier.',
            isRead: false,
          }],
          lastMessageAt: new Date(),
          lastMessageFrom: 'student',
          unreadByAdmin: 1,
          statusHistory: [{ status: 'in-progress', note: 'Geöffnet' }],
        });

        const response = await request(adminApp)
          .get('/api/support-tickets');

        expect(response.status).toBe(200);
        expect(response.body.tickets).toHaveLength(2);
        expect(response.body.total).toBe(2);
      });

      test('should filter tickets by status', async () => {
        const { portalUser } = await createAdminTestData();

        await SupportTicket.create({
          subject: 'Zweites Ticket im Status in-progress',
          category: 'bug',
          priority: 'high',
          status: 'in-progress',
          createdBy: {
            studentPortalUserId: portalUser._id,
            email: portalUser.email,
            name: 'Test',
          },
          messages: [{
            senderType: 'student',
            senderId: portalUser._id,
            senderName: 'Test',
            content: 'Nachricht für zweites Ticket.',
            isRead: false,
          }],
          lastMessageAt: new Date(),
          lastMessageFrom: 'student',
          unreadByAdmin: 1,
          statusHistory: [{ status: 'in-progress', note: '' }],
        });

        const response = await request(adminApp)
          .get('/api/support-tickets?status=open');

        expect(response.status).toBe(200);
        expect(response.body.tickets).toHaveLength(1);
        expect(response.body.tickets[0].status).toBe('open');
      });

      test('should not return soft-deleted tickets', async () => {
        const { portalUser } = await createAdminTestData();

        await SupportTicket.create({
          subject: 'Gelöschtes Ticket erscheint nicht',
          category: 'question',
          priority: 'low',
          status: 'closed',
          isDeleted: true,
          deletedAt: new Date(),
          createdBy: {
            studentPortalUserId: portalUser._id,
            email: portalUser.email,
            name: 'Test',
          },
          messages: [{
            senderType: 'student',
            senderId: portalUser._id,
            senderName: 'Test',
            content: 'Nachricht im gelöschten Ticket.',
            isRead: false,
          }],
          lastMessageAt: new Date(),
          lastMessageFrom: 'student',
          unreadByAdmin: 0,
          statusHistory: [{ status: 'closed', note: '' }],
        });

        const response = await request(adminApp)
          .get('/api/support-tickets');

        // Only the non-deleted ticket from createAdminTestData() is returned
        expect(response.status).toBe(200);
        expect(response.body.tickets).toHaveLength(1);
      });

      test('should return stats correctly', async () => {
        await createAdminTestData();

        const response = await request(adminApp)
          .get('/api/support-tickets/stats');

        expect(response.status).toBe(200);
        expect(response.body.open).toBeDefined();
        expect(response.body.total).toBeDefined();
        expect(response.body.open).toBe(1);
        expect(response.body.total).toBe(1);
      });
    });

    // ── GET /api/support-tickets/:id ─────────────────────────
    describe('GET /api/support-tickets/:id — get ticket with messages', () => {
      test('should return ticket with full message thread', async () => {
        const { ticket } = await createAdminTestData();

        const response = await request(adminApp)
          .get(`/api/support-tickets/${ticket._id}`);

        expect(response.status).toBe(200);
        expect(response.body._id.toString()).toBe(ticket._id.toString());
        expect(response.body.subject).toBe('Admin-Testticket für Integrationstests');
        expect(response.body.messages).toHaveLength(1);
        expect(response.body.messages[0].senderType).toBe('student');
      });

      test('should return 404 for non-existent ticket', async () => {
        const nonExistentId = new mongoose.Types.ObjectId();

        const response = await request(adminApp)
          .get(`/api/support-tickets/${nonExistentId}`);

        expect(response.status).toBe(404);
        expect(response.body.error).toContain('nicht gefunden');
      });

      test('should return 404 for soft-deleted ticket', async () => {
        const { portalUser } = await createAdminTestData();

        const deletedTicket = await SupportTicket.create({
          subject: 'Dieses Ticket wurde gelöscht',
          category: 'question',
          priority: 'low',
          status: 'closed',
          isDeleted: true,
          deletedAt: new Date(),
          createdBy: {
            studentPortalUserId: portalUser._id,
            email: portalUser.email,
            name: 'Test',
          },
          messages: [{
            senderType: 'student',
            senderId: portalUser._id,
            senderName: 'Test',
            content: 'Nachricht im gelöschten Ticket hier.',
            isRead: false,
          }],
          lastMessageAt: new Date(),
          lastMessageFrom: 'student',
          unreadByAdmin: 0,
          statusHistory: [{ status: 'closed', note: '' }],
        });

        const response = await request(adminApp)
          .get(`/api/support-tickets/${deletedTicket._id}`);

        expect(response.status).toBe(404);
      });
    });

    // ── POST /api/support-tickets/:id/messages ───────────────
    describe('POST /api/support-tickets/:id/messages — admin reply', () => {
      test('should add admin message to ticket thread', async () => {
        const { ticket } = await createAdminTestData();

        const response = await request(adminApp)
          .post(`/api/support-tickets/${ticket._id}/messages`)
          .send({ content: 'Vielen Dank für Ihre Anfrage. Wir kümmern uns darum.' });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.ticket.messages).toHaveLength(2);

        const lastMsg = response.body.ticket.messages[response.body.ticket.messages.length - 1];
        expect(lastMsg.senderType).toBe('admin');
        expect(lastMsg.content).toBe('Vielen Dank für Ihre Anfrage. Wir kümmern uns darum.');
      });

      test('should increment unreadByStudent counter on admin reply', async () => {
        const { ticket } = await createAdminTestData();

        const response = await request(adminApp)
          .post(`/api/support-tickets/${ticket._id}/messages`)
          .send({ content: 'Neue Admin-Antwort für den Schüler.' });

        expect(response.status).toBe(200);
        expect(response.body.ticket.unreadByStudent).toBe(1);
      });

      test('should auto-change status from waiting-customer to in-progress', async () => {
        const { portalUser } = await createAdminTestData();

        const waitingTicket = await SupportTicket.create({
          subject: 'Ticket wartet auf Kundenrückmeldung',
          category: 'question',
          priority: 'medium',
          status: 'waiting-customer',
          createdBy: {
            studentPortalUserId: portalUser._id,
            email: portalUser.email,
            name: 'Test',
          },
          messages: [{
            senderType: 'student',
            senderId: portalUser._id,
            senderName: 'Test',
            content: 'Erste Nachricht des Tickets.',
            isRead: false,
          }],
          lastMessageAt: new Date(),
          lastMessageFrom: 'student',
          unreadByAdmin: 1,
          statusHistory: [{ status: 'waiting-customer', note: '' }],
        });

        const response = await request(adminApp)
          .post(`/api/support-tickets/${waitingTicket._id}/messages`)
          .send({ content: 'Admin antwortet auf das wartende Ticket.' });

        expect(response.status).toBe(200);
        expect(response.body.ticket.status).toBe('in-progress');
      });

      test('should reject empty admin message', async () => {
        const { ticket } = await createAdminTestData();

        const response = await request(adminApp)
          .post(`/api/support-tickets/${ticket._id}/messages`)
          .send({ content: '' });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('leer');
      });

      test('should reject message longer than 5000 characters', async () => {
        const { ticket } = await createAdminTestData();
        const tooLongContent = 'x'.repeat(5001);

        const response = await request(adminApp)
          .post(`/api/support-tickets/${ticket._id}/messages`)
          .send({ content: tooLongContent });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('lang');
      });
    });

    // ── PUT /api/support-tickets/:id/status ──────────────────
    describe('PUT /api/support-tickets/:id/status — change status', () => {
      test('should change status from open to in-progress', async () => {
        const { ticket } = await createAdminTestData();

        const response = await request(adminApp)
          .put(`/api/support-tickets/${ticket._id}/status`)
          .send({ status: 'in-progress', note: 'Admin übernimmt das Ticket' });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.ticket.status).toBe('in-progress');

        // Check statusHistory was updated
        const updatedTicket = await SupportTicket.findById(ticket._id);
        const lastHistory = updatedTicket.statusHistory[updatedTicket.statusHistory.length - 1];
        expect(lastHistory.status).toBe('in-progress');
        expect(lastHistory.note).toBe('Admin übernimmt das Ticket');
      });

      test('should change status from open to resolved', async () => {
        const { ticket } = await createAdminTestData();

        const response = await request(adminApp)
          .put(`/api/support-tickets/${ticket._id}/status`)
          .send({ status: 'resolved' });

        expect(response.status).toBe(200);
        expect(response.body.ticket.status).toBe('resolved');
      });

      test('should change status from open to closed', async () => {
        const { ticket } = await createAdminTestData();

        const response = await request(adminApp)
          .put(`/api/support-tickets/${ticket._id}/status`)
          .send({ status: 'closed' });

        expect(response.status).toBe(200);
        expect(response.body.ticket.status).toBe('closed');
      });

      test('should reject invalid status value', async () => {
        const { ticket } = await createAdminTestData();

        const response = await request(adminApp)
          .put(`/api/support-tickets/${ticket._id}/status`)
          .send({ status: 'invalid-status' });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Ungültiger Status');
      });

      test('should reject transitions from closed (state machine)', async () => {
        const { portalUser } = await createAdminTestData();

        const closedTicket = await SupportTicket.create({
          subject: 'Dieses Ticket ist bereits geschlossen',
          category: 'question',
          priority: 'low',
          status: 'closed',
          createdBy: {
            studentPortalUserId: portalUser._id,
            email: portalUser.email,
            name: 'Test',
          },
          messages: [{
            senderType: 'student',
            senderId: portalUser._id,
            senderName: 'Test',
            content: 'Nachricht im geschlossenen Ticket.',
            isRead: true,
          }],
          lastMessageAt: new Date(),
          lastMessageFrom: 'student',
          unreadByAdmin: 0,
          statusHistory: [{ status: 'closed', note: 'Geschlossen' }],
        });

        const response = await request(adminApp)
          .put(`/api/support-tickets/${closedTicket._id}/status`)
          .send({ status: 'open' });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Geschlossene');
      });

      test('should return 404 for non-existent ticket', async () => {
        const nonExistentId = new mongoose.Types.ObjectId();

        const response = await request(adminApp)
          .put(`/api/support-tickets/${nonExistentId}/status`)
          .send({ status: 'resolved' });

        expect(response.status).toBe(404);
      });
    });

    // ── Authorization: portal user cannot access other users' tickets ──
    describe('Authorization: ownership enforcement', () => {
      test('portal user cannot retrieve another user\'s ticket by ID', async () => {
        // Create ticket owned by admin-test-portal user (not in portalUserContext)
        const { ticket } = await createAdminTestData();

        // Register a different portal user as the "current" user
        const currentUser = await createPortalUser({
          email: 'current-user@test.com',
          firstName: 'Current',
          lastName: 'User',
        });

        // Current user tries to access the ticket owned by a different user
        const response = await request(portalApp)
          .get(`/api/portal/support-tickets/${ticket._id}`);

        expect(response.status).toBe(404);
      });

      test('portal user cannot reply to another user\'s ticket', async () => {
        const { ticket } = await createAdminTestData();

        const currentUser = await createPortalUser({
          email: 'current-user2@test.com',
          firstName: 'Current',
          lastName: 'UserTwo',
        });

        const response = await request(portalApp)
          .post(`/api/portal/support-tickets/${ticket._id}/reply`)
          .send({ content: 'Ich versuche auf ein fremdes Ticket zu antworten.' });

        expect(response.status).toBe(404);
      });

      test('portal user cannot close another user\'s ticket', async () => {
        const { portalUser: otherPortalUser } = await createAdminTestData();

        // Create a resolved ticket owned by another user
        const resolvedTicket = await SupportTicket.create({
          subject: 'Gelöstes Ticket eines anderen Benutzers',
          category: 'question',
          priority: 'low',
          status: 'resolved',
          createdBy: {
            studentPortalUserId: otherPortalUser._id,
            email: otherPortalUser.email,
            name: 'Other User',
          },
          messages: [{
            senderType: 'student',
            senderId: otherPortalUser._id,
            senderName: 'Other User',
            content: 'Initiale Nachricht des anderen Benutzers.',
            isRead: true,
          }],
          lastMessageAt: new Date(),
          lastMessageFrom: 'student',
          unreadByAdmin: 0,
          statusHistory: [
            { status: 'open', note: 'Erstellt' },
            { status: 'resolved', note: 'Gelöst' },
          ],
        });

        // Register current user in portal context
        await createPortalUser({
          email: 'current-user3@test.com',
          firstName: 'Current',
          lastName: 'UserThree',
        });

        const response = await request(portalApp)
          .post(`/api/portal/support-tickets/${resolvedTicket._id}/close`);

        expect(response.status).toBe(404);
      });
    });

  });

});
