/**
 * Integration Tests: Portal Notification Routes
 *
 * Tests the notification system routes in backend/src/routes/portalNotifications.js:
 *
 *   A. GET    /api/portal/notifications          — List notifications (pagination, filters)
 *   B. GET    /api/portal/notifications/unread-count — Get unread count
 *   C. PATCH  /api/portal/notifications/:id/read — Mark single as read
 *   D. PATCH  /api/portal/notifications/read-all — Mark all as read
 *   E. DELETE /api/portal/notifications/:id      — Delete notification
 *   F. POST   /api/portal/notifications          — Create test notification (admin only)
 *
 * Infrastructure: MongoMemoryServer + Supertest
 * ESM: Uses import syntax (package.json "type": "module")
 */

import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import cookieParser from 'cookie-parser';
import Notification from '../../models/Notification.js';
import StudentPortalUser from '../../models/StudentPortalUser.js';
import portalNotificationsRoutes from '../portalNotifications.js';

// ---------------------------------------------------------------------------
// Mock middleware for testing
// ---------------------------------------------------------------------------
const mockPortalAuth = (userId, role = 'student') => {
  return (req, res, next) => {
    req.user = { id: userId, role };
    next();
  };
};

const mockAdminAuth = () => {
  return (req, res, next) => {
    req.user = { id: 'admin-id', role: 'admin' };
    next();
  };
};

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------
const createApp = (userId = null, role = 'student') => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // Apply auth middleware if userId provided
  if (userId) {
    app.use(mockPortalAuth(userId, role));
  }

  app.use('/api/portal/notifications', portalNotificationsRoutes);
  return app;
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
}, 30000);

afterEach(async () => {
  await Notification.deleteMany({});
  await StudentPortalUser.deleteMany({});
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a test student portal user
 */
const createTestUser = async () => {
  const user = await StudentPortalUser.create({
    email: `test_${Date.now()}@example.com`,
    password: 'TestPassword123!',
    firstName: 'Test',
    lastName: 'User',
    birthdate: new Date('2000-01-01'),
    emailVerified: true
  });
  return user;
};

/**
 * Create multiple test notifications for a user
 */
const createTestNotifications = async (userId, count = 3, overrides = {}) => {
  const notifications = [];

  for (let i = 0; i < count; i++) {
    const notification = await Notification.create({
      userId,
      type: 'announcement',
      title: `Test Notification ${i + 1}`,
      message: `This is test notification ${i + 1}`,
      priority: 'normal',
      ...overrides
    });
    notifications.push(notification);
  }

  return notifications;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Portal Notifications Routes', () => {

  // -------------------------------------------------------------------------
  // A. GET /api/portal/notifications - List notifications
  // -------------------------------------------------------------------------
  describe('GET /api/portal/notifications', () => {

    it('should return empty array when user has no notifications', async () => {
      const user = await createTestUser();
      const app = createApp(user._id.toString());

      const res = await request(app)
        .get('/api/portal/notifications')
        .expect(200);

      expect(res.body.notifications).toEqual([]);
      expect(res.body.pagination.total).toBe(0);
    });

    it('should return all notifications for authenticated user', async () => {
      const user = await createTestUser();
      await createTestNotifications(user._id, 3);

      const app = createApp(user._id.toString());

      const res = await request(app)
        .get('/api/portal/notifications')
        .expect(200);

      expect(res.body.notifications).toHaveLength(3);
      expect(res.body.pagination.total).toBe(3);
      expect(res.body.pagination.page).toBe(1);
    });

    it('should not return notifications from other users', async () => {
      const user1 = await createTestUser();
      const user2 = await createTestUser();

      await createTestNotifications(user1._id, 2);
      await createTestNotifications(user2._id, 3);

      const app = createApp(user1._id.toString());

      const res = await request(app)
        .get('/api/portal/notifications')
        .expect(200);

      expect(res.body.notifications).toHaveLength(2);
    });

    it('should support pagination', async () => {
      const user = await createTestUser();
      await createTestNotifications(user._id, 10);

      const app = createApp(user._id.toString());

      const res = await request(app)
        .get('/api/portal/notifications?page=2&limit=5')
        .expect(200);

      expect(res.body.notifications).toHaveLength(5);
      expect(res.body.pagination.page).toBe(2);
      expect(res.body.pagination.limit).toBe(5);
      expect(res.body.pagination.total).toBe(10);
      expect(res.body.pagination.pages).toBe(2);
    });

    it('should filter unread notifications when unreadOnly=true', async () => {
      const user = await createTestUser();
      const notifications = await createTestNotifications(user._id, 5);

      // Mark some as read
      await notifications[0].markAsRead();
      await notifications[1].markAsRead();

      const app = createApp(user._id.toString());

      const res = await request(app)
        .get('/api/portal/notifications?unreadOnly=true')
        .expect(200);

      expect(res.body.notifications).toHaveLength(3);
      expect(res.body.notifications.every(n => !n.read)).toBe(true);
    });

    it('should filter by type', async () => {
      const user = await createTestUser();
      await createTestNotifications(user._id, 2, { type: 'schedule_change' });
      await createTestNotifications(user._id, 3, { type: 'announcement' });

      const app = createApp(user._id.toString());

      const res = await request(app)
        .get('/api/portal/notifications?type=schedule_change')
        .expect(200);

      expect(res.body.notifications).toHaveLength(2);
      expect(res.body.notifications.every(n => n.type === 'schedule_change')).toBe(true);
    });

    it('should filter by priority', async () => {
      const user = await createTestUser();
      await createTestNotifications(user._id, 2, { priority: 'high' });
      await createTestNotifications(user._id, 3, { priority: 'normal' });

      const app = createApp(user._id.toString());

      const res = await request(app)
        .get('/api/portal/notifications?priority=high')
        .expect(200);

      expect(res.body.notifications).toHaveLength(2);
      expect(res.body.notifications.every(n => n.priority === 'high')).toBe(true);
    });

    it('should return notifications in descending order by createdAt', async () => {
      const user = await createTestUser();
      const notifications = await createTestNotifications(user._id, 3);

      const app = createApp(user._id.toString());

      const res = await request(app)
        .get('/api/portal/notifications')
        .expect(200);

      const dates = res.body.notifications.map(n => new Date(n.createdAt).getTime());
      const sortedDates = [...dates].sort((a, b) => b - a);

      expect(dates).toEqual(sortedDates);
    });
  });

  // -------------------------------------------------------------------------
  // B. GET /api/portal/notifications/unread-count - Get unread count
  // -------------------------------------------------------------------------
  describe('GET /api/portal/notifications/unread-count', () => {

    it('should return 0 when user has no notifications', async () => {
      const user = await createTestUser();
      const app = createApp(user._id.toString());

      const res = await request(app)
        .get('/api/portal/notifications/unread-count')
        .expect(200);

      expect(res.body.count).toBe(0);
    });

    it('should return correct unread count', async () => {
      const user = await createTestUser();
      const notifications = await createTestNotifications(user._id, 5);

      // Mark 2 as read
      await notifications[0].markAsRead();
      await notifications[1].markAsRead();

      const app = createApp(user._id.toString());

      const res = await request(app)
        .get('/api/portal/notifications/unread-count')
        .expect(200);

      expect(res.body.count).toBe(3);
    });

    it('should not count other users notifications', async () => {
      const user1 = await createTestUser();
      const user2 = await createTestUser();

      await createTestNotifications(user1._id, 3);
      await createTestNotifications(user2._id, 5);

      const app = createApp(user1._id.toString());

      const res = await request(app)
        .get('/api/portal/notifications/unread-count')
        .expect(200);

      expect(res.body.count).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // C. PATCH /api/portal/notifications/:id/read - Mark as read
  // -------------------------------------------------------------------------
  describe('PATCH /api/portal/notifications/:id/read', () => {

    it('should mark notification as read', async () => {
      const user = await createTestUser();
      const [notification] = await createTestNotifications(user._id, 1);

      const app = createApp(user._id.toString());

      const res = await request(app)
        .patch(`/api/portal/notifications/${notification._id}/read`)
        .expect(200);

      expect(res.body.notification.read).toBe(true);
      expect(res.body.notification.readAt).toBeDefined();

      // Verify in database
      const updated = await Notification.findById(notification._id);
      expect(updated.read).toBe(true);
      expect(updated.readAt).toBeDefined();
    });

    it('should return 404 when notification not found', async () => {
      const user = await createTestUser();
      const app = createApp(user._id.toString());
      const fakeId = new mongoose.Types.ObjectId();

      const res = await request(app)
        .patch(`/api/portal/notifications/${fakeId}/read`)
        .expect(404);

      expect(res.body.error).toBeDefined();
    });

    it('should not allow marking other users notifications', async () => {
      const user1 = await createTestUser();
      const user2 = await createTestUser();

      const [notification] = await createTestNotifications(user2._id, 1);

      const app = createApp(user1._id.toString());

      await request(app)
        .patch(`/api/portal/notifications/${notification._id}/read`)
        .expect(404);

      // Verify notification is still unread
      const unchanged = await Notification.findById(notification._id);
      expect(unchanged.read).toBe(false);
    });

    it('should be idempotent (marking read twice works)', async () => {
      const user = await createTestUser();
      const [notification] = await createTestNotifications(user._id, 1);

      const app = createApp(user._id.toString());

      // Mark first time
      await request(app)
        .patch(`/api/portal/notifications/${notification._id}/read`)
        .expect(200);

      // Mark second time
      const res = await request(app)
        .patch(`/api/portal/notifications/${notification._id}/read`)
        .expect(200);

      expect(res.body.notification.read).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // D. PATCH /api/portal/notifications/read-all - Mark all as read
  // -------------------------------------------------------------------------
  describe('PATCH /api/portal/notifications/read-all', () => {

    it('should mark all notifications as read for user', async () => {
      const user = await createTestUser();
      await createTestNotifications(user._id, 5);

      const app = createApp(user._id.toString());

      const res = await request(app)
        .patch('/api/portal/notifications/read-all')
        .expect(200);

      expect(res.body.count).toBe(5);

      // Verify in database
      const unreadCount = await Notification.countDocuments({ userId: user._id, read: false });
      expect(unreadCount).toBe(0);
    });

    it('should return 0 when no unread notifications', async () => {
      const user = await createTestUser();
      const app = createApp(user._id.toString());

      const res = await request(app)
        .patch('/api/portal/notifications/read-all')
        .expect(200);

      expect(res.body.count).toBe(0);
    });

    it('should not affect other users notifications', async () => {
      const user1 = await createTestUser();
      const user2 = await createTestUser();

      await createTestNotifications(user1._id, 3);
      await createTestNotifications(user2._id, 5);

      const app = createApp(user1._id.toString());

      await request(app)
        .patch('/api/portal/notifications/read-all')
        .expect(200);

      // Verify user2 still has unread notifications
      const user2UnreadCount = await Notification.countDocuments({ userId: user2._id, read: false });
      expect(user2UnreadCount).toBe(5);
    });

    it('should only count previously unread notifications', async () => {
      const user = await createTestUser();
      const notifications = await createTestNotifications(user._id, 5);

      // Mark some as read already
      await notifications[0].markAsRead();
      await notifications[1].markAsRead();

      const app = createApp(user._id.toString());

      const res = await request(app)
        .patch('/api/portal/notifications/read-all')
        .expect(200);

      expect(res.body.count).toBe(3); // Only the 3 that were unread
    });
  });

  // -------------------------------------------------------------------------
  // E. DELETE /api/portal/notifications/:id - Delete notification
  // -------------------------------------------------------------------------
  describe('DELETE /api/portal/notifications/:id', () => {

    it('should delete notification', async () => {
      const user = await createTestUser();
      const [notification] = await createTestNotifications(user._id, 1);

      const app = createApp(user._id.toString());

      const res = await request(app)
        .delete(`/api/portal/notifications/${notification._id}`)
        .expect(200);

      expect(res.body.message).toBeDefined();

      // Verify deleted in database
      const deleted = await Notification.findById(notification._id);
      expect(deleted).toBeNull();
    });

    it('should return 404 when notification not found', async () => {
      const user = await createTestUser();
      const app = createApp(user._id.toString());
      const fakeId = new mongoose.Types.ObjectId();

      const res = await request(app)
        .delete(`/api/portal/notifications/${fakeId}`)
        .expect(404);

      expect(res.body.error).toBeDefined();
    });

    it('should not allow deleting other users notifications', async () => {
      const user1 = await createTestUser();
      const user2 = await createTestUser();

      const [notification] = await createTestNotifications(user2._id, 1);

      const app = createApp(user1._id.toString());

      await request(app)
        .delete(`/api/portal/notifications/${notification._id}`)
        .expect(404);

      // Verify notification still exists
      const stillExists = await Notification.findById(notification._id);
      expect(stillExists).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // F. POST /api/portal/notifications - Create test notification (admin only)
  // -------------------------------------------------------------------------
  describe('POST /api/portal/notifications (admin only)', () => {

    it('should create notification with valid data', async () => {
      const user = await createTestUser();

      // Create app with admin auth
      const app = express();
      app.use(express.json());
      app.use(mockAdminAuth());
      app.use('/api/portal/notifications', portalNotificationsRoutes);

      const payload = {
        userId: user._id.toString(),
        type: 'announcement',
        title: 'Test Notification',
        message: 'This is a test message',
        priority: 'high',
        actionUrl: '/schedule',
        metadata: { testKey: 'testValue' }
      };

      const res = await request(app)
        .post('/api/portal/notifications')
        .send(payload)
        .expect(201);

      expect(res.body.notification).toBeDefined();
      expect(res.body.notification.title).toBe(payload.title);
      expect(res.body.notification.message).toBe(payload.message);
      expect(res.body.notification.priority).toBe(payload.priority);

      // Verify in database
      const created = await Notification.findById(res.body.notification._id);
      expect(created).not.toBeNull();
      expect(created.userId.toString()).toBe(user._id.toString());
    });

    it('should return 400 when missing required fields', async () => {
      const app = express();
      app.use(express.json());
      app.use(mockAdminAuth());
      app.use('/api/portal/notifications', portalNotificationsRoutes);

      const payload = {
        userId: new mongoose.Types.ObjectId().toString(),
        title: 'Test'
        // Missing type and message
      };

      const res = await request(app)
        .post('/api/portal/notifications')
        .send(payload)
        .expect(400);

      expect(res.body.error).toBeDefined();
    });
  });
});
